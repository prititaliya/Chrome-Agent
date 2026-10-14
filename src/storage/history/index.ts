// History index-key maintenance + searchBlob builder + full-text search.
// Search loads full records through an injected loader (no store import,
// so there is no runtime cycle).

import { browser } from "wxt/browser";
import type { Envelope, ThreadIndexEntry, ThreadRecord } from "./store";
import { HISTORY_INDEX_KEY } from "./store";

function isRecord(raw: unknown): raw is ThreadRecord {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    typeof r["title"] === "string" &&
    Array.isArray(r["messages"]) &&
    typeof r["schemaVersion"] === "number"
  );
}

/** searchBlob ≤ 4 KB: title + first 80 chars of the last ~50 messages. */
export function buildSearchBlob(title: string, messages: Envelope[]): string {
  const parts = [title];
  for (const m of messages.slice(-50)) {
    parts.push(m.content.slice(0, 80));
  }
  return parts.join("\n").slice(0, 4096);
}

export async function readIndex(): Promise<ThreadIndexEntry[]> {
  const got = (await browser.storage.local.get(HISTORY_INDEX_KEY)) as Record<string, unknown>;
  const raw: unknown = got[HISTORY_INDEX_KEY];
  if (!Array.isArray(raw)) return [];
  return (raw as unknown[]).filter(
    (e): e is ThreadIndexEntry =>
      typeof e === "object" && e !== null && typeof (e as Record<string, unknown>)["threadId"] === "string",
  );
}

export async function syncIndexEntry(record: ThreadRecord): Promise<void> {
  const index = await readIndex();
  const entry: ThreadIndexEntry = {
    threadId: record.id,
    title: record.title,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    messageCount: record.messages.length,
    searchBlob: buildSearchBlob(record.title, record.messages),
    pinned: record.pinned,
  };
  const at = index.findIndex((e) => e.threadId === record.id);
  if (at >= 0) index[at] = entry;
  else index.push(entry);
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  await browser.storage.local.set({ [HISTORY_INDEX_KEY]: index });
}

export async function removeIndexEntry(threadId: string): Promise<void> {
  const index = (await readIndex()).filter((e) => e.threadId !== threadId);
  await browser.storage.local.set({ [HISTORY_INDEX_KEY]: index });
}

/** Rebuild a missing/corrupt index by scanning stored thread records. */
export async function rebuildIndex(): Promise<ThreadIndexEntry[]> {
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
  const records: ThreadRecord[] = [];
  for (const [key, raw] of Object.entries(all)) {
    if (!key.startsWith("history:v1:") || key === HISTORY_INDEX_KEY) continue;
    if (isRecord(raw)) records.push(raw);
  }
  const index: ThreadIndexEntry[] = records.map((r) => ({
    threadId: r.id,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    messageCount: r.messages.length,
    searchBlob: buildSearchBlob(r.title, r.messages),
    pinned: r.pinned,
  }));
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  await browser.storage.local.set({ [HISTORY_INDEX_KEY]: index });
  return index;
}

export interface SearchResult {
  threadId: string;
  title: string;
  updatedAt: number;
  snippet: string;
  score: number;
}

export type ThreadLoader = (threadId: string) => Promise<ThreadRecord | null | undefined>;

const TITLE_WEIGHT = 5;
const USER_WEIGHT = 3;
const ASSISTANT_WEIGHT = 1;
const TOOL_WEIGHT = 1;

/** Word tokens via Intl.Segmenter (locale default), lowercased. */
export function tokenize(text: string): string[] {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });
  const out: string[] = [];
  for (const segment of segmenter.segment(text.toLowerCase())) {
    if (segment.isWordLike) out.push(segment.segment);
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let at = haystack.toLowerCase().indexOf(needle);
  while (at >= 0) {
    count += 1;
    at = haystack.toLowerCase().indexOf(needle, at + needle.length);
  }
  return count;
}

function excerpt(text: string, needle: string, radius = 40): string {
  const at = text.toLowerCase().indexOf(needle.toLowerCase());
  if (at < 0) return text.slice(0, radius * 2);
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needle.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}

/**
 * Ranked search over thread entries. Builds an in-memory inverted index over
 * titles + searchBlobs for candidate selection, then scores full records
 * with role weights (title x5, user x3, assistant x1, toolName x1).
 */
export async function searchThreads(
  entries: ThreadIndexEntry[],
  query: string,
  loadThread: ThreadLoader,
): Promise<SearchResult[]> {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];

  const posting = new Map<string, Set<string>>();
  for (const entry of entries) {
    for (const token of new Set(tokenize(`${entry.title}\n${entry.searchBlob}`))) {
      const set = posting.get(token) ?? new Set<string>();
      set.add(entry.threadId);
      posting.set(token, set);
    }
  }
  const candidates = new Set<string>();
  for (const token of tokens) {
    for (const id of posting.get(token) ?? []) candidates.add(id);
  }

  const results: SearchResult[] = [];
  for (const threadId of candidates) {
    const record = await loadThread(threadId);
    if (!record) continue;
    let score = 0;
    let snippet = "";
    for (const token of tokens) {
      score += countOccurrences(record.title, token) * TITLE_WEIGHT;
      if (snippet === "" && record.title.toLowerCase().includes(token)) {
        snippet = excerpt(record.title, token);
      }
      for (const m of record.messages) {
        const weight =
          m.role === "user" ? USER_WEIGHT : m.role === "assistant" ? ASSISTANT_WEIGHT : TOOL_WEIGHT;
        score += countOccurrences(m.content, token) * weight;
        if (m.toolName) score += countOccurrences(m.toolName, token) * TOOL_WEIGHT;
        if (snippet === "" && m.content.toLowerCase().includes(token)) {
          snippet = excerpt(m.content, token);
        }
      }
    }
    if (score > 0) {
      results.push({ threadId, title: record.title, updatedAt: record.updatedAt, snippet, score });
    }
  }
  results.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return results;
}
