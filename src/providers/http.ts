// Shared HTTP plumbing for provider calls: headers, readable errors, one
// retry for rate limits / transient failures, and incremental payload reading.

import { PayloadParser, type Framing } from "./sse";
import { ProviderError, type ProviderConfig } from "./types";

function isOpenCode(provider: ProviderConfig): boolean {
  return provider.preset === "opencode-go" || /^https?:\/\/([^/]*\.)?opencode\.ai(\/|$)/.test(provider.baseUrl);
}

export function providerHeaders(provider: ProviderConfig, sessionId?: string): Record<string, string> {
  return {
    "content-type": "application/json",
    ...(provider.apiKey.trim() !== "" ? { authorization: `Bearer ${provider.apiKey.trim()}` } : {}),
    // OpenCode Go rejects requests without a stable per-conversation session id.
    ...(isOpenCode(provider) ? { "x-opencode-session": sessionId ?? crypto.randomUUID() } : {}),
    ...provider.headers,
  };
}

export function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

function errorDetail(body: string): string {
  try {
    const json = JSON.parse(body) as { error?: { message?: string } | string; message?: string };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
    if (json.message) return json.message;
  } catch {
    // Not JSON.
  }
  return body.slice(0, 300);
}

export function friendlyError(status: number, provider: ProviderConfig, body: string): ProviderError {
  const detail = errorDetail(body);
  const prefix =
    status === 401 || status === 403
      ? `${provider.name} rejected the API key (${status}). Check it in Settings.`
      : status === 404
        ? `${provider.name} could not find that model or endpoint (404). Check the model id and base URL.`
        : status === 429
          ? `${provider.name} rate limit or quota reached (429).`
          : status === 402
            ? `${provider.name} reports insufficient credits (402).`
            : `${provider.name} returned an error (${status}).`;
  return new ProviderError(detail ? `${prefix} ${detail}` : prefix, status);
}

const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export async function postWithRetry(
  url: string,
  init: RequestInit,
  provider: ProviderConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetchImpl(url, { ...init, method: "POST", credentials: "omit" });
    } catch (error) {
      if (init.signal?.aborted) throw error;
      if (attempt >= 1) {
        throw new ProviderError(
          `Could not reach ${provider.name} at ${provider.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
          0,
        );
      }
      await sleep(1500, init.signal);
      continue;
    }
    if (response.ok) return response;
    if (attempt < 1 && RETRYABLE.has(response.status)) {
      const retryAfter = Number(response.headers.get("retry-after"));
      await response.body?.cancel().catch(() => undefined);
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10) * 1000 : 2000, init.signal);
      continue;
    }
    throw friendlyError(response.status, provider, await response.text().catch(() => ""));
  }
}

function sleep(ms: number, signal?: AbortSignal | null): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

function framingFor(response: Response): Framing {
  const type = response.headers.get("content-type") ?? "";
  if (type.includes("ndjson")) return "ndjson";
  if (type.includes("application/json")) return "json-body";
  return "sse";
}

/** Yield each payload as soon as it arrives (true streaming). */
export async function* readPayloads(response: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new PayloadParser(framingFor(response));
  const onAbort = () => void reader.cancel().catch(() => undefined);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done || signal?.aborted) break;
      for (const payload of parser.feed(decoder.decode(value, { stream: true }))) yield payload;
    }
    if (!signal?.aborted) {
      const tail = decoder.decode();
      if (tail !== "") parser.feed(tail);
      for (const payload of parser.flush()) yield payload;
    }
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }
}
