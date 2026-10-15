// Providers (with their API keys) and user preferences, in storage.local.
// Never synced: keys stay on this machine.

import { storage } from "wxt/utils/storage";
import { defaultProviders } from "../providers/presets";
import type { ModelRef, ProviderConfig } from "../providers/types";
import type { SearchEngine } from "../browser/protocol";

export interface AutoSettings {
  /** Pick a model per message instead of using `model`. */
  enabled: boolean;
  /** Models Auto may choose; null means every model whose provider has a key. */
  allowed: ModelRef[] | null;
  preferFree: boolean;
  /** "decision" asks a decision model (Jev by default) through OpenRouter's Decisions API; "rules" stays offline. */
  classifier: "decision" | "rules";
  /** Decision model to ask; null uses the newest Jev. */
  decisionModel: ModelRef | null;
}

export interface VoiceSettings {
  /** Speech-to-text model; null picks one automatically. Provider id "browser" is Chrome's built-in recognition. */
  model: ModelRef | null;
  /** ISO-639-1 code, or "" to auto-detect. */
  language: string;
  /** Send the message as soon as the transcript is ready. */
  autoSend: boolean;
}

export interface Settings {
  /** The manually chosen model (used when Auto is off). */
  model: ModelRef | null;
  auto: AutoSettings;
  voice: VoiceSettings;
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
  /** Keep a short digest of each chat and let the assistant search earlier chats. */
  sessionMemory: boolean;
}

export const DEFAULT_AUTO: AutoSettings = { enabled: false, allowed: null, preferFree: true, classifier: "decision", decisionModel: null };

export const DEFAULT_VOICE: VoiceSettings = { model: null, language: "", autoSend: false };

export const DEFAULT_SETTINGS: Settings = {
  model: null,
  auto: DEFAULT_AUTO,
  voice: DEFAULT_VOICE,
  maxSteps: 100,
  searchEngine: "google",
  controlMode: "cdp",
  screenshots: true,
  attachPage: true,
  memory: true,
  autoMemory: true,
  sessionMemory: true,
};

function withDefaults(stored: Partial<Settings> | null | undefined): Settings {
  const auto = { ...DEFAULT_AUTO, ...stored?.auto };
  // Before other decision models were supported the classifier was stored as "jev".
  if ((auto.classifier as string) === "jev") auto.classifier = "decision";
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    auto,
    voice: { ...DEFAULT_VOICE, ...stored?.voice },
  };
}

const settingsItem = storage.defineItem<Settings>("local:settings:v2", { fallback: DEFAULT_SETTINGS });
const providersItem = storage.defineItem<ProviderConfig[] | null>("local:providers:v2", { fallback: null });

export async function getSettings(): Promise<Settings> {
  return withDefaults(await settingsItem.getValue());
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch };
  await settingsItem.setValue(next);
  return next;
}

export function watchSettings(listener: (settings: Settings) => void): () => void {
  return settingsItem.watch((value) => listener(withDefaults(value)));
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
