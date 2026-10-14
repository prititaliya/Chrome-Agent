import { browser, type Browser } from "wxt/browser";

export interface TabInfo {
  id: number;
  title: string;
  url: string;
  active: boolean;
  favIconUrl?: string;
}

function toInfo(tab: Browser.tabs.Tab): TabInfo | null {
  if (tab.id === undefined) return null;
  return { id: tab.id, title: tab.title ?? "", url: tab.url ?? "", active: tab.active, favIconUrl: tab.favIconUrl };
}

function isOwnPage(tab: Browser.tabs.Tab): boolean {
  return (tab.url ?? "").startsWith(`chrome-extension://${browser.runtime.id}/`);
}

/** The user's active tab, skipping this extension's own pages (e.g. the panel opened as a tab). */
async function activeBrowserTab(): Promise<Browser.tabs.Tab | null> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab && !isOwnPage(tab)) return tab;
  const [focused] = await browser.tabs.query({ active: true, lastFocusedWindow: true, windowType: "normal" });
  if (focused && !isOwnPage(focused)) return focused;
  const [any] = (await browser.tabs.query({ active: true, windowType: "normal" })).filter((t) => !isOwnPage(t));
  return any ?? null;
}

export async function getActiveTab(): Promise<TabInfo | null> {
  const tab = await activeBrowserTab();
  return tab ? toInfo(tab) : null;
}

export async function listTabs(): Promise<TabInfo[]> {
  const active = await activeBrowserTab();
  const tabs = await browser.tabs.query(active ? { windowId: active.windowId } : { currentWindow: true });
  return tabs.filter((t) => !isOwnPage(t)).map(toInfo).filter((t): t is TabInfo => t !== null);
}

export async function getTab(tabId: number): Promise<TabInfo | null> {
  const tab = await browser.tabs.get(tabId).catch(() => null);
  return tab ? toInfo(tab) : null;
}

export function formatTabList(tabs: TabInfo[]): string {
  if (tabs.length === 0) return "No tabs open.";
  return tabs.map((t) => `${t.active ? "* " : "  "}tab ${t.id}: ${t.title || "(untitled)"} — ${t.url}`).join("\n");
}

/** Normalize model-provided URLs ("example.com" -> "https://example.com"). */
export function normalizeUrl(raw: string): string {
  const trimmed = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  return `https://${trimmed.replace(/^\/+/, "")}`;
}
