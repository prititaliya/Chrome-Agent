// Durable local-only transcripts in `storage.local` (never `storage.sync`).
// Single writer: only the background imports this module. The UI reads and
// mutates exclusively through background RPC (see protocol history commands).

import { browser } from "wxt/browser";
import { redactSecrets } from "../../security/redact";
import { ulid } from "../../lib/ulid";
import { readIndex, removeIndexEntry, syncIndexEntry } from "./index";

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface Envelope {
  id: string;
  threadId: string;
  role: MessageRole;
  ts: number;
  content: string;
  toolCallId?: string;
  toolName?: string;
  artifactRefs?: string[];
  outcomeUnknown?: boolean;
}

export interface ArtifactMeta {
  kind: "screenshot" | "extract";
  meta: Record<string, unknown>;
}

export type ThreadOutcome = "done" | "cancelled" | "budget_paused" | "failed";

export interface ThreadRecord {
  id: string;
  title: string;
  titleSource: "derived" | "user";
  createdAt: number;
  updatedAt: number;
  origin?: string;
  /** Pinned threads are never evicted and excluded from bulk delete. */
  pinned?: boolean;
  messages: Envelope[];
  artifacts?: Record<string, ArtifactMeta>;
  outcome?: ThreadOutcome;
  schemaVersion: 1;
}

export interface ThreadIndexEntry {
  threadId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  searchBlob: string;
  pinned?: boolean;
}

export const HISTORY_INDEX_KEY = "history:v1:index";
export const SCHEMA_VERSION = 1 as const;

export function threadKey(threadId: string): string {
  return `history:v1:${threadId}`;
}

export function blobKey(threadId: string, artifactId: string): string {
  return `history:blob:${threadId}:${artifactId}`;
}

function isRecord(raw: unknown): raw is ThreadRecord {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    typeof r["id"] === "string" &&
    typeof r["title"] === "string" &&
    Array.isArray(r["messages"]) &&
    r["schemaVersion"] === SCHEMA_VERSION
  );
}

async function readRecord(threadId: string): Promise<ThreadRecord | undefined> {
  const got = (await browser.storage.local.get(threadKey(threadId))) as Record<string, unknown>;
  const raw: unknown = got[threadKey(threadId)];
  return isRecord(raw) ? raw : undefined;
}

async function writeRecord(record: ThreadRecord): Promise<void> {
  record.updatedAt = Date.now();
  await browser.storage.local.set({ [threadKey(record.id)]: record });
  await syncIndexEntry(record);
}

export function deriveTitle(firstUserText: string): string {
  const flat = firstUserText.replace(/\s+/g, " ").trim();
  if (flat === "") return "Untitled thread";
  return flat.length > 60 ? `${flat.slice(0, 60)}…` : flat;
}

export async function createThread(options: {
  id?: string;
  title?: string;
  origin?: string;
  firstMessage?: { role: MessageRole; content: string };
}): Promise<ThreadRecord> {
  const now = Date.now();
  const first = options.firstMessage;
  const record: ThreadRecord = {
    id: options.id ?? ulid(),
    title: options.title ?? (first ? deriveTitle(first.content) : "Untitled thread"),
    titleSource: options.title ? "user" : "derived",
    createdAt: now,
    updatedAt: now,
    origin: options.origin,
    messages: [],
    schemaVersion: SCHEMA_VERSION,
  };
  if (first) {
    record.messages.push({
      id: ulid(),
      threadId: record.id,
      role: first.role,
      ts: now,
      content: redactSecrets(first.content),
    });
  }
  await writeRecord(record);
  return record;
}

export async function appendMessage(
  threadId: string,
  message: {
    role: MessageRole;
    content: string;
    toolCallId?: string;
    toolName?: string;
    artifactRefs?: string[];
    outcomeUnknown?: boolean;
  },
): Promise<Envelope> {
  const record = await readRecord(threadId);
  if (!record) throw new Error(`Unknown thread "${threadId}"`);
  const envelope: Envelope = {
    id: ulid(),
    threadId,
    role: message.role,
    ts: Date.now(),
    content: redactSecrets(message.content),
    toolCallId: message.toolCallId,
    toolName: message.toolName,
    artifactRefs: message.artifactRefs,
    outcomeUnknown: message.outcomeUnknown,
  };
  record.messages.push(envelope);
  await writeRecord(record);
  return envelope;
}

export async function getThread(threadId: string): Promise<ThreadRecord | undefined> {
  return readRecord(threadId);
}

export async function listThreads(): Promise<ThreadIndexEntry[]> {
  return readIndex();
}

export async function renameThread(threadId: string, title: string): Promise<ThreadRecord> {
  const record = await readRecord(threadId);
  if (!record) throw new Error(`Unknown thread "${threadId}"`);
  record.title = title.trim() === "" ? record.title : title;
  record.titleSource = "user";
  await writeRecord(record);
  return record;
}

export async function finalizeThread(threadId: string, outcome: ThreadOutcome): Promise<void> {
  const record = await readRecord(threadId);
  if (!record) return;
  record.outcome = outcome;
  await writeRecord(record);
}

export async function setPinned(threadId: string, pinned: boolean): Promise<void> {
  const record = await readRecord(threadId);
  if (!record) throw new Error(`Unknown thread "${threadId}"`);
  record.pinned = pinned;
  await writeRecord(record);
}

/** Direct record save (retention trimming). Refreshes updatedAt + index. */
export async function saveThread(record: ThreadRecord): Promise<void> {
  await writeRecord(record);
}

/**
 * Exact record write (import path): preserves id, timestamps, and messages
 * byte-for-byte, then syncs the index. The record must already be validated.
 */
export async function putThreadExact(record: ThreadRecord): Promise<void> {
  await browser.storage.local.set({ [threadKey(record.id)]: record });
  await syncIndexEntry(record);
}

export async function deleteThread(threadId: string): Promise<void> {
  await browser.storage.local.remove(threadKey(threadId));
  // Remove orphaned artifact bytes belonging to this thread.
  const all = (await browser.storage.local.get(null)) as Record<string, unknown>;
  const prefix = `history:blob:${threadId}:`;
  const doomed = Object.keys(all).filter((k) => k.startsWith(prefix));
  if (doomed.length > 0) await browser.storage.local.remove(doomed);
  await removeIndexEntry(threadId);
}

export async function cloneThread(threadId: string): Promise<ThreadRecord> {
  const source = await readRecord(threadId);
  if (!source) throw new Error(`Unknown thread "${threadId}"`);
  const now = Date.now();
  const copy: ThreadRecord = {
    ...source,
    id: ulid(),
    title: `${source.title} (copy)`,
    titleSource: "derived",
    createdAt: now,
    updatedAt: now,
    messages: source.messages.map((m) => ({ ...m, id: ulid(), threadId: "" })),
  };
  for (const m of copy.messages) m.threadId = copy.id;
  await writeRecord(copy);
  return copy;
}

/** Re-exported from index.ts for callers that only need the store surface. */
export { rebuildIndex } from "./index";

export async function saveBlob(threadId: string, artifactId: string, bytes: Uint8Array): Promise<void> {
  await browser.storage.local.set({ [blobKey(threadId, artifactId)]: [...bytes] });
}

export async function readBlob(threadId: string, artifactId: string): Promise<Uint8Array | undefined> {
  const got = (await browser.storage.local.get(blobKey(threadId, artifactId))) as Record<string, unknown>;
  const raw: unknown = got[blobKey(threadId, artifactId)];
  return Array.isArray(raw) ? new Uint8Array(raw as number[]) : undefined;
}
