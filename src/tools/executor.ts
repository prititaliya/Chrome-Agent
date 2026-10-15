// Runs the model's tool calls against real tabs. Input goes through CDP
// (trusted events) when enabled, falling back to synthetic DOM events.

import { browser } from "wxt/browser";
import { clickRisk, keyRisk, typeRisk, type RiskVerdict } from "../agent/risk";
import type { CdpController } from "../browser/cdp";
import { isScriptableUrl, sendToTab, waitForTabLoad } from "../browser/content";
import { fetchGmailInbox, waitForCode, type Inbox } from "../browser/gmail";
import {
  POINTER_TRAVEL_MS,
  type ContentRequest,
  type ContentResponse,
  type PointerAction,
  type SearchEngine,
  type TargetInfo,
} from "../browser/protocol";
import { formatResults, webSearch } from "../browser/search";
import { formatTabList, getActiveTab, getTab, listTabs, normalizeUrl } from "../browser/tabs";
import type { ToolCall } from "../providers/types";

export interface ToolOutcome {
  ok: boolean;
  text: string;
  image?: string;
}

export interface ApprovalRequest {
  tool: string;
  label: string;
  reason: string;
}

export type ApprovalAnswer = "approve" | "deny" | "always";

/** Long-term memory operations; each returns the text reported back to the model. */
export interface MemoryTools {
  remember: (text: string, replacesId?: string) => Promise<string>;
  forget: (id: string) => Promise<string>;
  recall: (query: string) => Promise<string>;
}

export interface AskRequest {
  question: string;
  options: string[];
  multiple: boolean;
}

/** Earlier chats; each returns the text reported back to the model. */
export interface SessionTools {
  search: (args: { query?: string; since?: string; until?: string; limit?: number }) => Promise<string>;
  read: (id: string, args: { query?: string; offset?: number; maxChars?: number }) => Promise<string>;
}

export const ASK_SKIPPED = "User skipped the question; continue with your best judgment, or stop and explain.";

/** Trim, drop empties and duplicates, keep at most 6. */
export function cleanOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const text = str(item).replace(/\s+/g, " ").trim().slice(0, 120);
    if (text === "" || seen.has(text.toLowerCase())) continue;
    seen.add(text.toLowerCase());
    out.push(text);
    if (out.length === 6) break;
  }
  return out;
}

export interface ExecutorDeps {
  controlMode: "cdp" | "dom";
  searchEngine: SearchEngine;
  cdp: CdpController;
  approve: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  riskyAllowed: () => boolean;
  allowRisky: () => void;
  memory?: MemoryTools;
  /** Show a question card and wait; null means the user skipped. */
  ask?: (request: AskRequest) => Promise<string | null>;
  sessions?: SessionTools;
  /** Defaults to the user's Gmail inbox feed. */
  fetchInbox?: () => Promise<Inbox>;
  profileEmail?: () => Promise<string>;
}

async function chromeProfileEmail(): Promise<string> {
  const identity = (browser as { identity?: typeof browser.identity }).identity;
  if (!identity?.getProfileUserInfo) return "";
  const info = await identity.getProfileUserInfo({ accountStatus: "ANY" as never });
  return info.email ?? "";
}

const GMAIL_SEARCH_URL = "https://mail.google.com/mail/u/0/#search/newer_than%3A1h";

type Args = Record<string, unknown>;

const TAB_ACTIONS = new Set([
  "snapshot",
  "find_text",
  "click",
  "type",
  "select_option",
  "press_key",
  "scroll",
  "hover",
  "wait",
  "navigate",
  "go_back",
  "use_saved_password",
]);

