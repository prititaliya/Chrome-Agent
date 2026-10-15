// Speech-to-text: pick a transcription model and turn recorded audio into text.

import { hasKey } from "../agent/router";
import { isOpenRouter, looksLikeStt, type CatalogModel } from "./catalog";
import { joinUrl, postWithRetry, providerHeaders } from "./http";
import { ProviderError, type ModelRef, type ProviderConfig } from "./types";

/** Chrome's built-in speech recognition (free, no key; audio goes to Google's speech service). */
export const BROWSER_STT: ModelRef = { providerId: "browser", modelId: "web-speech" };
export const BROWSER_STT_LABEL = "Chrome built-in (free)";

export interface SttOption {
  ref: ModelRef;
  label: string;
  providerName: string;
}

export type SttChoice =
  | { kind: "browser"; ref: ModelRef; label: string }
  | { kind: "api"; ref: ModelRef; provider: ProviderConfig; modelId: string; label: string };

export interface Transcript {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  /** USD, when the provider reports it. */
  cost?: number;
}

/** Preferred automatic picks, in order: fast and cheap first. */
const PREFERRED = [/whisper-large-v3-turbo/i, /gpt-4o-mini-transcribe/i, /whisper-large-v3/i, /whisper/i, /transcribe/i];

/** Every STT model the user can pick: detected ones plus STT-looking models saved on a provider. */
export function sttOptions(providers: ProviderConfig[], detected: Record<string, CatalogModel[] | undefined>): SttOption[] {
  const out: SttOption[] = [];
  for (const provider of providers) {
    if (!hasKey(provider)) continue;
    const saved = provider.models.filter((m) => looksLikeStt(m.id)).map((m) => ({ id: m.id, label: m.label }));
    const seen = new Set<string>();
    for (const model of [...(detected[provider.id] ?? []), ...saved]) {
      if (seen.has(model.id)) continue;
      seen.add(model.id);
      out.push({ ref: { providerId: provider.id, modelId: model.id }, label: model.label ?? model.id, providerName: provider.name });
    }
  }
  return out;
}

export function autoSttOption(options: SttOption[]): SttOption | undefined {
  for (const re of PREFERRED) {
    const hit = options.find((o) => re.test(o.ref.modelId));
    if (hit) return hit;
  }
  return options[0];
}

/** The model the mic button will use: the user's pick if still usable, else the automatic one. */
export function resolveStt(
  picked: ModelRef | null,
  options: SttOption[],
  providers: ProviderConfig[],
  browserSupported: boolean,
): SttChoice | null {
  const browser: SttChoice | null = browserSupported ? { kind: "browser", ref: BROWSER_STT, label: BROWSER_STT_LABEL } : null;
  const toChoice = (option: SttOption): SttChoice | null => {
    const provider = providers.find((p) => p.id === option.ref.providerId);
    return provider ? { kind: "api", ref: option.ref, provider, modelId: option.ref.modelId, label: option.label } : null;
  };
  if (picked?.providerId === BROWSER_STT.providerId) return browser;
  if (picked) {
    const option = options.find((o) => o.ref.providerId === picked.providerId && o.ref.modelId === picked.modelId);
    // A saved pick stays usable while its provider still has a key, even before detection finishes.
    const provider = providers.find((p) => p.id === picked.providerId && hasKey(p));
    if (option) return toChoice(option);
    if (provider) return { kind: "api", ref: picked, provider, modelId: picked.modelId, label: picked.modelId };
  }
  const auto = autoSttOption(options);
  return (auto && toChoice(auto)) ?? browser;
}

/** "OpenAI: Whisper Large V3" → "Whisper Large V3". */
export function shortSttLabel(label: string): string {
  return label.replace(/^[^:/]{1,40}:\s*/, "");
}

export function audioFormat(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  if (m.includes("aac")) return "aac";
  return "webm";
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export interface TranscribeOptions {
  provider: ProviderConfig;
  modelId: string;
  audio: Blob;
  /** ISO-639-1 code; omitted to auto-detect. */
  language?: string;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

/**
 * POST `/audio/transcriptions`. OpenRouter takes base64 JSON (`input_audio`); every other
 * OpenAI-compatible provider takes the OpenAI multipart upload.
 */
export async function transcribe(opts: TranscribeOptions): Promise<Transcript> {
  const { provider, modelId, audio, language, signal } = opts;
  const format = audioFormat(audio.type);
  let init: RequestInit;
  if (isOpenRouter(provider)) {
    init = {
      headers: providerHeaders(provider),
      body: JSON.stringify({ model: modelId, input_audio: { data: await toBase64(audio), format }, ...(language ? { language } : {}) }),
    };
  } else {
    const form = new FormData();
    form.append("file", audio, `speech.${format}`);
    form.append("model", modelId);
    if (language) form.append("language", language);
    // The browser sets the multipart boundary itself.
    const headers = Object.fromEntries(Object.entries(providerHeaders(provider)).filter(([k]) => k.toLowerCase() !== "content-type"));
    init = { headers, body: form };
  }
  const response = await postWithRetry(joinUrl(provider.baseUrl, "/audio/transcriptions"), { ...init, signal }, provider, opts.fetchImpl);
  const json = (await response.json().catch(() => null)) as { text?: unknown; usage?: Record<string, unknown> } | null;
  if (typeof json?.text !== "string") throw new ProviderError(`${provider.name} returned no transcript.`, 0);
  const usage = json.usage ?? {};
  const inputTokens = num(usage.input_tokens) ?? num(usage.prompt_tokens);
  const outputTokens = num(usage.output_tokens) ?? num(usage.completion_tokens);
  const cost = num(usage.cost);
  return {
    text: json.text.trim(),
    ...(inputTokens !== undefined ? { inputTokens } : {}),
    ...(outputTokens !== undefined ? { outputTokens } : {}),
    ...(cost !== undefined ? { cost } : {}),
  };
}
