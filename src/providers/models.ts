// Model discovery: GET /models with tolerant shape handling, a 24h
// storage.local cache, manual paste for gateways without /models, and
// per-model wire overrides. UI-safe: no key material passes through here;
// callers supply an already-resolved apiKey (background only).

import { storage } from "wxt/utils/storage";
import { materializeDiscoveredModel } from "./registry";
import type { ModelDef, ProviderDef, Wire } from "./types";

export const MODELS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ModelsCache {
  fetchedAt: number;
  models: ModelDef[];
}

function cacheKey(providerId: string): `local:models-cache:v1:${string}` {
  return `local:models-cache:v1:${providerId}`;
}

const OVERRIDES_KEY = "local:model-wire-overrides:v1";
type WireOverrides = Record<string, Record<string, Wire>>;

/** Extract model ids from /models shapes: {data:[…]}, {models:[…]}, bare […]. */
export function extractModelIds(raw: unknown): string[] {
  const ids: string[] = [];
  const push = (item: unknown) => {
    if (typeof item === "string" && item !== "") ids.push(item);
    else if (typeof item === "object" && item !== null) {
      const id = (item as Record<string, unknown>)["id"];
      if (typeof id === "string" && id !== "") ids.push(id);
    }
  };
  if (Array.isArray(raw)) {
    for (const item of raw) push(item);
    return ids;
  }
  if (typeof raw === "object" && raw !== null) {
    const record = raw as Record<string, unknown>;
    for (const key of ["data", "models"]) {
      if (Array.isArray(record[key])) {
        for (const item of record[key] as unknown[]) push(item);
        return ids;
      }
    }
  }
  return ids;
}

export function parsePastedIds(text: string): string[] {
  const ids = new Set<string>();
  for (const part of text.split(/[\s,]+/)) {
    const id = part.trim();
    if (id !== "") ids.add(id);
  }
  return [...ids];
}

export async function readCache(providerId: string): Promise<ModelsCache | null> {
  return (await storage.defineItem<ModelsCache>(cacheKey(providerId)).getValue()) ?? null;
}

export async function readWireOverrides(): Promise<WireOverrides> {
  return (await storage.defineItem<WireOverrides>(OVERRIDES_KEY).getValue()) ?? {};
}

export async function setModelWireOverride(providerId: string, modelId: string, wire: Wire): Promise<void> {
  const overrides = await readWireOverrides();
  const scoped = overrides[providerId] ?? {};
  scoped[modelId] = wire;
  overrides[providerId] = scoped;
  await storage.defineItem<WireOverrides>(OVERRIDES_KEY).setValue(overrides);
}

export function applyOverrides(models: ModelDef[], overrides: WireOverrides, providerId: string): ModelDef[] {
  const scoped = overrides[providerId] ?? {};
  return models.map((m) => {
    const wire = scoped[m.id];
    return wire === undefined ? m : { ...m, wire };
  });
}

export async function listCachedModels(providerId: string): Promise<ModelDef[]> {
  const [cache, overrides] = await Promise.all([readCache(providerId), readWireOverrides()]);
  if (!cache) return [];
  return applyOverrides(cache.models, overrides, providerId);
}

export interface FetchModelsOptions {
  force?: boolean;
  fetchImpl?: typeof fetch;
}

/** Refresh from /models unless a fresh cache exists (force bypasses). */
export async function refreshModels(
  def: ProviderDef,
  apiKey: string | null,
  options: FetchModelsOptions = {},
): Promise<ModelDef[]> {
  if (options.force !== true) {
    const cached = await listCachedModels(def.id);
    if (cached.length > 0) {
      const cache = await readCache(def.id);
      if (cache && Date.now() - cache.fetchedAt < MODELS_CACHE_TTL_MS) return cached;
    }
  }
  if (!def.endpoints.models) return listCachedModels(def.id);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { ...def.headers };
  if (apiKey) headers["authorization"] = `Bearer ${apiKey}`;
  const response = await fetchImpl(`${def.baseUrl}${def.endpoints.models}`, { headers });
  if (!response.ok) throw new Error(`GET /models failed: ${response.status}`);
  const ids = extractModelIds((await response.json()) as unknown);
  const discovered = ids.map((id) => materializeDiscoveredModel(def, id));
  await storage
    .defineItem<ModelsCache>(cacheKey(def.id))
    .setValue({ fetchedAt: Date.now(), models: discovered });
  return listCachedModels(def.id);
}

/** Merge manually pasted ids into the cache (for gateways without /models). */
export async function addManualModels(def: ProviderDef, text: string): Promise<ModelDef[]> {
  const cache = (await readCache(def.id)) ?? { fetchedAt: 0, models: [] };
  const known = new Set(cache.models.map((m) => m.id));
  for (const id of parsePastedIds(text)) {
    if (!known.has(id)) {
      known.add(id);
      cache.models.push(materializeDiscoveredModel(def, id));
    }
  }
  await storage.defineItem<ModelsCache>(cacheKey(def.id)).setValue(cache);
  return listCachedModels(def.id);
}
