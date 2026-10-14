// Web search: open the engine's result page in an inactive tab, read the
// organic results through the content script, then close the tab.

import { browser } from "wxt/browser";
import { sendToTab, waitForTabLoad } from "./content";
import type { SearchEngine, SearchResult } from "./protocol";

export function searchUrl(engine: SearchEngine, query: string): string {
  const q = encodeURIComponent(query);
  switch (engine) {
    case "duckduckgo":
      return `https://html.duckduckgo.com/html/?q=${q}`;
    case "bing":
      return `https://www.bing.com/search?q=${q}`;
    case "google":
      return `https://www.google.com/search?q=${q}&hl=en`;
  }
}

async function searchWith(engine: SearchEngine, query: string): Promise<SearchResult[]> {
  const tab = await browser.tabs.create({ url: searchUrl(engine, query), active: false });
  if (tab.id === undefined) return [];
  try {
    await waitForTabLoad(tab.id, 15_000);
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await sendToTab(tab.id, { type: "cs/searchResults", engine });
      if (response.ok && response.kind === "search" && response.results.length > 0) return response.results;
      await new Promise((r) => setTimeout(r, 700));
    }
    return [];
  } finally {
    await browser.tabs.remove(tab.id).catch(() => undefined);
  }
}

export async function webSearch(engine: SearchEngine, query: string): Promise<{ engine: SearchEngine; results: SearchResult[] }> {
  const primary = await searchWith(engine, query);
  if (primary.length > 0 || engine === "duckduckgo") return { engine, results: primary };
  // Consent walls and captchas leave no results; DuckDuckGo's HTML endpoint is the reliable fallback.
  return { engine: "duckduckgo", results: await searchWith("duckduckgo", query) };
}

export function formatResults(query: string, engine: SearchEngine, results: SearchResult[]): string {
  if (results.length === 0) return `No results found for "${query}".`;
  const lines = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`);
  return `Search results for "${query}" (${engine}):\n${lines.join("\n")}\n\nUse read_url or open_tab to read a result in full.`;
}
