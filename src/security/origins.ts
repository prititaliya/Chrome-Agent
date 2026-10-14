// Per-origin consent for agent page access. First agent use on an origin
// requests it via permissions.request; the answer persists in allow/deny
// lists. Optional-host content scripts do not auto-run on newly-granted
// origins, so approval re-injects the bridge into already-open tabs.

import { browser } from "wxt/browser";
import { storage } from "wxt/utils/storage";

const ALLOWED_KEY = "local:origins-allowed:v1";
const DENIED_KEY = "local:origins-denied:v1";

export function originOfUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function readList(key: `local:${string}`): Promise<string[]> {
  return (await storage.defineItem<string[]>(key).getValue()) ?? [];
}

async function writeList(key: `local:${string}`, origins: string[]): Promise<void> {
  await storage.defineItem<string[]>(key).setValue([...new Set(origins)]);
}

export async function getAllowedOrigins(): Promise<string[]> {
  return readList(ALLOWED_KEY);
}

export async function getDeniedOrigins(): Promise<string[]> {
  return readList(DENIED_KEY);
}

export async function setOriginConsent(origin: string, allowed: boolean): Promise<void> {
  const allowedList = (await getAllowedOrigins()).filter((o) => o !== origin);
  const deniedList = (await getDeniedOrigins()).filter((o) => o !== origin);
  if (allowed) allowedList.push(origin);
  else deniedList.push(origin);
  await writeList(ALLOWED_KEY, allowedList);
  await writeList(DENIED_KEY, deniedList);
}

export type OriginCheck = "granted" | "denied" | "unknown";

/** No prompts: pure list lookup for the per-dispatch path. */
export async function checkOriginPermission(origin: string): Promise<OriginCheck> {
  if ((await getAllowedOrigins()).includes(origin)) return "granted";
  if ((await getDeniedOrigins()).includes(origin)) return "denied";
  return "unknown";
}

function patternCovers(pattern: string, origin: string): boolean {
  if (pattern === "<all_urls>") return true;
  const match = /^(\*|https?):\/\/(\*\.?[^/]*|[^/]*)\/.*$/.exec(pattern);
  if (!match) return false;
  try {
    const host = new URL(origin).hostname;
    const patternHost = match[2] ?? "";
    if (patternHost.startsWith("*.")) return host.endsWith(patternHost.slice(1));
    if (patternHost === "*") return true;
    return host === patternHost;
  } catch {
    return false;
  }
}

interface ManifestContentScript {
  matches?: string[];
  js?: string[];
}

/** Pure: which built content-script files cover `origin` per our manifest. */
export function contentScriptFilesForOrigin(
  contentScripts: ManifestContentScript[] | undefined,
  origin: string,
): string[] {
  return (contentScripts ?? [])
    .filter((entry) => (entry.matches ?? []).some((pattern) => patternCovers(pattern, origin)))
    .flatMap((entry) => entry.js ?? []);
}

/**
 * Inject this extension's own content scripts into open tabs on `origin`.
 * Reads the file list from our manifest (no hardcoded build paths).
 */
export async function reinjectContentScripts(
  origin: string,
  tabIds?: number[],
  manifest?: { content_scripts?: ManifestContentScript[] },
): Promise<void> {
  const scripts = manifest ?? browser.runtime.getManifest();
  const files = contentScriptFilesForOrigin(scripts.content_scripts, origin);
  if (files.length === 0) return;
  const ids =
    tabIds ??
    (await browser.tabs.query({ url: `${origin}/*` })).flatMap((tab) =>
      tab.id === undefined ? [] : [tab.id],
    );
  for (const tabId of ids) {
    try {
      await browser.scripting.executeScript({ target: { tabId }, files, world: "ISOLATED" });
    } catch {
      // Tab gone, or a protected page (chrome://, store): skip silently.
    }
  }
}

export type OriginGrant = "granted" | "denied";

/**
 * Run-start path (may prompt). Pre-listed origins never prompt.
 * Approval re-injects the bridge; decline persists and yields "denied".
 */
export async function ensureOriginPermission(origin: string): Promise<OriginGrant> {
  if ((await getAllowedOrigins()).includes(origin)) return "granted";
  if ((await getDeniedOrigins()).includes(origin)) return "denied";
  let approved = false;
  try {
    approved = await browser.permissions.request({ origins: [`${origin}/*`] });
  } catch {
    approved = false;
  }
  await setOriginConsent(origin, approved);
  if (!approved) return "denied";
  await reinjectContentScripts(origin);
  return "granted";
}