function str(v: unknown): string {
  return typeof v === "string" ? v : v === undefined || v === null ? "" : String(v);
}
function int(v: unknown): number | undefined {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v.replace(/[^\d.-]/g, "")) : NaN;
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
}
function host(url: string): string {
  try {
    return new URL(normalizeUrl(url)).host || url;
  } catch {
    return url;
  }
}
function webHost(url: string): string {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) ? parsed.host.replace(/^www\./, "") : "";
  } catch {
    return "";
  }
}
export function sameSite(a: string, b: string): boolean {
  const site = webHost(a);
  return site !== "" && site === webHost(b);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function parseArgs(raw: string): Args | null {
  try {
    const parsed = JSON.parse(raw || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Args) : null;
  } catch {
    return null;
  }
}

/** Short human-readable label for the step list. */
export function describeCall(name: string, args: Args): string {
  const r = args["ref"] !== undefined ? ` [${str(args["ref"])}]` : "";
  switch (name) {
    case "get_page_text":
      return "Reading page";
    case "snapshot":
      return "Looking at page elements";
    case "find_text":
      return `Finding "${str(args["query"])}"`;
    case "extract":
      return `Extracting ${str(args["kind"])}`;
    case "screenshot":
      return "Taking screenshot";
    case "click":
      return `Clicking${r}`;
    case "type":
      return `Typing "${str(args["text"]).slice(0, 40)}"${r}`;
    case "select_option":
      return `Selecting "${str(args["value"])}"${r}`;
    case "press_key":
      return `Pressing ${str(args["key"])}`;
    case "scroll":
      return `Scrolling ${str(args["direction"])}`;
    case "hover":
      return `Hovering${r}`;
    case "wait":
      return args["text"] ? `Waiting for "${str(args["text"])}"` : `Waiting ${str(args["seconds"] ?? 1)}s`;
    case "navigate":
      return `Opening ${host(str(args["url"]))}`;
    case "go_back":
      return "Going back";
    case "list_tabs":
      return "Listing tabs";
    case "open_tab":
      return `New tab: ${host(str(args["url"]))}`;
    case "switch_tab":
      return `Switching to tab ${str(args["tab_id"])}`;
    case "close_tab":
      return `Closing tab ${str(args["tab_id"])}`;
    case "read_tab":
      return `Reading tab ${str(args["tab_id"])}`;
    case "read_url":
      return `Reading ${host(str(args["url"]))}`;
    case "web_search":
      return `Searching: ${str(args["query"])}`;
    case "get_my_email":
      return "Looking up your email address";
    case "use_saved_password":
      return `Filling saved login${r}`;
    case "get_email_code":
      return args["from"] ? `Checking Gmail for a code from ${str(args["from"])}` : "Checking Gmail for a code";
    case "remember":
      return `Remembering: ${str(args["text"]).slice(0, 80)}`;
    case "forget":
      return "Forgetting a memory";
    case "recall":
      return `Searching memory: ${str(args["query"])}`;
    case "ask_user":
      return `Asked: ${str(args["question"]).slice(0, 120)}`;
    case "search_sessions":
      return args["query"] ? `Searching earlier chats: ${str(args["query"])}` : "Listing earlier chats";
    case "read_session":
      return args["query"] ? `Reading an earlier chat for "${str(args["query"])}"` : "Reading an earlier chat";
    default:
      return name;
  }
}

export class ToolExecutor {
  workingTabId: number | null;
  private readonly glowing = new Set<number>();
  private statusLabel = "Working";

  constructor(
    private readonly deps: ExecutorDeps,
    startTabId: number | null,
  ) {
    this.workingTabId = startTabId;
  }

  private async tabFor(args: Args): Promise<number> {
    const explicit = int(args["tab_id"]);
    if (explicit !== undefined) {
      if (!(await getTab(explicit))) throw new Error(`Tab ${explicit} does not exist. Call list_tabs.`);
      return explicit;
    }
    if (this.workingTabId !== null && (await getTab(this.workingTabId))) return this.workingTabId;
    const active = await getActiveTab();
    if (!active) throw new Error("No tab is open.");
    this.workingTabId = active.id;
    return active.id;
  }

  private async content(tabId: number, req: ContentRequest): Promise<ContentResponse> {
    return sendToTab(tabId, req);
  }

  private async pageState(tabId: number): Promise<string> {
    const tab = await getTab(tabId);
    return tab ? `Tab ${tabId} now shows: "${tab.title}" — ${tab.url}` : `Tab ${tabId} was closed.`;
  }

  private async navigateTab(tabId: number, url: string): Promise<string> {
    await browser.tabs.update(tabId, { url });
    await waitForTabLoad(tabId, 20_000);
    this.workingTabId = tabId;
    await this.glow(tabId, true);
    return this.pageState(tabId);
  }

  /** After a click: if the page opened a new tab in front, keep working in it. */
  private async followNewTab(tabsBefore: Set<number>): Promise<string> {
    const opened = (await listTabs()).filter((t) => !tabsBefore.has(t.id));
    const front = opened.length === 1 && opened[0]!.active ? opened[0]! : null;
    if (!front) return opened.length > 0 ? ` New background tab(s) opened: ${opened.map((t) => t.id).join(", ")}.` : "";
    await waitForTabLoad(front.id, 15_000);
    this.workingTabId = front.id;
    await this.glow(front.id);
    return ` The click opened a new tab; now working in it. ${await this.pageState(front.id)}. Call snapshot before the next action.`;
  }

  /** Let the page react; follow navigations to completion. */
  private async settle(tabId: number, urlBefore: string): Promise<string> {
    await sleep(500);
    const tab = await getTab(tabId);
    if (tab && (tab.url !== urlBefore || (await browser.tabs.get(tabId)).status === "loading")) {
      await waitForTabLoad(tabId, 10_000);
      await sleep(300);
      if (this.glowing.has(tabId)) await this.glow(tabId, true);
    }
    const after = await getTab(tabId);
    const navigated = after && after.url !== urlBefore ? " The page navigated; refs are stale, call snapshot before the next action." : "";
    return `${await this.pageState(tabId)}.${navigated}`;
  }

  private async useCdp(tabId: number): Promise<boolean> {
    if (this.deps.controlMode !== "cdp") return false;
    try {
      const tab = await browser.tabs.get(tabId);
      if (!tab.active) {
        await browser.tabs.update(tabId, { active: true });
        await sleep(250);
      }
      const fresh = await this.deps.cdp.ensureAttached(tabId);
      // The debugging infobar resizes the viewport on first attach; wait before measuring.
      if (fresh) await sleep(450);
      return true;
    } catch {
      return false;
    }
  }

  private async target(tabId: number, ref: number, action: PointerAction): Promise<TargetInfo> {
    const response = await this.content(tabId, { type: "cs/target", ref });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== "target") throw new Error("Unexpected response from page.");
    await this.pointAt(tabId, ref, action);
    return response.target;
  }

  /** Glide the on-page cursor to the element and wait until it arrives, so the action lands under it. */
  private async pointAt(tabId: number, ref: number, action: PointerAction): Promise<void> {
    await this.content(tabId, { type: "cs/highlight", ref, action }).catch(() => undefined);
    await sleep(POINTER_TRAVEL_MS);
  }

  private async gate(tool: string, label: string, verdict: RiskVerdict): Promise<string | null> {
    if (!verdict.risky || this.deps.riskyAllowed()) return null;
    const answer = await this.deps.approve({ tool, label, reason: verdict.reason });
    if (answer === "always") this.deps.allowRisky();
    if (answer === "deny") {
      return `The user declined this action (${verdict.reason}). Do not retry it; tell the user what you were about to do and ask how to proceed.`;
    }
    return null;
  }

  /** `force` re-applies the overlay after a navigation replaced the document. */
  private async glow(tabId: number, force = false): Promise<void> {
    if (this.glowing.has(tabId) && !force) return;
    this.glowing.add(tabId);
    await this.content(tabId, { type: "cs/agentActive", on: true, label: this.statusLabel }).catch(() => undefined);
  }

  /** Update the status pill on the page the agent is working in. */
  private async status(tabId: number, label: string): Promise<void> {
    this.statusLabel = label;
    await this.glow(tabId, true);
  }

  /** Briefly show a message in the working tab's status pill (e.g. after the user steers). */
  async flash(label: string): Promise<void> {
    const tabId = this.workingTabId;
    if (tabId === null || !this.glowing.has(tabId)) return;
    const previous = this.statusLabel;
    await this.status(tabId, label);
    await sleep(1500);
    if (this.statusLabel === label && this.glowing.has(tabId)) await this.status(tabId, previous);
  }

  async finish(): Promise<void> {
    for (const tabId of this.glowing) {
      await sendToTab(tabId, { type: "cs/agentActive", on: false }).catch(() => undefined);
    }
    this.glowing.clear();
    await this.deps.cdp.detachAll();
  }

  async execute(call: ToolCall, onLabel: (label: string) => void): Promise<ToolOutcome> {
    const args = parseArgs(call.args);
    if (!args) return { ok: false, text: `Invalid JSON arguments for ${call.name}: ${call.args.slice(0, 200)}` };
    try {
      return await this.run(call.name, args, onLabel);
    } catch (error) {
      return { ok: false, text: `Error: ${error instanceof Error ? error.message : String(error)}` };
    } finally {
      const tabId = this.workingTabId;
      if (TAB_ACTIONS.has(call.name) && tabId !== null && this.glowing.has(tabId)) await this.status(tabId, "Thinking");
    }
  }

  private async run(name: string, args: Args, onLabel: (label: string) => void): Promise<ToolOutcome> {
    if (TAB_ACTIONS.has(name)) {
      const tabId = await this.tabFor(args);
      await this.status(tabId, describeCall(name, args));
      const notify = onLabel;
      onLabel = (label) => {
        notify(label);
        void this.status(tabId, label);
      };
    }
    switch (name) {
      case "get_page_text":
      case "read_tab": {
        const tabId = name === "read_tab" ? int(args["tab_id"]) : await this.tabFor(args);
        if (tabId === undefined) throw new Error("tab_id is required.");
        const max = Math.min(int(args["max_chars"]) ?? 15_000, 40_000);
        const r = await this.content(tabId, { type: "cs/pageText", maxChars: max });
        if (!r.ok) throw new Error(r.error);
        if (r.kind !== "pageText") throw new Error("Unexpected response.");
        return { ok: true, text: `Title: ${r.title}\nURL: ${r.url}\n\n${r.text}${r.truncated ? "\n…[truncated]" : ""}` };
      }
      case "snapshot": {
        const tabId = await this.tabFor(args);
        const r = await this.content(tabId, { type: "cs/snapshot" });
        if (!r.ok) throw new Error(r.error);
        if (r.kind !== "snapshot") throw new Error("Unexpected response.");
        return {
          ok: true,
          text: `Tab ${tabId}: "${r.title}" — ${r.url}\n${r.refCount} interactive elements.\n\n${r.text || "(no visible elements; the page may still be loading)"}`,
        };
      }
      case "find_text": {
        const r = await this.content(await this.tabFor(args), { type: "cs/find", query: str(args["query"]) });
        if (!r.ok) throw new Error(r.error);
        return { ok: true, text: r.kind === "text" ? r.text : "" };
      }
      case "extract": {
        const kind = str(args["kind"]) as "table" | "list" | "links" | "forms" | "metadata";
        const r = await this.content(await this.tabFor(args), { type: "cs/extract", kind });
        if (!r.ok) throw new Error(r.error);
        const json = JSON.stringify(r.kind === "data" ? r.data : null);
        return { ok: true, text: json.length > 20_000 ? `${json.slice(0, 20_000)}…[truncated]` : json };
      }
      case "screenshot": {
        const tabId = await this.tabFor(args);
        const image = await this.screenshot(tabId);
        return { ok: true, text: `Screenshot of tab ${tabId} captured (attached as an image).`, image };
      }
      case "click": {
        const tabId = await this.tabFor(args);
        const ref = int(args["ref"]);
        if (ref === undefined) throw new Error("ref is required.");
        const before = (await getTab(tabId))?.url ?? "";
        const cdp = await this.useCdp(tabId);
        const t = await this.target(tabId, ref, "hover");
        const label = `Clicking "${t.facts.name.slice(0, 50) || t.facts.tag}"`;
        onLabel(label);
        const denied = await this.gate(name, label, clickRisk(t.facts));
        if (denied) return { ok: false, text: denied };
        void this.content(tabId, { type: "cs/highlight", ref, action: "click" });
        const double = args["double"] === true;
        const tabsBefore = new Set((await listTabs()).map((tab) => tab.id));
        if (cdp) await this.deps.cdp.click(tabId, t.x, t.y, double ? 2 : 1);
        else {
          const r = await this.content(tabId, { type: "cs/domClick", ref });
          if (!r.ok) throw new Error(r.error);
        }
        const settled = await this.settle(tabId, before);
        return { ok: true, text: `Clicked [${ref}] ${t.facts.role} "${t.facts.name}". ${settled}${await this.followNewTab(tabsBefore)}` };
      }
      case "type": {
        const tabId = await this.tabFor(args);
        const ref = int(args["ref"]);
        if (ref === undefined) throw new Error("ref is required.");
        const text = str(args["text"]);
        const submit = args["submit"] === true;
        const clear = args["clear"] !== false;
        const before = (await getTab(tabId))?.url ?? "";
        const cdp = await this.useCdp(tabId);
        const t = await this.target(tabId, ref, "type");
        const label = `Typing "${text.slice(0, 40)}" into "${t.facts.name.slice(0, 40) || t.facts.tag}"`;
        onLabel(label);
        const denied = await this.gate(name, label, typeRisk(t.facts, submit));
        if (denied) return { ok: false, text: denied };
        if (cdp) {
          await this.deps.cdp.click(tabId, t.x, t.y);
          const f = await this.content(tabId, { type: "cs/focus", ref, clear });
          if (!f.ok) throw new Error(f.error);
          if (clear) await this.deps.cdp.press(tabId, "Delete");
          await this.deps.cdp.insertText(tabId, text);
          if (submit) await this.deps.cdp.press(tabId, "Enter");
        } else {
          const r = await this.content(tabId, { type: "cs/domType", ref, text, replace: clear });
          if (!r.ok) throw new Error(r.error);
          if (submit) await this.content(tabId, { type: "cs/submitOf", ref });
        }
        const tail = submit ? ` Pressed Enter. ${await this.settle(tabId, before)}` : "";
        return { ok: true, text: `Typed "${text}" into [${ref}] "${t.facts.name}".${tail}` };
      }
      case "select_option": {
        const tabId = await this.tabFor(args);
        const ref = int(args["ref"]);
        if (ref === undefined) throw new Error("ref is required.");
        await this.pointAt(tabId, ref, "select");
        const r = await this.content(tabId, { type: "cs/domSelect", ref, value: str(args["value"]) });
        if (!r.ok) throw new Error(r.error);
        return { ok: true, text: r.kind === "done" ? `[${ref}] ${r.note}.` : "Selected." };
      }
      case "press_key": {
        const tabId = await this.tabFor(args);
        const key = str(args["key"]);
        const before = (await getTab(tabId))?.url ?? "";
        const facts = await this.content(tabId, { type: "cs/activeFacts" });
        const denied = await this.gate(
          name,
          `Pressing ${key}`,
          keyRisk(key, facts.ok && facts.kind === "facts" ? facts.facts : null),
        );
        if (denied) return { ok: false, text: denied };
        if (await this.useCdp(tabId)) await this.deps.cdp.press(tabId, key);
        else {
          const r = await this.content(tabId, { type: "cs/domKey", key });
          if (!r.ok) throw new Error(r.error);
        }
        return { ok: true, text: `Pressed ${key}. ${await this.settle(tabId, before)}` };
      }
      case "scroll": {
        const tabId = await this.tabFor(args);
        const direction = str(args["direction"]) as "up" | "down" | "top" | "bottom";
        if (!["up", "down", "top", "bottom"].includes(direction)) throw new Error("direction must be up, down, top, or bottom.");
        const r = await this.content(tabId, { type: "cs/scroll", direction, ref: int(args["ref"]), amount: int(args["amount"]) });
        if (!r.ok) throw new Error(r.error);
        return { ok: true, text: r.kind === "done" ? `${r.note[0]!.toUpperCase()}${r.note.slice(1)}.` : "Scrolled." };
      }
      case "hover": {
        const tabId = await this.tabFor(args);
        const ref = int(args["ref"]);
        if (ref === undefined) throw new Error("ref is required.");
        const cdp = await this.useCdp(tabId);
        const t = await this.target(tabId, ref, "hover");
        onLabel(`Hovering "${t.facts.name.slice(0, 50) || t.facts.tag}"`);
        if (cdp) await this.deps.cdp.hover(tabId, t.x, t.y);
        else await this.content(tabId, { type: "cs/domHover", ref });
        await sleep(400);
        return { ok: true, text: `Hovering over [${ref}] "${t.facts.name}". Call snapshot to see any menu that opened.` };
      }
      case "wait": {
        const text = str(args["text"]);
        if (text !== "") {
          const r = await this.content(await this.tabFor(args), { type: "cs/waitText", text, timeoutMs: 10_000 });
          if (!r.ok) throw new Error(r.error);
          return { ok: true, text: r.kind === "done" ? r.note : "Done." };
        }
        const seconds = Math.min(Math.max(Number(args["seconds"] ?? 1) || 1, 0.2), 10);
        await sleep(seconds * 1000);
        return { ok: true, text: `Waited ${seconds}s. ${await this.pageState(await this.tabFor(args))}` };
      }
      case "navigate": {
        const tabId = await this.tabFor(args);
        const state = await this.navigateTab(tabId, normalizeUrl(str(args["url"])));
        return { ok: true, text: `${state}. Call snapshot or get_page_text to see it.` };
      }
      case "go_back": {
        const tabId = await this.tabFor(args);
        await browser.tabs.goBack(tabId);
        await waitForTabLoad(tabId, 15_000);
        await this.glow(tabId, true);
        return { ok: true, text: `${await this.pageState(tabId)}.` };
      }
      case "list_tabs":
        return { ok: true, text: formatTabList(await listTabs()) };
      case "open_tab": {
        const url = normalizeUrl(str(args["url"]));
        const active = args["active"] !== false;
        const working = active && this.workingTabId !== null ? await getTab(this.workingTabId) : null;
        if (working && sameSite(working.url, url)) {
          const state = await this.navigateTab(working.id, url);
          return { ok: true, text: `Opened in the working tab instead of a new tab: ${state}. Call snapshot to see it.` };
        }
        const tab = await browser.tabs.create({ url, active });
        if (tab.id === undefined) throw new Error("Could not open a tab.");
        await waitForTabLoad(tab.id, 20_000);
        if (active) this.workingTabId = tab.id;
        return { ok: true, text: `Opened tab ${tab.id}${active ? " (now working in it)" : ""}. ${await this.pageState(tab.id)}.` };
      }
      case "switch_tab": {
        const tabId = int(args["tab_id"]);
        if (tabId === undefined || !(await getTab(tabId))) throw new Error("Unknown tab_id. Call list_tabs.");
        await browser.tabs.update(tabId, { active: true });
        this.workingTabId = tabId;
        return { ok: true, text: `Switched. ${await this.pageState(tabId)}.` };
      }
      case "close_tab": {
        const tabId = int(args["tab_id"]);
        if (tabId === undefined) throw new Error("tab_id is required.");
        await browser.tabs.remove(tabId);
        this.glowing.delete(tabId);
        if (this.workingTabId === tabId) this.workingTabId = (await getActiveTab())?.id ?? null;
        return { ok: true, text: `Closed tab ${tabId}.` };
      }
      case "read_url": {
        const url = normalizeUrl(str(args["url"]));
        const max = Math.min(int(args["max_chars"]) ?? 12_000, 40_000);
        const tab = await browser.tabs.create({ url, active: false });
        if (tab.id === undefined) throw new Error("Could not open the page.");
        try {
          await waitForTabLoad(tab.id, 20_000);
          await sleep(500);
          const r = await this.content(tab.id, { type: "cs/pageText", maxChars: max });
          if (!r.ok) throw new Error(r.error);
          if (r.kind !== "pageText") throw new Error("Unexpected response.");
          return { ok: true, text: `Title: ${r.title}\nURL: ${r.url}\n\n${r.text}${r.truncated ? "\n…[truncated]" : ""}` };
        } finally {
          await browser.tabs.remove(tab.id).catch(() => undefined);
        }
      }
      case "web_search": {
        const query = str(args["query"]).trim();
        if (query === "") throw new Error("query is required.");
        const { engine, results } = await webSearch(this.deps.searchEngine, query);
        return { ok: true, text: formatResults(query, engine, results) };
      }
      case "get_my_email": {
        const [profile, gmail] = await Promise.all([
          (this.deps.profileEmail ?? chromeProfileEmail)().catch(() => ""),
          (this.deps.fetchInbox ?? fetchGmailInbox)().then((inbox) => inbox.account, () => ""),
        ]);
        const found = [profile && `Chrome profile: ${profile}`, gmail && gmail !== profile && `Signed in to Gmail as: ${gmail}`].filter(Boolean);
        if (found.length === 0) return { ok: false, text: "No email address found (Chrome profile not signed in and no Gmail session). Ask the user." };
        return { ok: true, text: `${found.join("\n")}\nUse the one that fits the site; prefer an address the user or memory names for it.` };
      }
      case "use_saved_password":
        return this.useSavedPassword(args, onLabel);
      case "get_email_code": {
        const from = str(args["from"]).trim() || undefined;
        const waitSeconds = Math.min(Math.max(int(args["wait_seconds"]) ?? 30, 0), 90);
        const maxAge = Math.min(Math.max(int(args["max_age_minutes"]) ?? 10, 1), 60);
        const { found, account } = await waitForCode({
          from,
          since: Date.now() - maxAge * 60_000,
          waitMs: waitSeconds * 1000,
          fetchInbox: this.deps.fetchInbox,
        });
        if (!found) {
          return {
            ok: false,
            text:
              `No verification code${from ? ` from ${from}` : ""} among unread Gmail messages${account ? ` for ${account}` : ""} from the last ${maxAge} min. ` +
              `It may be in another folder, already read, or still on its way: open_tab ${GMAIL_SEARCH_URL}, open the newest matching email, read the code, then close that tab and switch_tab back to the working tab. If the code was sent by SMS or an authenticator app, ask the user for it.`,
          };
        }
        const age = Math.max(0, Math.round((Date.now() - found.item.received) / 60_000));
        const sender = found.item.from || found.item.fromEmail;
        return { ok: true, text: `Code ${found.code} from ${sender} ("${found.item.subject.slice(0, 100)}"), received ${age} min ago.` };
      }
      case "remember":
      case "forget":
      case "recall": {
        const memory = this.deps.memory;
        if (!memory) return { ok: false, text: "Long-term memory is turned off in Settings." };
        if (name === "remember") return { ok: true, text: await memory.remember(str(args["text"]), str(args["replaces_id"]) || undefined) };
        if (name === "forget") return { ok: true, text: await memory.forget(str(args["id"])) };
        return { ok: true, text: await memory.recall(str(args["query"])) };
      }
      case "ask_user":
        return this.askUser(args);
      case "search_sessions": {
        if (!this.deps.sessions) return { ok: false, text: "Remembering past chats is turned off in Settings." };
        const text = await this.deps.sessions.search({
          query: str(args["query"]).trim() || undefined,
          since: str(args["since"]).trim() || undefined,
          until: str(args["until"]).trim() || undefined,
          limit: int(args["limit"]),
        });
        return { ok: true, text };
      }
      case "read_session": {
        if (!this.deps.sessions) return { ok: false, text: "Remembering past chats is turned off in Settings." };
        const id = str(args["id"]).trim();
        if (id === "") throw new Error("id is required (from search_sessions).");
        const text = await this.deps.sessions.read(id, {
          query: str(args["query"]).trim() || undefined,
          offset: int(args["offset"]),
          maxChars: int(args["max_chars"]),
        });
        return { ok: true, text };
      }
      default:
        return { ok: false, text: `Unknown tool "${name}".` };
    }
  }

  private async askUser(args: Args): Promise<ToolOutcome> {
    if (!this.deps.ask) return { ok: false, text: "Asking the user is not available here; continue with your best judgment." };
    const question = str(args["question"]).trim();
    if (question === "") throw new Error("question is required.");
    const options = cleanOptions(args["options"]);
    const multiple = args["allow_multiple"] === true && options.length > 1;
    const tabId = this.workingTabId;
    const glowing = tabId !== null && this.glowing.has(tabId);
    if (glowing) await this.status(tabId, "Waiting for your answer");
    try {
      const answer = await this.deps.ask({ question, options, multiple });
      if (answer === null || answer.trim() === "") return { ok: true, text: ASK_SKIPPED };
      return { ok: true, text: `User answered: "${answer.trim()}"` };
    } finally {
      if (glowing) await this.status(tabId, "Thinking");
    }
  }

  private async loginState(tabId: number, ref: number) {
    const r = await this.content(tabId, { type: "cs/loginState", ref });
    if (!r.ok) throw new Error(r.error);
    if (r.kind !== "login") throw new Error("Unexpected response.");
    return r;
  }

  /**
   * Chrome's password manager is not readable by extensions, so pick its saved
   * login the way a person would: a trusted click on the field, then ArrowDown
   * and Tab to accept the first suggestion (Tab accepts it without submitting).
   * The password stays inside Chrome and the page; only "filled or not" comes back.
   */
  private async useSavedPassword(args: Args, onLabel: (label: string) => void): Promise<ToolOutcome> {
    const tabId = await this.tabFor(args);
    const ref = int(args["ref"]);
    if (ref === undefined) throw new Error("ref is required.");
    if (!(await this.useCdp(tabId))) {
      return { ok: false, text: "Filling saved passwords needs trusted input (Control mode: CDP in Settings). Ask the user to sign in." };
    }
    const t = await this.target(tabId, ref, "click");
    onLabel(`Filling saved login into "${t.facts.name.slice(0, 40) || t.facts.tag}"`);
    await this.deps.cdp.send(tabId, "Emulation.setFocusEmulationEnabled", { enabled: true }).catch(() => undefined);
    await this.deps.cdp.click(tabId, t.x, t.y);
    await sleep(700);
    let state = await this.loginState(tabId, ref);
    if (!state.passwordFilled) {
      await this.deps.cdp.press(tabId, "ArrowDown");
      await sleep(300);
      await this.deps.cdp.press(tabId, "Tab");
      await sleep(700);
      state = await this.loginState(tabId, ref);
    }
    const who = state.username ? ` for "${state.username}"` : "";
    if (state.passwordFilled) {
      return { ok: true, text: `Chrome filled the saved login${who}. Click the sign-in button next (call snapshot if refs may have changed).` };
    }
    if (!state.hasPassword && state.username) {
      return { ok: true, text: `Chrome filled the saved username "${state.username}". Continue; call use_saved_password again on the password page.` };
    }
    return {
      ok: false,
      text:
        "Chrome did not fill a saved password: none is saved for this site, Chrome wants the device password or Touch ID first, or its suggestion list did not open. " +
        "Do not guess a password. Ask the user to sign in (or to give you the password), then continue.",
    };
  }

  private async screenshot(tabId: number): Promise<string> {
    const tab = await browser.tabs.get(tabId);
    if (!isScriptableUrl(tab.url) && !/^chrome:/.test(tab.url ?? "")) throw new Error("This page cannot be captured.");
    if (await this.useCdp(tabId)) {
      try {
        return await this.deps.cdp.screenshot(tabId);
      } catch {
        // Fall through to captureVisibleTab.
      }
    }
    if (!tab.active) {
      await browser.tabs.update(tabId, { active: true });
      await sleep(300);
    }
    return browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 70 });
  }
}
