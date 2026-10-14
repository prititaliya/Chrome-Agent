import { streamChat } from "./chat";
import { joinUrl, providerHeaders } from "./http";
import { guessModel } from "./presets";
import { streamResponses } from "./responses";
import {
  ProviderError,
  type ModelConfig,
  type ProviderConfig,
  type StreamEvent,
  type StreamRequest,
} from "./types";

export function streamModel(req: StreamRequest): AsyncGenerator<StreamEvent> {
  return req.provider.wire === "responses" ? streamResponses(req) : streamChat(req);
}

interface RemoteModel {
  id?: unknown;
  name?: unknown;
  architecture?: { input_modalities?: unknown };
  supported_parameters?: unknown;
  /** OpenRouter: USD per token, as strings. */
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown };
  context_length?: unknown;
}

function perMillion(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : undefined;
}

/** Map a `/models` entry to a ModelConfig, using OpenRouter-style metadata when present. */
export function toModelConfig(raw: RemoteModel): ModelConfig | null {
  if (typeof raw.id !== "string" || raw.id === "") return null;
  const base = guessModel(raw.id);
  const modalities = raw.architecture?.input_modalities;
  const params = raw.supported_parameters;
  return {
    id: raw.id,
    label: typeof raw.name === "string" && raw.name !== raw.id ? raw.name : undefined,
    vision: Array.isArray(modalities) ? modalities.includes("image") : base.vision,
    tools: Array.isArray(params) ? params.includes("tools") : true,
    ...pricingOf(raw),
    ...(typeof raw.context_length === "number" && raw.context_length > 0 ? { contextWindow: raw.context_length } : {}),
  };
}

function pricingOf(raw: RemoteModel): Pick<ModelConfig, "pricing"> {
  const input = perMillion(raw.pricing?.prompt);
  const output = perMillion(raw.pricing?.completion);
  if (input === undefined || output === undefined) return {};
  const cachedInput = perMillion(raw.pricing?.input_cache_read);
  return { pricing: { input, output, ...(cachedInput !== undefined ? { cachedInput } : {}) } };
}

export async function fetchModels(
  provider: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelConfig[]> {
  const response = await fetchImpl(joinUrl(provider.baseUrl, "/models"), {
    headers: providerHeaders(provider),
    credentials: "omit",
  });
  if (!response.ok) {
    throw new ProviderError(
      `Could not list models from ${provider.name} (${response.status}). Add model ids manually.`,
      response.status,
    );
  }
  const json = (await response.json()) as { data?: unknown; models?: unknown } | unknown[];
  const list = Array.isArray(json)
    ? json
    : Array.isArray(json.data)
      ? json.data
      : Array.isArray(json.models)
        ? json.models
        : [];
  return (list as RemoteModel[])
    .map((item) => (typeof item === "string" ? toModelConfig({ id: item }) : toModelConfig(item)))
    .filter((m): m is ModelConfig => m !== null)
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Send a tiny prompt and report the reply (or a readable error). */
export async function testConnection(provider: ProviderConfig, model: ModelConfig): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    let text = "";
    let reasoning = false;
    for await (const event of streamModel({
      provider,
      model,
      messages: [{ role: "user", content: "Reply with exactly: OK" }],
      maxTokens: 8196,
      signal: controller.signal,
    })) {
      if (event.type === "text") text += event.text;
      if (event.type === "reasoning") reasoning = true;
    }
    if (text.trim() !== "") return `Connected. ${model.id} replied: "${text.trim().slice(0, 60)}"`;
    return reasoning
      ? `Connected. ${model.id} responded (reasoning only).`
      : `Connected, but ${model.id} returned an empty reply.`;
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Timed out after 45 s.");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
