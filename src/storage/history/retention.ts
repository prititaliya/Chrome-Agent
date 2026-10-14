// Retention: keep-N cap + quota-probe eviction with hysteresis.
// Never evicts the open thread or pinned threads. Overflow beyond protected
// threads refuses the write path with a visible state — never silent loss.

import { browser } from "wxt/browser";
import { getSettings } from "../settings";
import { deleteThread, getThread, listThreads, saveThread } from "./store";

export const EVICT_AT_FRACTION = 0.8;
export const EVICT_TARGET_FRACTION = 0.6;
export const THREAD_SOFT_CAP_BYTES = 1_000_000;

export interface QuotaInfo {
  usedBytes: number;
  quota: number;
}

export interface RetentionOptions {
  keepN?: number;
  openThreadId?: string;
}

export interface RetentionResult extends QuotaInfo {
  evicted: string[];
  /** True when only protected threads remain but quota is still exceeded. */
  refused: boolean;
}

function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export async function probeQuota(): Promise<QuotaInfo> {
  const local = browser.storage.local as unknown as {
    getBytesInUse?: () => Promise<number>;
    QUOTA_BYTES?: number;
    get: (keys: string | string[] | null) => Promise<Record<string, unknown>>;
  };
  let usedBytes: number | undefined;
  try {
    usedBytes = await local.getBytesInUse?.();
  } catch {
    usedBytes = undefined;
  }
  if (typeof usedBytes !== "number") {
    const all: Record<string, unknown> = await local.get(null);
    usedBytes = Object.values(all).reduce<number>((sum, v) => sum + byteLength(v), 0);
  }
  const quota =
    typeof local.QUOTA_BYTES === "number" ? local.QUOTA_BYTES : (await getSettings()).historySoftQuotaBytes;
  return { usedBytes, quota };
}

/** Trim one thread to the per-thread soft cap, keeping a summary stub. */
export async function enforceThreadCap(threadId: string): Promise<boolean> {
  const record = await getThread(threadId);
  if (!record) return false;
  if (byteLength(record) <= THREAD_SOFT_CAP_BYTES) return false;
  const [first, ...rest] = record.messages;
  if (!first) return false;
  const kept = rest.slice(-20);
  record.messages = [
    first,
    {
      id: "trim-stub",
      threadId,
      role: "system",
      ts: Date.now(),
      content: `[history trimmed to fit the per-thread cap; ${rest.length - kept.length} older messages summarized away]`,
    },
    ...kept,
  ];
  await saveThread(record);
  return true;
}

export async function enforceRetention(options: RetentionOptions = {}): Promise<RetentionResult> {
  const settings = await getSettings();
  const keepN = options.keepN ?? settings.keepNMostRecentThreads;
  const evicted: string[] = [];

  const isProtected = (id: string, pinned?: boolean) => id === options.openThreadId || pinned === true;

  // 1. keep-N cap first (oldest non-protected beyond keepN go).
  const threads = await listThreads();
  // pinned flag lives on the record, not the index: resolve it.
  const pinnedById = new Map<string, boolean>();
  for (const t of threads) {
    const record = await getThread(t.threadId);
    pinnedById.set(t.threadId, record?.pinned === true);
  }
  const evictable = [...threads]
    .reverse()
    .filter((t) => !isProtected(t.threadId, pinnedById.get(t.threadId)));
  // Total threads beyond keepN must go; protected ones never do, so evict
  // oldest-first up to the overflow (or fewer when only protected remain).
  const overKeep = threads.length - Math.max(0, keepN);
  for (let i = 0; i < overKeep && i < evictable.length; i += 1) {
    const victim = evictable[i];
    if (!victim) break;
    await deleteThread(victim.threadId);
    evicted.push(victim.threadId);
  }

  // 2. Per-thread soft caps.
  for (const t of await listThreads()) {
    await enforceThreadCap(t.threadId);
  }

  // 3. Quota probe with hysteresis.
  let quota = await probeQuota();
  let guard = 0;
  while (quota.usedBytes >= EVICT_AT_FRACTION * quota.quota && guard < 500) {
    guard += 1;
    const live = await listThreads();
    const next = [...live].reverse().find((t) => !isProtected(t.threadId, pinnedById.get(t.threadId)));
    if (!next) break;
    await deleteThread(next.threadId);
    evicted.push(next.threadId);
    pinnedById.delete(next.threadId);
    quota = await probeQuota();
    if (quota.usedBytes <= EVICT_TARGET_FRACTION * quota.quota) break;
  }

  quota = await probeQuota();
  const refused =
    quota.usedBytes >= EVICT_AT_FRACTION * quota.quota &&
    (await listThreads()).every((t) => isProtected(t.threadId, pinnedById.get(t.threadId)));
  return { usedBytes: quota.usedBytes, quota: quota.quota, evicted, refused };
}
