// Long-term memory: short facts, preferences and standing instructions that
// persist across conversations. Stored only in this browser.

import { storage } from "wxt/utils/storage";

export interface Memory {
  id: string;
  text: string;
  createdAt: number;
  updatedAt: number;
  /** Who wrote it: the assistant (via the remember tool) or the user (Memory page). */
  source: "assistant" | "user";
  convId?: string;
}

export const MEMORY_MAX_CHARS = 300;
const MAX_MEMORIES = 500;
const memoryItem = storage.defineItem<Memory[]>("local:memory:v1", { fallback: [] });

const STOPWORDS = new Set(
  "the and for are but not you your with this that have has had was were what when where which who will would could should about into from they them their there then than does did doing can just like also very more most some such only over under again been being because each other our out own same too why how all any both few its it's i'm user user's prefers".split(
    " ",
  ),
);

export function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 3 && !STOPWORDS.has(w)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / (a.size + b.size - shared);
}

const normalize = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function findDuplicate(memories: Memory[], text: string): Memory | undefined {
  const norm = normalize(text);
  const words = tokens(text);
  return memories.find((m) => normalize(m.text) === norm || jaccard(tokens(m.text), words) >= 0.8);
}

const SENSITIVE: RegExp[] = [
  /\b(?:\d[ -]?){13,19}\b/, // card numbers
  /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{12,}/, // API keys
  /\b(?:password|passcode|passwd|cvv|api[ _-]?key|secret key|private key|seed phrase|one-time code|otp)\b/i,
  /\b\d{3}-\d{2}-\d{4}\b/, // US SSN
];

/** Why a memory must not be stored, or null if it is fine. */
export function rejectReason(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return "The memory is empty.";
  if (trimmed.length > MEMORY_MAX_CHARS) return `Keep memories under ${MEMORY_MAX_CHARS} characters; save the key fact only.`;
  if (SENSITIVE.some((re) => re.test(trimmed))) return "This looks like a password, key, or payment detail, which is never stored in memory.";
  return null;
}

function memoryId(): string {
  return `m${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
}

export async function listMemories(): Promise<Memory[]> {
  return memoryItem.getValue();
}

export function watchMemories(listener: (memories: Memory[]) => void): () => void {
  return memoryItem.watch((value) => listener(value ?? []));
}

export interface SaveResult {
  action: "added" | "updated" | "duplicate";
  memory: Memory;
}

/** Add a memory, or update `replacesId` / a near-duplicate instead of piling up copies. */
export async function saveMemory(input: { text: string; source: Memory["source"]; convId?: string; replacesId?: string }): Promise<SaveResult> {
  const reason = rejectReason(input.text);
  if (reason) throw new Error(reason);
  const text = input.text.trim();
  const now = Date.now();
  const list = await memoryItem.getValue();
  const target = (input.replacesId ? list.find((m) => m.id === input.replacesId) : undefined) ?? findDuplicate(list, text);
  if (target) {
    if (target.text === text) return { action: "duplicate", memory: target };
    const memory: Memory = { ...target, text, updatedAt: now, source: input.source };
    await memoryItem.setValue([memory, ...list.filter((m) => m.id !== target.id)]);
    return { action: "updated", memory };
  }
  const memory: Memory = { id: memoryId(), text, createdAt: now, updatedAt: now, source: input.source, convId: input.convId };
  await memoryItem.setValue([memory, ...list].slice(0, MAX_MEMORIES));
  return { action: "added", memory };
}

export async function updateMemoryText(id: string, text: string): Promise<void> {
  const reason = rejectReason(text);
  if (reason) throw new Error(reason);
  const list = await memoryItem.getValue();
  await memoryItem.setValue(list.map((m) => (m.id === id ? { ...m, text: text.trim(), updatedAt: Date.now(), source: "user" } : m)));
}

export async function deleteMemory(id: string): Promise<Memory | null> {
  const list = await memoryItem.getValue();
  const found = list.find((m) => m.id === id) ?? null;
  if (found) await memoryItem.setValue(list.filter((m) => m.id !== id));
  return found;
}

export async function clearMemories(): Promise<void> {
  await memoryItem.setValue([]);
}

/** Memories ranked by keyword overlap with `query`, then recency. */
export function searchMemories(memories: Memory[], query: string, limit = 10): Memory[] {
  const q = tokens(query);
  return memories
    .map((m) => ({ m, score: jaccard(tokens(m.text), q) + (normalize(m.text).includes(normalize(query)) && query.trim() !== "" ? 0.5 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || b.m.updatedAt - a.m.updatedAt)
    .slice(0, limit)
    .map((x) => x.m);
}

/**
 * Memories to put in the prompt: all of them when they fit the budget,
 * otherwise the most relevant to `query` topped up with the most recent.
 */
export function selectMemories(memories: Memory[], query: string, budgetChars = 3000): { selected: Memory[]; total: number } {
  const total = memories.length;
  const fits = (list: Memory[]) => list.reduce((n, m) => n + m.text.length + 12, 0) <= budgetChars;
  if (fits(memories)) return { selected: memories, total };
  const ranked = [...searchMemories(memories, query, memories.length), ...[...memories].sort((a, b) => b.updatedAt - a.updatedAt)];
  const selected: Memory[] = [];
  const seen = new Set<string>();
  let used = 0;
  for (const m of ranked) {
    if (seen.has(m.id)) continue;
    const cost = m.text.length + 12;
    if (used + cost > budgetChars) continue;
    seen.add(m.id);
    selected.push(m);
    used += cost;
  }
  return { selected, total };
}

export function formatMemories(memories: Memory[]): string {
  return memories.map((m) => `- [${m.id}] ${m.text}`).join("\n");
}
