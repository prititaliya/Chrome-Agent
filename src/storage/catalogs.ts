// Detected speech-to-text and decision models per provider, refreshed daily or when a provider's key or URL changes.

import { storage } from "wxt/utils/storage";
import { hasKey } from "../agent/router";
import { fetchCatalog, servesKind, type CatalogKind, type CatalogModel } from "../providers/catalog";
import type { ProviderConfig } from "../providers/types";

export interface CatalogEntry {
  /** Base URL and key hash the list was fetched with. */
  fingerprint: string;
  models: CatalogModel[];
  fetchedAt: number;
  error?: string;
}

/** Keyed by provider id. */
export type Catalog = Record<string, CatalogEntry>;

const TTL_MS = 24 * 60 * 60 * 1000;
const ERROR_TTL_MS = 60 * 60 * 1000;

const items = {
  transcription: storage.defineItem<Catalog>("local:stt-models:v1", { fallback: {} }),
  decisions: storage.defineItem<Catalog>("local:decision-models:v1", { fallback: {} }),
};

/** FNV-1a: tells keys apart without storing any of the key itself. */
function hashKey(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export function catalogFingerprint(provider: ProviderConfig): string {
  return `${provider.baseUrl.replace(/\/+$/, "")}|${hashKey(provider.apiKey.trim())}`;
}

export function needsRefresh(entry: CatalogEntry | undefined, provider: ProviderConfig, now = Date.now()): boolean {
  if (!entry || entry.fingerprint !== catalogFingerprint(provider)) return true;
  return now - entry.fetchedAt > (entry.error ? ERROR_TTL_MS : TTL_MS);
}

export async function getCatalog(kind: CatalogKind): Promise<Catalog> {
  return items[kind].getValue();
}

export function watchCatalog(kind: CatalogKind, listener: (catalog: Catalog) => void): () => void {
  return items[kind].watch((value) => listener(value ?? {}));
}

/** Every detected model id of a kind, across providers. */
export function catalogIds(catalog: Catalog): string[] {
  return Object.values(catalog).flatMap((entry) => entry.models.map((m) => m.id));
}

const inFlight = new Map<string, Promise<void>>();

/** Fetch the lists of every keyed provider whose cached list is stale (or all of them with `force`). */
export async function refreshCatalog(
  kind: CatalogKind,
  providers: ProviderConfig[],
  { force = false, fetchImpl }: { force?: boolean; fetchImpl?: typeof fetch } = {},
): Promise<Catalog> {
  const item = items[kind];
  const cache = await item.getValue();
  const due = providers.filter((p) => hasKey(p) && servesKind(p, kind) && (force || needsRefresh(cache[p.id], p)));
  await Promise.all(
    due.map((provider) => {
      const key = `${kind}:${provider.id}`;
      const running = inFlight.get(key);
      if (running && !force) return running;
      const job = fetchCatalog(provider, kind, fetchImpl)
        .then((models): CatalogEntry => ({ fingerprint: catalogFingerprint(provider), models, fetchedAt: Date.now() }))
        .catch(
          (error: unknown): CatalogEntry => ({
            fingerprint: catalogFingerprint(provider),
            models: cache[provider.id]?.models ?? [],
            fetchedAt: Date.now(),
            error: error instanceof Error ? error.message : String(error),
          }),
        )
        .then(async (entry) => {
          await item.setValue({ ...(await item.getValue()), [provider.id]: entry });
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, job);
      return job;
    }),
  );
  const latest = await item.getValue();
  const known = new Set(providers.filter((p) => servesKind(p, kind)).map((p) => p.id));
  const pruned = Object.fromEntries(Object.entries(latest).filter(([id]) => known.has(id)));
  if (Object.keys(pruned).length !== Object.keys(latest).length) await item.setValue(pruned);
  return pruned;
}
