import { beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import type { ContentRequest } from "../../src/browser/protocol";
import type { TabInfo } from "../../src/browser/tabs";

const state = vi.hoisted(() => ({
  tabs: [] as TabInfo[],
  listCalls: 0,
  afterClick: null as TabInfo[] | null,
  sent: [] as { tabId: number; type: string }[],
  /** Login-state answers, one per cs/loginState request. */
  login: [] as { username: string; passwordFilled: boolean; hasPassword: boolean }[],
}));

vi.mock("../../src/browser/tabs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/browser/tabs")>();
  return {
    ...actual,
    getTab: async (id: number) => state.tabs.find((t) => t.id === id) ?? null,
    getActiveTab: async () => state.tabs.find((t) => t.active) ?? null,
    listTabs: async () => {
      state.listCalls++;
      if (state.listCalls > 1 && state.afterClick) state.tabs = state.afterClick;
      return state.tabs;
    },
  };
});

vi.mock("../../src/browser/content", () => ({
  isScriptableUrl: () => true,
  waitForTabLoad: async () => undefined,
  sendToTab: async (tabId: number, req: ContentRequest) => {
    state.sent.push({ tabId, type: req.type });
    if (req.type === "cs/target") {
      const facts = { tag: "a", role: "link", name: "Docs", inputType: "", href: "/docs", isSubmit: false, inForm: false, formHasPassword: false, formHasPayment: false, formIsSearch: false, formAction: "" };
      return { ok: true, kind: "target", target: { x: 1, y: 1, facts } };
    }
    if (req.type === "cs/loginState") return { ok: true, kind: "login", ...state.login.shift()! };
    return { ok: true, kind: "done", note: "ok" };
  },
}));

const { ToolExecutor, sameSite } = await import("../../src/tools/executor");
type Deps = ConstructorParameters<typeof ToolExecutor>[0];

const tab = (id: number, url: string, active = false): TabInfo => ({ id, title: `Tab ${id}`, url, active });
const noop = () => {};
const deps = { controlMode: "dom", cdp: { detachAll: async () => {} }, riskyAllowed: () => true } as unknown as Deps;

beforeEach(() => {
  state.tabs = [tab(1, "https://www.shop.test/home", true)];
  state.listCalls = 0;
  state.afterClick = null;
  state.sent = [];
  state.login = [];
});

describe("working tab", () => {
  it("compares sites by host, ignoring www and non-web URLs", () => {
    expect(sameSite("https://www.shop.test/a", "https://shop.test/b?x=1")).toBe(true);
    expect(sameSite("https://shop.test/", "https://other.test/")).toBe(false);
    expect(sameSite("chrome://newtab/", "chrome://newtab/")).toBe(false);
  });

  it("opens same-site URLs in the working tab instead of a new tab", async () => {
    const update = vi.spyOn(browser.tabs, "update").mockResolvedValue({} as never);
    const create = vi.spyOn(browser.tabs, "create");
    const executor = new ToolExecutor(deps, 1);
    const out = await executor.execute({ id: "1", name: "open_tab", args: '{"url":"https://shop.test/cart"}' }, noop);
    expect(out.ok).toBe(true);
    expect(out.text).toContain("Opened in the working tab instead of a new tab");
    expect(update).toHaveBeenCalledWith(1, { url: "https://shop.test/cart" });
    expect(create).not.toHaveBeenCalled();
    expect(executor.workingTabId).toBe(1);
  });

  it("still opens other sites in a new tab", async () => {
    const create = vi.spyOn(browser.tabs, "create").mockImplementation(async () => {
      state.tabs = [...state.tabs, tab(2, "https://news.test/")];
      return { id: 2 } as never;
    });
    const executor = new ToolExecutor(deps, 1);
    const out = await executor.execute({ id: "1", name: "open_tab", args: '{"url":"news.test"}' }, noop);
    expect(out.ok).toBe(true);
    expect(create).toHaveBeenCalledWith({ url: "https://news.test", active: true });
    expect(executor.workingTabId).toBe(2);
  });

  it("follows a new tab that a click brought to the front", async () => {
    state.afterClick = [tab(1, "https://www.shop.test/home"), tab(7, "https://www.shop.test/docs", true)];
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ status: "complete" } as never);
    const executor = new ToolExecutor(deps, 1);
    const out = await executor.execute({ id: "1", name: "click", args: '{"ref":3}' }, noop);
    expect(out.ok).toBe(true);
    expect(out.text).toContain("now working in it");
    expect(executor.workingTabId).toBe(7);
    expect(state.sent).toContainEqual({ tabId: 7, type: "cs/agentActive" });
  });

  it("fills a saved login through Chrome's suggestion and never reports the password", async () => {
    vi.spyOn(browser.tabs, "get").mockResolvedValue({ active: true, status: "complete" } as never);
    const keys: string[] = [];
    const cdp = {
      ensureAttached: async () => false,
      click: async () => {},
      press: async (_: number, key: string) => void keys.push(key),
      send: async () => ({}),
      detachAll: async () => {},
    };
    const executor = new ToolExecutor({ ...deps, controlMode: "cdp", cdp } as unknown as Deps, 1);

    state.login = [
      { username: "jatin@example.com", passwordFilled: false, hasPassword: true },
      { username: "jatin@example.com", passwordFilled: true, hasPassword: true },
    ];
    const ok = await executor.execute({ id: "1", name: "use_saved_password", args: '{"ref":2}' }, noop);
    expect(ok).toMatchObject({ ok: true });
    expect(ok.text).toContain('Chrome filled the saved login for "jatin@example.com"');
    expect(keys).toEqual(["ArrowDown", "Tab"]);

    state.login = [
      { username: "", passwordFilled: false, hasPassword: true },
      { username: "", passwordFilled: false, hasPassword: true },
    ];
    const none = await executor.execute({ id: "2", name: "use_saved_password", args: '{"ref":2}' }, noop);
    expect(none.ok).toBe(false);
    expect(none.text).toContain("Do not guess a password");
  });

  it("reads email codes and the user's address from Gmail", async () => {
    const fetchInbox = async () => ({
      account: "jatin@gmail.com",
      items: [{ from: "GitHub", fromEmail: "noreply@github.com", subject: "Sign-in code", summary: "Your code is 482913", received: Date.now() - 60_000 }],
    });
    const executor = new ToolExecutor({ ...deps, fetchInbox, profileEmail: async () => "jatin@work.test" } as unknown as Deps, 1);
    const code = await executor.execute({ id: "1", name: "get_email_code", args: '{"from":"github","wait_seconds":0}' }, noop);
    expect(code).toEqual({ ok: true, text: 'Code 482913 from GitHub ("Sign-in code"), received 1 min ago.' });
    const missing = await executor.execute({ id: "2", name: "get_email_code", args: '{"from":"amazon","wait_seconds":0}' }, noop);
    expect(missing.ok).toBe(false);
    expect(missing.text).toContain("mail.google.com");
    const email = await executor.execute({ id: "3", name: "get_my_email", args: "{}" }, noop);
    expect(email.text).toContain("Chrome profile: jatin@work.test");
    expect(email.text).toContain("Signed in to Gmail as: jatin@gmail.com");
  });

  it("glows the working tab on its first page action, not only on clicks", async () => {
    const executor = new ToolExecutor(deps, 1);
    await executor.execute({ id: "1", name: "snapshot", args: "{}" }, noop);
    expect(state.sent[0]).toEqual({ tabId: 1, type: "cs/agentActive" });
  });
});
