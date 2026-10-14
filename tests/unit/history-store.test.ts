import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import {
  appendMessage,
  cloneThread,
  createThread,
  deleteThread,
  finalizeThread,
  getThread,
  listThreads,
  readBlob,
  rebuildIndex,
  renameThread,
  saveBlob,
} from "../../src/storage/history/store";
import { HISTORY_INDEX_KEY } from "../../src/storage/history/store";

describe("history store", () => {
  it("writes a thread and updates the index", async () => {
    const thread = await createThread({
      id: "t1",
      firstMessage: { role: "user", content: "what does this page cost?" },
    });
    expect(thread.title).toBe("what does this page cost?");
    await appendMessage("t1", { role: "assistant", content: "It costs $12.50." });
    const index = await listThreads();
    expect(index).toHaveLength(1);
    expect(index[0]?.messageCount).toBe(2);
    expect(index[0]?.searchBlob).toContain("12.50");
  });

  it("reopens identical messages after a fresh handle (survives reload)", async () => {
    await createThread({ id: "t1", firstMessage: { role: "user", content: "hello" } });
    await appendMessage("t1", {
      role: "assistant",
      content: "hi",
      toolCallId: "c1",
      toolName: "browser_snapshot",
    });
    const reopened = await getThread("t1");
    expect(reopened?.messages.map((m) => [m.role, m.content, m.toolCallId, m.toolName])).toEqual([
      ["user", "hello", undefined, undefined],
      ["assistant", "hi", "c1", "browser_snapshot"],
    ]);
  });

  it("renames, clones, and deletes threads", async () => {
    await createThread({ id: "t1", firstMessage: { role: "user", content: "a" } });
    await renameThread("t1", "Renamed");
    expect((await getThread("t1"))?.title).toBe("Renamed");
    const copy = await cloneThread("t1");
    expect(copy.id).not.toBe("t1");
    expect(copy.title).toBe("Renamed (copy)");
    await finalizeThread(copy.id, "done");
    expect((await getThread(copy.id))?.outcome).toBe("done");
    await deleteThread("t1");
    expect(await getThread("t1")).toBeUndefined();
    expect((await listThreads()).map((t) => t.threadId)).toEqual([copy.id]);
  });

  it("deletes orphaned artifact bytes with the thread", async () => {
    await createThread({ id: "t1" });
    await saveBlob("t1", "shot1", new Uint8Array([1, 2, 3]));
    expect(await readBlob("t1", "shot1")).toEqual(new Uint8Array([1, 2, 3]));
    await deleteThread("t1");
    expect(await readBlob("t1", "shot1")).toBeUndefined();
  });

  it("rebuilds a missing or corrupt index from records", async () => {
    await createThread({ id: "t1", firstMessage: { role: "user", content: "price check" } });
    await fakeBrowser.storage.local.remove(HISTORY_INDEX_KEY);
    expect(await listThreads()).toEqual([]);
    const rebuilt = await rebuildIndex();
    expect(rebuilt).toHaveLength(1);
    expect(rebuilt[0]?.searchBlob).toContain("price check");
    await fakeBrowser.storage.local.set({ [HISTORY_INDEX_KEY]: "garbage" });
    const rebuiltAgain = await rebuildIndex();
    expect(rebuiltAgain).toHaveLength(1);
  });

  it("redacts key material at persist time", async () => {
    await createThread({ id: "t1" });
    const envelope = await appendMessage("t1", {
      role: "user",
      content: "my key is sk-live-abcdef1234567890 ok?",
    });
    expect(envelope.content).not.toContain("sk-live-");
    expect(envelope.content).toContain("[redacted]");
  });
});
