// A prompt queued by the context menu for the side panel to send.

import { browser } from "wxt/browser";

export const PENDING_PROMPT_KEY = "pendingPrompt";

export interface PendingPrompt {
  text: string;
  at: number;
}

/** Read and clear a queued prompt (ignored if older than a minute). */
export async function takePendingPrompt(): Promise<PendingPrompt | null> {
  const stored = (await browser.storage.session.get(PENDING_PROMPT_KEY))[PENDING_PROMPT_KEY] as PendingPrompt | undefined;
  if (!stored) return null;
  await browser.storage.session.remove(PENDING_PROMPT_KEY);
  return Date.now() - stored.at < 60_000 ? stored : null;
}

export function onPendingPrompt(listener: () => void): () => void {
  const handler = (changes: Record<string, unknown>, area: string) => {
    if (area === "session" && PENDING_PROMPT_KEY in changes) listener();
  };
  browser.storage.onChanged.addListener(handler);
  return () => browser.storage.onChanged.removeListener(handler);
}
