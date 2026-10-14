// Conversations: what the UI renders (`messages`) plus the exact transcript
// the model sees (`api`), so reopening a chat continues with full context.

import { storage } from "wxt/utils/storage";
import type { ConversationSummary as ShortTermSummary } from "../agent/summary";
import { emptyUsage, mergeUsage, type Usage } from "../agent/usage";
import type { ApiMessage, ModelRef } from "../providers/types";

export type StepStatus = "running" | "ok" | "error" | "denied" | "awaiting";

export interface Step {
  id: string;
  tool: string;
  label: string;
  status: StepStatus;
  detail?: string;
  /** Screenshot preview; never persisted. */
  image?: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  steps?: Step[];
  error?: string;
  /** Tabs attached as context to a user message. */
  context?: { title: string; url: string }[];
  /** Display name of the model that produced an assistant message. */
  model?: string;
  modelRef?: ModelRef;
  providerName?: string;
  /** Tokens and cost of every model request behind an assistant message. */
  usage?: Usage;
  durationMs?: number;
  /** Long-term memories included in the prompt for this answer. */
  memoriesUsed?: number;
  /** Length of `api` before this user turn; lets a retry rewind the model transcript. */
  apiIndex?: number;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  model: ModelRef | null;
  messages: UiMessage[];
  api: ApiMessage[];
  /** User chose "Allow for this chat" on a risky-action prompt. */
  allowRisky?: boolean;
  /** Short-term memory: condensed older turns. */
  summary?: ShortTermSummary;
}

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
  searchText: string;
  usage?: Usage;
  /** Model of the latest answer. */
  model?: string;
}

export function conversationUsage(conv: Pick<Conversation, "messages">): Usage {
  return conv.messages.reduce((total, m) => (m.usage ? mergeUsage(total, m.usage) : total), emptyUsage());
}

const MAX_CONVERSATIONS = 300;
const indexItem = storage.defineItem<ConversationSummary[]>("local:conv:index", { fallback: [] });
const convKey = (id: string) => `local:conv:${id}` as const;

export function newId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function createConversation(model: ModelRef | null): Conversation {
  const now = Date.now();
  return { id: newId(), title: "New chat", createdAt: now, updatedAt: now, model, messages: [], api: [] };
}

export function titleFrom(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > 60 ? `${line.slice(0, 57)}…` : line || "New chat";
}

/** Drop screenshots from what gets written to disk. */
export function stripImages(api: ApiMessage[]): ApiMessage[] {
  return api.map((m) =>
    typeof m.content === "string"
      ? m
      : {
          ...m,
          content: m.content.map((p) => (p.type === "image" ? { type: "text" as const, text: "[screenshot omitted]" } : p)),
        },
  );
}

function summarize(conv: Conversation): ConversationSummary {
  const searchText = conv.messages
    .map((m) => m.text)
    .join(" \n ")
    .slice(0, 4000)
    .toLowerCase();
  const model = [...conv.messages].reverse().find((m) => m.role === "assistant" && m.model)?.model;
  return { id: conv.id, title: conv.title, updatedAt: conv.updatedAt, searchText, usage: conversationUsage(conv), model };
}

export async function saveConversation(conv: Conversation): Promise<void> {
  if (conv.messages.length === 0) return;
  const stored: Conversation = {
    ...conv,
    api: stripImages(conv.api),
    messages: conv.messages.map((m) => (m.steps ? { ...m, steps: m.steps.map(({ image: _image, ...s }) => s) } : m)),
  };
  await storage.setItem(convKey(conv.id), stored);
  const index = (await indexItem.getValue()).filter((s) => s.id !== conv.id);
  index.unshift(summarize(conv));
  index.sort((a, b) => b.updatedAt - a.updatedAt);
  const evicted = index.splice(MAX_CONVERSATIONS);
  await indexItem.setValue(index);
  for (const old of evicted) await storage.removeItem(convKey(old.id));
}

export async function loadConversation(id: string): Promise<Conversation | null> {
  return (await storage.getItem<Conversation>(convKey(id))) ?? null;
}

export async function listConversations(query = ""): Promise<ConversationSummary[]> {
  const index = await indexItem.getValue();
  const q = query.trim().toLowerCase();
  if (q === "") return index;
  return index.filter((s) => s.title.toLowerCase().includes(q) || s.searchText.includes(q));
}

export async function deleteConversation(id: string): Promise<void> {
  await storage.removeItem(convKey(id));
  await indexItem.setValue((await indexItem.getValue()).filter((s) => s.id !== id));
}

export async function clearConversations(): Promise<void> {
  for (const s of await indexItem.getValue()) await storage.removeItem(convKey(s.id));
  await indexItem.setValue([]);
}

export function watchConversations(listener: () => void): () => void {
  return indexItem.watch(() => listener());
}
