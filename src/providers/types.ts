export type Wire = "chat" | "responses";

/** USD per 1M tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  /** Price for cache-hit input tokens; defaults to `input`. */
  cachedInput?: number;
}

export interface ModelConfig {
  id: string;
  label?: string;
  /** Accepts image input (screenshots). */
  vision: boolean;
  /** Supports native function calling (required for browser control). */
  tools: boolean;
  pricing?: ModelPricing;
  /** Max context length in tokens, when known. */
  contextWindow?: number;
}

export interface ProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  wire: Wire;
  headers?: Record<string, string>;
  models: ModelConfig[];
  preset?: "openrouter" | "opencode-go" | "custom";
}

export interface ModelRef {
  providerId: string;
  modelId: string;
}

export type ContentPart = { type: "text"; text: string } | { type: "image"; dataUrl: string };

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON arguments exactly as the model produced them. */
  args: string;
}

export interface ApiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[];
  toolCalls?: ToolCall[];
  toolCallId?: string;
}

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export type StreamEvent =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "toolCall"; call: ToolCall }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      /** Input tokens served from the provider's prompt cache (included in inputTokens). */
      cachedTokens?: number;
      /** Reasoning tokens (included in outputTokens). */
      reasoningTokens?: number;
      /** Cost in USD as billed by the provider, when it reports one (e.g. OpenRouter). */
      cost?: number;
    }
  | { type: "done"; reason: string };

export interface StreamRequest {
  provider: ProviderConfig;
  model: ModelConfig;
  messages: ApiMessage[];
  tools?: ToolSchema[];
  signal?: AbortSignal;
  maxTokens?: number;
  /** Stable per-conversation id; some providers use it for routing and prompt caching. */
  sessionId?: string;
  fetchImpl?: typeof fetch;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
