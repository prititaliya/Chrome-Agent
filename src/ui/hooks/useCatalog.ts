import { useCallback, useEffect, useMemo, useState } from "react";
import type { CatalogKind } from "../../providers/catalog";
import { resolveStt, sttOptions, type SttChoice, type SttOption } from "../../providers/stt";
import type { ProviderConfig } from "../../providers/types";
import type { VoiceSettings } from "../../storage/settings";
import { getCatalog, refreshCatalog, watchCatalog, type Catalog } from "../../storage/catalogs";

export interface CatalogState {
  catalog: Catalog;
  refreshing: boolean;
  refresh: () => Promise<void>;
}

/** Detected models of one kind, refreshed in the background when stale. */
export function useCatalog(kind: CatalogKind, providers: ProviderConfig[] | null): CatalogState {
  const [catalog, setCatalog] = useState<Catalog>({});
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    void getCatalog(kind).then(setCatalog);
    return watchCatalog(kind, setCatalog);
  }, [kind]);

  useEffect(() => {
    if (providers) void refreshCatalog(kind, providers);
  }, [kind, providers]);

  const refresh = useCallback(async () => {
    if (!providers) return;
    setRefreshing(true);
    try {
      await refreshCatalog(kind, providers, { force: true });
    } finally {
      setRefreshing(false);
    }
  }, [kind, providers]);

  return { catalog, refreshing, refresh };
}

export function browserSttSupported(): boolean {
  return "SpeechRecognition" in globalThis || "webkitSpeechRecognition" in globalThis;
}

export interface SttState extends CatalogState {
  options: SttOption[];
  /** What the mic button will use right now. */
  choice: SttChoice | null;
}

export function useStt(providers: ProviderConfig[] | null, voice: VoiceSettings): SttState {
  const state = useCatalog("transcription", providers);
  const { catalog } = state;
  const options = useMemo(
    () => (providers ? sttOptions(providers, Object.fromEntries(Object.entries(catalog).map(([id, entry]) => [id, entry.models]))) : []),
    [providers, catalog],
  );
  const choice = useMemo(
    () => (providers ? resolveStt(voice.model, options, providers, browserSttSupported()) : null),
    [providers, options, voice.model],
  );
  return { ...state, options, choice };
}
