import { describe, expect, it } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { deleteKey, hasKey, saveKey } from "../../src/storage/keys";

describe("key storage isolation", () => {
  it("saves an OpenRouter key to storage.local only", async () => {
    await saveKey("openrouter", "sk-test-123");
    expect(await hasKey("openrouter")).toBe(true);
    expect(await fakeBrowser.storage.local.get(null)).toEqual({ "key:v1:openrouter": "sk-test-123" });
  });

  it("never touches storage.sync or storage.session", async () => {
    await saveKey("openrouter", "sk-test-123");
    await deleteKey("openrouter");
    expect(await fakeBrowser.storage.sync.get(null)).toEqual({});
    expect(await fakeBrowser.storage.session.get(null)).toEqual({});
    expect(await hasKey("openrouter")).toBe(false);
  });

  it("blank save clears instead of storing", async () => {
    await saveKey("openrouter", "sk-test-123");
    await saveKey("openrouter", "   ");
    expect(await hasKey("openrouter")).toBe(false);
  });
});
