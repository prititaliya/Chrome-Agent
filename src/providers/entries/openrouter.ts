import type { ProviderEntry } from "../types";

// OpenRouter: OpenAI-compatible gateway, public /models, native tools,
// usage in the final stream chunk. Models come from /models discovery
// (plan Task 10); only the provider default is hand-written here.
export const openrouterEntry: ProviderEntry = {
  def: {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    origins: ["https://openrouter.ai/*"],
    auth: { type: "bearer", keyStorageKey: "key:v1:openrouter" },
    endpoints: { chat: "/chat/completions", models: "/models", modelsNeedsAuth: false },
    wire: "chat.completions",
    capabilities: {
      tools: "native",
      toolChoice: true,
      parallelToolCalls: true,
      streamWire: {
        framing: "sse",
        emitsToolCallDeltas: true,
        emitsUsage: true,
        includeUsageParam: "stream_options",
        idleTimeoutMs: 60_000,
      },
      reasoningDeltas: "reasoning_details",
      jsonMode: "json_schema",
      vision: true,
    },
    quirks: ["strip_temperature_when_reasoning", "no_tool_choice_required"],
    headers: {
      "HTTP-Referer": "https://local.browser-assistant",
      "X-Title": "Comet-like Browser Assistant",
    },
    retry: {
      statuses: [408, 425, 429, 500, 502, 503, 504],
      maxAttempts: 3,
      backoffMs: [1000, 5000, 20000],
      honorRetryAfter: true,
    },
    // Cheap tool-calling default for an agent loop; user-changeable in the picker.
    defaults: { model: "openai/gpt-4o-mini", temperature: 0.2, maxTokens: 2048 },
  },
  models: [],
};
