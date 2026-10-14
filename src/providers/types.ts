// Declarative provider registry types. Adding a provider or model is a
// config entry — never a code change in the agent loop.

export type Wire = "chat.completions" | "responses";
export type ToolsCapability = "native" | "prompted" | "unsupported";

/** How the bytes arrive, decided before the first token. */
export interface StreamWire {
  framing: "sse" | "ndjson" | "json-body";
  /** false => accumulate nothing; wait for the whole body. */
  emitsToolCallDeltas: boolean;
  /** false => fall back to the local tokenizer estimate. */
  emitsUsage: boolean;
  includeUsageParam?: "stream_options" | "none";
  /** Watchdog per stream, ms. */
  idleTimeoutMs: number;
}

export interface ProviderCapabilities {
  tools: ToolsCapability;
  toolChoice: boolean;
  parallelToolCalls: boolean;
  streamWire: StreamWire;
  reasoningParam?: "reasoning_effort" | "reasoning" | "none";
  reasoningDeltas: "none" | "reasoning" | "reasoning_content" | "reasoning_details";
  jsonMode: "json_schema" | "json_object" | "none";
  vision: boolean;
  maxToolsPerRequest?: number;
}

export type Quirk =
  "strip_temperature_when_reasoning" | "no_tool_choice_required" | "no_stream_options_on_responses_wire";

export interface ModelDef {
  id: string;
  label: string;
  /** REQUIRED — no default, no guessing. TypeScript enforces it. */
  wire: Wire;
  contextWindow: number;
  maxOutput: number;
  supportsTools: boolean;
  supportsVision: boolean;
  reasoning: boolean;
  quirks?: Quirk[];
  pricePerMTokIn?: number;
  pricePerMTokOut?: number;
  summarizerCapable?: boolean;
}

export interface ProviderDef {
  id: string;
  label: string;
  /** No trailing slash. User gateways come from env, never hardcoded. */
  baseUrl: string;
  /** Must equal the manifest host_permissions entry (asserted by pnpm gates). */
  origins: string[];
  /** Resolved in the background only; keys never leave storage.local. */
  auth: { type: "bearer"; keyStorageKey: string };
  endpoints: { chat: string; models?: string; modelsNeedsAuth?: boolean };
  /** Default wire inherited by /models-discovered models. */
  wire: Wire;
  capabilities: ProviderCapabilities;
  quirks: Quirk[];
  headers?: Record<string, string>;
  retry: {
    statuses: number[];
    maxAttempts: number;
    backoffMs: number[];
    honorRetryAfter: boolean;
  };
  defaults: { model: string; temperature: number; maxTokens: number };
}

/** A registered provider: its definition plus hand-written models. */
export interface ProviderEntry {
  def: ProviderDef;
  models: ModelDef[];
}
