import { describe, expect, it } from "vitest";
import {
  createConversation,
  deleteConversation,
  listConversations,
  loadConversation,
  saveConversation,
} from "../../src/storage/conversations";
import { getProviders, removeProvider, resolveModel, saveSettings, getSettings, upsertProvider } from "../../src/storage/settings";

describe("provider settings", () => {
  it("starts with OpenRouter and OpenCode Go presets", async () => {
    const providers = await getProviders();
    expect(providers.map((p) => p.id)).toEqual(["openrouter", "opencode-go"]);
    expect(providers[1]!.baseUrl).toBe("https://opencode.ai/zen/go/v1");
    expect(providers.every((p) => p.apiKey === "")).toBe(true);
  });

  it("adds, updates, and removes providers", async () => {
    await upsertProvider({ id: "c1", name: "Mine", baseUrl: "https://x/v1", apiKey: "k", wire: "chat", models: [{ id: "m", vision: false, tools: true }] });
    expect((await getProviders()).map((p) => p.id)).toContain("c1");
    await saveSettings({ model: { providerId: "c1", modelId: "m" } });
    expect(resolveModel(await getProviders(), (await getSettings()).model)?.model.id).toBe("m");
    await removeProvider("c1");
    expect((await getProviders()).map((p) => p.id)).not.toContain("c1");
    expect((await getSettings()).model).toBeNull();
  });
});

describe("conversations", () => {
  it("saves, lists, searches, and deletes", async () => {
    const conv = createConversation(null);
    conv.title = "Flights to Tokyo";
    conv.messages = [{ id: "u", role: "user", text: "cheapest flight to tokyo", createdAt: 1 }];
    conv.api = [{ role: "user", content: [{ type: "text", text: "see" }, { type: "image", dataUrl: "data:x" }] }];
    await saveConversation(conv);

    expect((await listConversations()).map((c) => c.id)).toEqual([conv.id]);
    expect(await listConversations("tokyo")).toHaveLength(1);
    expect(await listConversations("paris")).toHaveLength(0);

    const loaded = await loadConversation(conv.id);
    expect(loaded?.api[0]!.content).toEqual([
      { type: "text", text: "see" },
      { type: "text", text: "[screenshot omitted]" },
    ]);

    await deleteConversation(conv.id);
    expect(await listConversations()).toHaveLength(0);
    expect(await loadConversation(conv.id)).toBeNull();
  });

  it("does not save empty chats", async () => {
    await saveConversation(createConversation(null));
    expect(await listConversations()).toHaveLength(0);
  });
});
