// User preferences in `storage.local` under `settings:v1`.
// The UI subscribes via `watchSettings`; the background reads snapshots.
import { storage } from "wxt/utils/storage";

export interface Settings {
  defaultProvider: string;
  defaultModel: string;
  maxSteps: number;
  maxToolCalls: number;
  maxCostUSD: number;
  keepNMostRecentThreads: number;
  historySoftQuotaBytes: number;
  controlMode: "dom" | "cdp";
  deniedOrigins: string[];
}

export const DEFAULT_SETTINGS: Settings = {
  defaultProvider: "openrouter",
  defaultModel: "",
  maxSteps: 25,
  maxToolCalls: 60,
  maxCostUSD: 0.5,
  keepNMostRecentThreads: 100,
  historySoftQuotaBytes: 9_000_000,
  controlMode: "dom",
  deniedOrigins: [],
};

const settingsItem = storage.defineItem<Settings>("local:settings:v1", {
  defaultValue: DEFAULT_SETTINGS,
});

export async function getSettings(): Promise<Settings> {
  const value = await settingsItem.getValue();
  return value ?? DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await settingsItem.setValue({ ...current, ...patch });
}

export function watchSettings(listener: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => listener(value ?? DEFAULT_SETTINGS));
}
