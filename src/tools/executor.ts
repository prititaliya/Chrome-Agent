// Runs the model's tool calls against real tabs. Input goes through CDP
// (trusted events) when enabled, falling back to synthetic DOM events.

import { browser } from "wxt/browser";
import { clickRisk, keyRisk, typeRisk, type RiskVerdict } from "../agent/risk";
import type { CdpController } from "../browser/cdp";
import { isScriptableUrl, sendToTab, waitForTabLoad } from "../browser/content";
import type { ContentRequest, ContentResponse, SearchEngine, TargetInfo } from "../browser/protocol";
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

export interface ExecutorDeps {
  controlMode: "cdp" | "dom";
  searchEngine: SearchEngine;
  cdp: CdpController;
  approve: (request: ApprovalRequest) => Promise<ApprovalAnswer>;
  riskyAllowed: () => boolean;
  allowRisky: () => void;
  memory?: MemoryTools;
}

type Args = Record<string, unknown>;

const MUTATING = new Set(["click", "type", "select_option", "press_key", "hover"]);

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
    case "remember":
      return `Remembering: ${str(args["text"]).slice(0, 80)}`;
    case "forget":
      return "Forgetting a memory";
    case "recall":
      return `Searching memory: ${str(args["query"])}`;
    default:
      return name;
  }
}

export class ToolExecutor {
  workingTabId: number | null;
  private readonly glowing = new Set<number>();

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

  /** Let the page react; follow navigations to completion. */
  private async settle(tabId: number, urlBefore: string): Promise<string> {
    await sleep(500);
    const tab = await getTab(tabId);
    if (tab && (tab.url !== urlBefore || (await browser.tabs.get(tabId)).status === "loading")) {
      await waitForTabLoad(tabId, 10_000);
      await sleep(300);
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

  private async target(tabId: number, ref: number): Promise<TargetInfo> {
    const response = await this.content(tabId, { type: "cs/target", ref });
    if (!response.ok) throw new Error(response.error);
    if (response.kind !== "target") throw new Error("Unexpected response from page.");
    void this.content(tabId, { type: "cs/highlight", ref });
    return response.target;
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

  private async glow(tabId: number): Promise<void> {
    if (this.glowing.has(tabId)) return;
    this.glowing.add(tabId);
    await this.content(tabId, { type: "cs/agentActive", on: true }).catch(() => undefined);
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
    }
  }

  private async run(name: string, args: Args, onLabel: (label: string) => void): Promise<ToolOutcome> {
    if (MUTATING.has(name)) await this.glow(await this.tabFor(args));
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
        const t = await this.target(tabId, ref);
        const label = `Clicking "${t.facts.name.slice(0, 50) || t.facts.tag}"`;
        onLabel(label);
        const denied = await this.gate(name, label, clickRisk(t.facts));
        if (denied) return { ok: false, text: denied };
        const double = args["double"] === true;
        if (cdp) await this.deps.cdp.click(tabId, t.x, t.y, double ? 2 : 1);
        else {
          const r = await this.content(tabId, { type: "cs/domClick", ref });
          if (!r.ok) throw new Error(r.error);
        }
        return { ok: true, text: `Clicked [${ref}] ${t.facts.role} "${t.facts.name}". ${await this.settle(tabId, before)}` };
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
        const t = await this.target(tabId, ref);
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
        void this.content(tabId, { type: "cs/highlight", ref });
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
        const t = await this.target(tabId, ref);
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
        const url = normalizeUrl(str(args["url"]));
        await browser.tabs.update(tabId, { url });
        await waitForTabLoad(tabId, 20_000);
        this.workingTabId = tabId;
        return { ok: true, text: `${await this.pageState(tabId)}. Call snapshot or get_page_text to see it.` };
      }
      case "go_back": {
        const tabId = await this.tabFor(args);
        await browser.tabs.goBack(tabId);
        await waitForTabLoad(tabId, 15_000);
        return { ok: true, text: `${await this.pageState(tabId)}.` };
      }
      case "list_tabs":
        return { ok: true, text: formatTabList(await listTabs()) };
      case "open_tab": {
        const url = normalizeUrl(str(args["url"]));
        const active = args["active"] !== false;
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
      case "remember":
      case "forget":
      case "recall": {
        const memory = this.deps.memory;
        if (!memory) return { ok: false, text: "Long-term memory is turned off in Settings." };
        if (name === "remember") return { ok: true, text: await memory.remember(str(args["text"]), str(args["replaces_id"]) || undefined) };
        if (name === "forget") return { ok: true, text: await memory.forget(str(args["id"])) };
        return { ok: true, text: await memory.recall(str(args["query"])) };
      }
      default:
        return { ok: false, text: `Unknown tool "${name}".` };
    }
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
