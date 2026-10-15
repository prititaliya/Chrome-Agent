import type { ModelConfig, ProviderConfig } from "./types";

const VISION_HINT = /vision|vl\b|-vl-|gpt-4o|gpt-4\.1|gpt-5|gpt-6|gemini|claude|grok-4|qwen3?\.?\d*-?vl|kimi-k3|llama-4|pixtral/i;

export function guessModel(id: string): ModelConfig {
  return { id, vision: VISION_HINT.test(id), tools: true };
}

const OPENROUTER_MODELS = [
  "deepseek/deepseek-v4.1-flash",
  "deepseek/deepseek-v4-pro",
  "z-ai/glm-5.3",
  "moonshotai/kimi-k3",
  "moonshotai/kimi-k2.6",
  "minimax/minimax-m3",
  "qwen/qwen3.8-max-prime",
  "qwen/qwen3.7-plus",
  "x-ai/grok-4.7",
  "openai/gpt-6-luna",
  "openai/gpt-5.6-luna",
  "xiaomi/mimo-v2.6-pro",
];

const OPENCODE_GO_MODELS = [
  "deepseek-v4.1-flash",
  "glm-5.3",
  "glm-5.3-flash",
  "glm-5.2",
  "kimi-k2.7-code",
  "kimi-k2.6",
  "longcat-2.0",
  "mimo-v2.6-flash",
  "mimo-v2.5",
  "minimax-m3",
  "minimax-m2.7",
  "qwen3.7-plus",
  "hy3",
];

export function openRouterPreset(): ProviderConfig {
  return {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKey: "",
    wire: "chat",
    headers: { "HTTP-Referer": "https://github.com/comet-assistant", "X-Title": "UnComet Assistant" },
    models: OPENROUTER_MODELS.map(guessModel),
    preset: "openrouter",
  };
}

export function openCodeGoPreset(): ProviderConfig {
  return {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    apiKey: "",
    wire: "chat",
    models: OPENCODE_GO_MODELS.map(guessModel),
    preset: "opencode-go",
  };
}

export function defaultProviders(): ProviderConfig[] {
  return [openRouterPreset(), openCodeGoPreset()];
}
