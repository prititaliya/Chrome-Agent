import { describe, expect, it } from "vitest";
import {
  checkOriginPermission,
  ensureOriginPermission,
  getAllowedOrigins,
  getDeniedOrigins,
  originOfUrl,
  reinjectContentScripts,
  setOriginConsent,
} from "../../src/security/origins";
import { executeToolCall, TabGenerations } from "../../src/tools/executor";

describe("origins", () => {
  it("maps page URLs to origins, rejecting chrome:// and friends", () => {
    expect(originOfUrl("https://example.com/page?q=1")).toBe("https://example.com");
    expect(originOfUrl("http://localhost:4173/table.html")).toBe("http://localhost:4173");
    expect(originOfUrl("chrome://settings")).toBeNull();
    expect(originOfUrl("about:blank")).toBeNull();
    expect(originOfUrl("not a url")).toBeNull();
  });

  it("persists consent and reports checks without prompting", async () => {
    expect(await checkOriginPermission("https://example.com")).toBe("unknown");
    await setOriginConsent("https://example.com", true);
    expect(await getAllowedOrigins()).toEqual(["https://example.com"]);
    expect(await checkOriginPermission("https://example.com")).toBe("granted");
    await setOriginConsent("https://example.com", false);
    expect(await getDeniedOrigins()).toEqual(["https://example.com"]);
    expect(await checkOriginPermission("https://example.com")).toBe("denied");
  });

  it("ensureOriginPermission honors pre-listed origins without prompting", async () => {
    await setOriginConsent("https://allowed.test", true);
    expect(await ensureOriginPermission("https://allowed.test")).toBe("granted");
    await setOriginConsent("https://denied.test", false);
    expect(await ensureOriginPermission("https://denied.test")).toBe("denied");
  });

  it("selects content-script files by manifest match (no hardcoded paths)", async () => {
    const { contentScriptFilesForOrigin } = await import("../../src/security/origins");
    expect(
      contentScriptFilesForOrigin(
        [{ matches: ["<all_urls>"], js: ["content-scripts/content.js"] }],
        "https://example.com",
      ),
    ).toEqual(["content-scripts/content.js"]);
    expect(contentScriptFilesForOrigin([], "https://example.com")).toEqual([]);
  });

  it("re-inject is a safe no-op with no matching tabs", async () => {
    await reinjectContentScripts("https://nothing-here.test", [], { content_scripts: [] });
  });

  it("blocks dispatch on ungranted origins without touching the tab", async () => {
    await setOriginConsent("https://blocked.test", false);
    let sent = 0;
    const observation = await executeToolCall(
      { id: "c1", name: "browser_snapshot", args: {} },
      {
        sender: async () => {
          sent += 1;
          return { ok: true, kind: "snapshot", text: "x", snapshotGen: 1, truncated: false };
        },
        activeTab: async () => 42,
        getTabUrl: async () => "https://blocked.test/page",
        generations: new TabGenerations(),
      },
    );
    expect(observation.ok).toBe(false);
    expect(observation.text).toContain("E_NO_ORIGIN_PERMISSION");
    expect(sent).toBe(0);
  });
});
