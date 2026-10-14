import { z } from "zod";
import type { ProviderDef, ProviderEntry } from "../types";

// Builder for user-added OpenAI-compatible providers (Settings form:
// baseUrl + wire + tools capability + optional /models path).
// Validation lives here so malformed input fails with a readable message
// before anything is persisted.

export const customProviderInputSchema = z.object({
  id: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  baseUrl: z.string().url(),
  wire: z.enum(["chat.completions", "responses"]),
  tools: z.enum(["native", "prompted", "unsupported"]),
  modelsPath: z.string().startsWith("/").optional(),
});

export type CustomProviderInput = z.infer<typeof customProviderInputSchema>;

export function buildCustomProviderDef(input: CustomProviderInput): ProviderDef {
  const parsed = customProviderInputSchema.parse(input);
  const baseUrl = parsed.baseUrl.replace(/\/+$/, "");
  const origin = new URL(baseUrl).origin;
  return {
    id: parsed.id,
    label: parsed.label,
    baseUrl,
    origins: [`${origin}/*`],
    auth: { type: "bearer", keyStorageKey: `key:v1:${parsed.id}` },
    endpoints: { chat: "/chat/completions", models: parsed.modelsPath },
    wire: parsed.wire,
    capabilities: {
      tools: parsed.tools,
      toolChoice: parsed.tools === "native",
      parallelToolCalls: false,
      streamWire: {
        framing: "sse",
        emitsToolCallDeltas: true,
        emitsUsage: false,
        idleTimeoutMs: 60_000,
      },
      reasoningDeltas: "none",
      jsonMode: "none",
      vision: false,
    },
    quirks: [],
    retry: {
      statuses: [408, 425, 429, 500, 502, 503, 504],
      maxAttempts: 3,
      backoffMs: [1000, 5000, 20000],
      honorRetryAfter: true,
    },
    defaults: { model: "", temperature: 0.2, maxTokens: 2048 },
  };
}

export function customProviderEntry(input: CustomProviderInput): ProviderEntry {
  return { def: buildCustomProviderDef(input), models: [] };
}
