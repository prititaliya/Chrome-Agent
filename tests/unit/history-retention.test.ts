import { afterEach, describe, expect, it } from "vitest";
import { browser } from "wxt/browser";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { createThread, setPinned, threadKey, type ThreadRecord } from "../../src/storage/history/store";
import {
  enforceRetention,
  enforceThreadCap,
  EVICT_AT_FRACTION,
  EVICT_TARGET_FRACTION,
  probeQuota,
  THREAD_SOFT_CAP_BYTES,
} from "../../src/storage/history/retention";

function recordWithTs(threadId: string, updatedAt: number): ThreadRecord {
  const now = Date.now();
  return {
    id: threadId,
    title: threadId,
    titleSource: "derived",
    createdAt: updatedAt,
    updatedAt,
    messages: [{ id: "m", threadId, role: "user", ts: now, content: "hello" }],
    schemaVersion: 1,
  };
}

async function seedStaggered(ids: string[]): Promise<void> {
  const base = Date.now() - ids.length * 1000;
  for (const [i, id] of ids.entries()) {
    await browser.storage.local.set({ [threadKey(id)]: recordWithTs(id, base + i * 1000) });
  }
  // Rebuild the index through the public path.
  const { rebuildIndex } = await import("../../src/storage/history/index");
  await rebuildIndex();
}

describe("retention", () => {
  const REAL_QUOTA = 10_485_760;

  afterEach(() => {
    // The fake mirrors Chrome's ceiling and allows shrinking it to simulate
    // quota pressure through the real probe path. Always restore.
    (fakeBrowser.storage.local as unknown as { QUOTA_BYTES: number }).QUOTA_BYTES = REAL_QUOTA;
  });

  it("probes quota via getBytesInUse/QUOTA_BYTES (fake mirrors Chrome)", async () => {
    await createThread({ id: "t1", firstMessage: { role: "user", content: "hi" } });
    const quota = await probeQuota();
    expect(quota.quota).toBe(REAL_QUOTA);
    expect(quota.usedBytes).toBeGreaterThan(0);
  });

  it("enforces keep-N on the oldest non-protected threads", async () => {
    await seedStaggered(["k1", "k2", "k3", "k4", "k5"]);
    const result = await enforceRetention({ keepN: 3 });
    expect(result.evicted.sort()).toEqual(["k1", "k2"]);
    expect(result.refused).toBe(false);
  });

  it("never evicts the open thread or pinned threads", async () => {
    await seedStaggered(["p1", "p2", "p3"]);
    await setPinned("p1", true);
    const result = await enforceRetention({ keepN: 1, openThreadId: "p3" });
    // Only p2 is evictable; p1 pinned, p3 open.
    expect(result.evicted).toEqual(["p2"]);
  });

  it("evicts at >=80% quota down to <=60% (hysteresis)", async () => {
    (fakeBrowser.storage.local as unknown as { QUOTA_BYTES: number }).QUOTA_BYTES = 2000;
    await createThread({ id: "big", firstMessage: { role: "user", content: "x".repeat(1500) } });
    await createThread({ id: "small", firstMessage: { role: "user", content: "y" } });
    const before = await probeQuota();
    expect(before.usedBytes).toBeGreaterThanOrEqual(EVICT_AT_FRACTION * before.quota);
    const result = await enforceRetention({ keepN: 100 });
    expect(result.usedBytes).toBeLessThanOrEqual(EVICT_TARGET_FRACTION * result.quota);
    expect(result.evicted).toContain("big");
    expect(result.refused).toBe(false);
  });

  it("refuses instead of evicting when only protected threads remain", async () => {
    (fakeBrowser.storage.local as unknown as { QUOTA_BYTES: number }).QUOTA_BYTES = 1000;
    await createThread({ id: "only", firstMessage: { role: "user", content: "z".repeat(900) } });
    await setPinned("only", true);
    const result = await enforceRetention({ keepN: 100 });
    expect(result.refused).toBe(true);
    expect(result.evicted).toEqual([]);
  });

  it("trims a thread over the per-thread soft cap with a stub", async () => {
    const thread = await createThread({ id: "fat" });
    void thread;
    const { appendMessage, getThread } = await import("../../src/storage/history/store");
    for (let i = 0; i < 40; i += 1) {
      await appendMessage("fat", { role: "assistant", content: `payload-${i}-`.padEnd(30_000, ".") });
    }
    const trimmed = await enforceThreadCap("fat");
    expect(trimmed).toBe(true);
    const after = await getThread("fat");
    const bytes = new TextEncoder().encode(JSON.stringify(after)).length;
    expect(bytes).toBeLessThanOrEqual(THREAD_SOFT_CAP_BYTES);
    expect(after?.messages.some((m) => m.id === "trim-stub")).toBe(true);
  });
});
