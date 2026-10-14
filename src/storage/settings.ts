// Providers (with their API keys) and user preferences, in storage.local.
// Never synced: keys stay on this machine.

import { storage } from "wxt/utils/storage";
import { defaultProviders } from "../providers/presets";
import type { ModelRef, ProviderConfig } from "../providers/types";
import type { SearchEngine } from "../browser/protocol";

export interface Settings {
  model: ModelRef | null;
  maxSteps: number;
  searchEngine: SearchEngine;
  /** "cdp" drives pages with trusted input via chrome.debugger; "dom" uses synthetic events only. */
  controlMode: "cdp" | "dom";
  /** Let vision models request screenshots. */
  screenshots: boolean;
  /** Attach the current tab's content to every question. */
  attachPage: boolean;
  /** Include long-term memories in every chat. */
  memory: boolean;
  /** Let the assistant save and delete memories on its own. */
  autoMemory: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  model: null,
  maxSteps: 30,
  searchEngine: "google",
  controlMode: "cdp",
  screenshots: true,
  attachPage: true,
  memory: true,
  autoMemory: true,
};

const settingsItem = storage.defineItem<Settings>("local:settings:v2", { fallback: DEFAULT_SETTINGS });
const providersItem = storage.defineItem<ProviderConfig[] | null>("local:providers:v2", { fallback: null });

export async function getSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await settingsItem.getValue()) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

export function watchSettings(listener: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => listener({ ...DEFAULT_SETTINGS, ...value }));
}

export async function getProviders(): Promise<ProviderConfig[]> {
  const stored = await providersItem.getValue();
  return stored ?? defaultProviders();
}

export async function saveProviders(providers: ProviderConfig[]): Promise<void> {
  await providersItem.setValue(providers);
}

export async function upsertProvider(provider: ProviderConfig): Promise<ProviderConfig[]> {
  const list = await getProviders();
  const index = list.findIndex((p) => p.id === provider.id);
  const next = index >= 0 ? list.map((p, i) => (i === index ? provider : p)) : [...list, provider];
  await saveProviders(next);
  return next;
}

export async function removeProvider(id: string): Promise<ProviderConfig[]> {
  const next = (await getProviders()).filter((p) => p.id !== id);
  await saveProviders(next);
  const settings = await getSettings();
  if (settings.model?.providerId === id) await saveSettings({ model: null });
  return next;
}

export function watchProviders(listener: (providers: ProviderConfig[]) => void): () => void {
  return providersItem.watch((value) => listener(value ?? defaultProviders()));
}

/** Resolve a model reference against the configured providers. */
export function resolveModel(providers: ProviderConfig[], ref: ModelRef | null) {
  if (!ref) return null;
  const provider = providers.find((p) => p.id === ref.providerId);
  const model = provider?.models.find((m) => m.id === ref.modelId);
  return provider && model ? { provider, model } : null;
}
