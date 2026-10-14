import { z } from "zod";
import { storage } from "wxt/utils/storage";
import { customProviderEntry, type CustomProviderInput } from "./entries/custom";
import { openrouterEntry } from "./entries/openrouter";
import type { ModelDef, ProviderDef, ProviderEntry } from "./types";

// Merge order: built-ins -> persisted custom providers -> caller overrides.
// Nothing here is code-gated: adding a provider is one validated entry.

const CUSTOM_PROVIDERS_KEY = "local:custom-providers:v1";

const wireSchema = z.enum(["chat.completions", "responses"]);

const modelDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  wire: wireSchema,
  contextWindow: z.number().positive(),
  maxOutput: z.number().positive(),
  supportsTools: z.boolean(),
  supportsVision: z.boolean(),
  reasoning: z.boolean(),
});

const providerDefSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  baseUrl: z.string().url(),
  origins: z.array(z.string().min(1)).min(1),
  wire: wireSchema,
  endpoints: z.object({
    chat: z.string().startsWith("/"),
    models: z.string().startsWith("/").optional(),
    modelsNeedsAuth: z.boolean().optional(),
  }),
  defaults: z.object({
    model: z.string(),
    temperature: z.number(),
    maxTokens: z.number().positive(),
  }),
});

export function validateModelDef(raw: unknown): ModelDef {
  return modelDefSchema.parse(raw) as ModelDef;
}

export function validateProviderDef(raw: unknown): ProviderDef {
  return providerDefSchema.parse(raw) as ProviderDef;
}

function builtins(): Record<string, ProviderEntry> {
  return { [openrouterEntry.def.id]: openrouterEntry };
}

export function listProviders(custom: ProviderEntry[] = []): ProviderEntry[] {
  const merged: Record<string, ProviderEntry> = builtins();
  for (const entry of custom) merged[entry.def.id] = entry;
  return Object.values(merged);
}

export function resolveProvider(id: string, custom: ProviderEntry[] = []): ProviderEntry {
  const found = listProviders(custom).find((entry) => entry.def.id === id);
  if (!found) {
    const known = listProviders(custom)
      .map((entry) => entry.def.id)
      .join(", ");
    throw new Error(`Unknown provider "${id}". Known providers: ${known}.`);
  }
  return found;
}

/**
 * Materialize a /models-discovered id into a complete ModelDef.
 * The wire is always inherited from the provider — never guessed.
 */
export function materializeDiscoveredModel(def: ProviderDef, modelId: string): ModelDef {
  return {
    id: modelId,
    label: modelId,
    wire: def.wire,
    contextWindow: 32_000,
    maxOutput: 4096,
    supportsTools: def.capabilities.tools === "native",
    supportsVision: def.capabilities.vision,
    reasoning: false,
  };
}

const customInputListSchema = z.array(z.unknown());

export async function loadCustomProviders(): Promise<ProviderEntry[]> {
  const raw = await storage.defineItem<unknown[]>(CUSTOM_PROVIDERS_KEY).getValue();
  if (!raw) return [];
  const items = customInputListSchema.parse(raw) as CustomProviderInput[];
  return items.map((input) => customProviderEntry(input));
}

export async function saveCustomProvider(input: CustomProviderInput): Promise<ProviderDef> {
  const entry = customProviderEntry(input);
  const existing = await loadCustomProviders();
  const inputs: CustomProviderInput[] = existing
    .filter((e) => e.def.id !== entry.def.id)
    .map((e) => ({
      id: e.def.id,
      label: e.def.label,
      baseUrl: e.def.baseUrl,
      wire: e.def.wire,
      tools: e.def.capabilities.tools,
    }));
  inputs.push(input);
  await storage.defineItem<unknown[]>(CUSTOM_PROVIDERS_KEY).setValue(inputs);
  return entry.def;
}
