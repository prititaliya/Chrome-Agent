// Cross-chat recall: search earlier chats (by digest, or by their text for
// chats without one) and read them back with secrets redacted.

import { isTurnStart } from "../agent/context";
import type { ApiMessage } from "../providers/types";
import { listConversations, loadConversation, type UiMessage } from "./conversations";
import { listDigests, type SessionDigest } from "./digests";
import { tokens } from "./memory";
import { redactSecrets } from "./redact";

/** Chats need this many new turns before the digest is refreshed after a task (any new turn when leaving the chat). */
export const DIGEST_MIN_TURNS = 2;

export function newTurns(api: ApiMessage[], digest: Pick<SessionDigest, "apiLength"> | undefined): number {
  return api.slice(digest?.apiLength ?? 0).filter(isTurnStart).length;
}

export function needsDigest(api: ApiMessage[], digest: Pick<SessionDigest, "apiLength"> | undefined, leaving: boolean): boolean {
  const fresh = newTurns(api, digest);
  return leaving ? fresh >= 1 : fresh >= DIGEST_MIN_TURNS;
}

const stem = (w: string) => (w.length > 4 && w.endsWith("es") ? w.slice(0, -2) : w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w);

function stems(text: string): Set<string> {
  return new Set([...tokens(text)].map(stem));
}

export function dateLabel(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function parseDate(value: string | undefined, endOfDay: boolean): number | undefined {
  if (!value) return undefined;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T${endOfDay ? "23:59:59" : "00:00:00"}` : value);
  return Number.isFinite(t) ? t : undefined;
}

export interface SessionQuery {
  query?: string;
  /** ISO date (YYYY-MM-DD) or date-time. */
  since?: string;
  until?: string;
  limit?: number;
  /** The current chat, which is already in context. */
  excludeId?: string;
}

export interface SessionHit {
  id: string;
  title: string;
  updatedAt: number;
  digest?: string;
  snippet?: string;
  score: number;
}

function snippetAround(text: string, words: Set<string>): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) {
    const i = lower.indexOf(w);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  const start = Math.max(0, at - 120);
  return `${start > 0 ? "…" : ""}${text.slice(start, start + 360).replace(/\s+/g, " ").trim()}…`;
}

export async function searchSessions(q: SessionQuery): Promise<SessionHit[]> {
  const [index, digests] = await Promise.all([listConversations(), listDigests()]);
  const byId = new Map(digests.map((d) => [d.convId, d]));
  const since = parseDate(q.since, false);
  const until = parseDate(q.until, true);
  const limit = Math.min(Math.max(q.limit ?? 5, 1), 20);
  const words = stems(q.query ?? "");
  const hits: SessionHit[] = [];
  for (const conv of index) {
    if (conv.id === q.excludeId) continue;
    if (since !== undefined && conv.updatedAt < since) continue;
    if (until !== undefined && conv.updatedAt > until) continue;
    const digest = byId.get(conv.id);
    let score = 1;
    if (words.size > 0) {
      const doc = stems(digest ? `${digest.digest} ${digest.keywords.join(" ")}` : conv.searchText);
      let matched = 0;
      for (const w of words) if (doc.has(w)) matched++;
      const titleWords = stems(conv.title);
      let titleMatched = 0;
      for (const w of words) if (titleWords.has(w)) titleMatched++;
      score = matched / words.size + (titleMatched > 0 ? 0.5 * (titleMatched / words.size) : 0);
      if (score === 0) continue;
    }
    hits.push({
      id: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      digest: digest?.digest,
      snippet: digest ? undefined : redactSecrets(words.size > 0 ? snippetAround(conv.searchText, words) : conv.searchText.slice(0, 300)),
      score,
    });
  }
  hits.sort((a, b) => b.score - a.score || b.updatedAt - a.updatedAt);
  return hits.slice(0, limit);
}

export function formatSessionHits(hits: SessionHit[], q: SessionQuery): string {
  if (hits.length === 0) {
    return q.query ? `No earlier chats match "${q.query}". Try other words, or call search_sessions without a query to list recent chats.` : "No earlier chats found.";
  }
  const lines = hits.map((h) => {
    const body = h.digest ?? `(no digest yet; matching text: ${h.snippet ?? ""})`;
    return `[${h.id}] "${h.title}" (${dateLabel(h.updatedAt)})\n${body}`;
  });
  return `${lines.join("\n\n")}\n\nCite a chat as [title](#chat/<id>). Call read_session with the id for details.`;
}

export interface ReadOptions {
  query?: string;
  offset?: number;
  maxChars?: number;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}…` : text);

function renderMessage(m: UiMessage, n: number): string {
  if (m.role === "user") return `#${n} USER (${new Date(m.createdAt).toLocaleString("en-US")}): ${clip(m.text, 2000)}`;
  const lines = [`#${n} ASSISTANT${m.model ? ` (${m.model})` : ""}: ${clip(m.text, 3000) || (m.error ? `[error: ${m.error}]` : "(no text)")}`];
  for (const s of m.steps ?? []) {
    lines.push(`  - ${s.label} [${s.status}]${s.detail ? `: ${clip(s.detail.replace(/\s+/g, " "), 300)}` : ""}`);
  }
  return lines.join("\n");
}

export async function readSession(id: string, opts: ReadOptions = {}): Promise<string> {
  const conv = await loadConversation(id);
  if (!conv) return `No chat with id ${id}. It may have been deleted; call search_sessions to find chats.`;
  const max = Math.min(Math.max(opts.maxChars ?? 12_000, 1000), 30_000);
  const rendered = conv.messages.map((m, i) => redactSecrets(renderMessage(m, i)));
  let picked = rendered.map((_, i) => i);
  const words = stems(opts.query ?? "");
  if (words.size > 0) {
    const keep = new Set<number>();
    rendered.forEach((text, i) => {
      const doc = stems(text);
      if ([...words].some((w) => doc.has(w))) for (const j of [i - 1, i, i + 1]) if (j >= 0 && j < rendered.length) keep.add(j);
    });
    picked = [...keep].sort((a, b) => a - b);
    if (picked.length === 0) return `Nothing in "${conv.title}" matches "${opts.query}". Call read_session without a query to read it from the start.`;
  }
  const start = Math.max(0, opts.offset ?? 0);
  picked = picked.filter((i) => i >= start);
  const header = `Chat "${conv.title}" [${conv.id}], ${dateLabel(conv.createdAt)} to ${dateLabel(conv.updatedAt)}, ${conv.messages.length} messages. Secret values are redacted.`;
  const out: string[] = [header];
  let used = header.length;
  for (let k = 0; k < picked.length; k++) {
    const i = picked[k]!;
    const text = rendered[i]!;
    if (used + text.length > max && k > 0) {
      out.push(`…more available: call read_session with offset ${i}.`);
      break;
    }
    out.push(text);
    used += text.length + 1;
  }
  return out.join("\n");
}

/** One line per recent chat, for the system prompt. */
export async function recentChats(excludeId: string, limit = 5): Promise<{ id: string; title: string; updatedAt: number }[]> {
  return (await listConversations())
    .filter((c) => c.id !== excludeId)
    .slice(0, limit)
    .map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt }));
}
