// Non-chat models: speech-to-text and decision (classifier) models. OpenRouter keeps both out of
// the default `/models` catalog and lists them under `output_modalities=<kind>`.

import { friendlyError, joinUrl, providerHeaders } from "./http";
import type { ProviderConfig } from "./types";

export type CatalogKind = "transcription" | "decisions";

export interface CatalogModel {
  id: string;
  label?: string;
  free?: boolean;
}

export function isOpenRouter(provider: ProviderConfig): boolean {
  return provider.preset === "openrouter" || /openrouter\.ai/i.test(provider.baseUrl);
}

// Deepgram's "nova-3" must not catch Amazon's "nova-2-lite" chat models.
const STT_NAME =
  /whisper|transcri|(?:^|[-_/])(?:stt|asr)(?:[-_.]|$)|scribe|chirp|parakeet|deepgram|(?:^|\/)nova-\d(?:-(?:general|meeting|phonecall|medical|finance|voicemail|video))?$/i;
const DECISION_NAME = /(?:^|[/~])(?:jev|kev)-|(?:^|[/-])tev\d|decide|decision|(?:^|\/)clef(?:$|[-:])|classify-\d|(?:^|\/)drex-|(?:^|\/)span-\d|(?:^|\/)d1(?:$|[-:])/i;

export function looksLikeStt(id: string): boolean {
  return STT_NAME.test(id);
}

export function looksLikeDecision(id: string): boolean {
  return DECISION_NAME.test(id);
}

/** Models that can hold a conversation (decision and transcription models can't). */
export function isChatModel(id: string): boolean {
  return !looksLikeStt(id) && !looksLikeDecision(id);
}

/** Which providers can serve a kind: decisions only exist on OpenRouter's Decisions API. */
export function servesKind(provider: ProviderConfig, kind: CatalogKind): boolean {
  return kind === "transcription" || isOpenRouter(provider);
}

interface RemoteModel {
  id?: unknown;
  name?: unknown;
  architecture?: { output_modalities?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown };
}

function remoteList(json: unknown): RemoteModel[] {
  if (Array.isArray(json)) return json.map((item) => (typeof item === "string" ? { id: item } : (item as RemoteModel)));
  const obj = json as { data?: unknown; models?: unknown } | null;
  return remoteList(Array.isArray(obj?.data) ? obj.data : Array.isArray(obj?.models) ? obj.models : []);
}

const zero = (v: unknown) => v === undefined || Number(v) === 0;

/**
 * A provider's models of one kind. OpenRouter is asked by modality; other providers only have
 * name-based transcription detection (Groq, OpenAI, local Whisper servers).
 */
export async function fetchCatalog(provider: ProviderConfig, kind: CatalogKind, fetchImpl: typeof fetch = fetch): Promise<CatalogModel[]> {
  if (!servesKind(provider, kind)) return [];
  const openRouter = isOpenRouter(provider);
  const url = joinUrl(provider.baseUrl, openRouter ? `/models?output_modalities=${kind}` : "/models");
  const response = await fetchImpl(url, { headers: providerHeaders(provider), credentials: "omit" });
  if (!response.ok) throw friendlyError(response.status, provider, await response.text().catch(() => ""));
  const seen = new Set<string>();
  const out: CatalogModel[] = [];
  for (const raw of remoteList(await response.json())) {
    if (typeof raw.id !== "string" || raw.id === "" || seen.has(raw.id)) continue;
    const outputs = raw.architecture?.output_modalities;
    const matches = Array.isArray(outputs) ? outputs.includes(kind) : kind === "transcription" && looksLikeStt(raw.id);
    if (!matches) continue;
    seen.add(raw.id);
    const free = /:free$/i.test(raw.id) || (raw.pricing !== undefined && zero(raw.pricing.prompt) && zero(raw.pricing.completion));
    out.push({ id: raw.id, ...(typeof raw.name === "string" && raw.name !== raw.id ? { label: raw.name } : {}), ...(free ? { free } : {}) });
  }
  return out.sort((a, b) => (a.label ?? a.id).localeCompare(b.label ?? b.id));
}
