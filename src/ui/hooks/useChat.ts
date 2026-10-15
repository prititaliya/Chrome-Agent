import { useCallback, useEffect, useRef, useState } from "react";
import { buildUserContent, readTabContext, type PageContext } from "../../agent/context";
import { runTurn } from "../../agent/loop";
import { buildSystemPrompt } from "../../agent/prompt";
import { summarizeConversation, summaryCut } from "../../agent/summary";
import { addUsage, emptyUsage } from "../../agent/usage";
import { CdpController } from "../../browser/cdp";
import { getActiveTab } from "../../browser/tabs";
import { streamModel } from "../../providers";
import type { ModelRef } from "../../providers/types";
import {
  createConversation,
  loadConversation,
  newId,
  saveConversation,
  titleFrom,
  type Conversation,
  type Step,
  type UiMessage,
} from "../../storage/conversations";
import { getProviders, getSettings, resolveModel } from "../../storage/settings";
import { recordUsage, type UsageRecord } from "../../storage/usage";
import { deleteMemory, formatMemories, listMemories, saveMemory, searchMemories, selectMemories } from "../../storage/memory";
import { toolsFor } from "../../tools/definitions";
import { ToolExecutor, type ApprovalAnswer, type ApprovalRequest, type MemoryTools } from "../../tools/executor";

export interface PendingApproval extends ApprovalRequest {
  resolve: (answer: ApprovalAnswer) => void;
}

export interface SendOptions {
  includeCurrentTab: boolean;
  attachedTabIds: number[];
}

const cdp = new CdpController();

export function useChat(modelRef: ModelRef | null) {
  const [conv, setConvState] = useState<Conversation>(() => createConversation(modelRef));
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const convRef = useRef(conv);
  const abortRef = useRef<AbortController | null>(null);

  const setConv = useCallback((update: (prev: Conversation) => Conversation) => {
    convRef.current = update(convRef.current);
    setConvState(convRef.current);
  }, []);

  const patchMessage = useCallback(
    (id: string, patch: (m: UiMessage) => UiMessage) => {
      setConv((prev) => ({ ...prev, messages: prev.messages.map((m) => (m.id === id ? patch(m) : m)) }));
    },
    [setConv],
  );

  useEffect(() => {
    if (!running && modelRef) setConv((prev) => ({ ...prev, model: modelRef }));
  }, [modelRef, running, setConv]);

  const newChat = useCallback(() => {
    if (running) return;
    setConv(() => createConversation(modelRef));
  }, [modelRef, running, setConv]);

  const openConversation = useCallback(
    async (id: string) => {
      if (running) return;
      const loaded = await loadConversation(id);
      if (loaded) setConv(() => loaded);
    },
    [running, setConv],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setApproval((pending) => {
      pending?.resolve("deny");
      return null;
    });
  }, []);

  const send = useCallback(
    async (question: string, options: SendOptions) => {
      const text = question.trim();
      if (text === "" || running) return;
      const settings = await getSettings();
      const providers = await getProviders();
      const resolved = resolveModel(providers, settings.model);

      const userId = newId();
      const assistantId = newId();
      const now = Date.now();
      const assistant: UiMessage = { id: assistantId, role: "assistant", text: "", steps: [], createdAt: now };
      const user: UiMessage = { id: userId, role: "user", text, createdAt: now };

      if (!resolved) {
        setConv((prev) => ({
          ...prev,
          messages: [...prev.messages, user, { ...assistant, error: "Pick a model from the menu at the top (add providers and keys in Settings)." }],
        }));
        return;
      }
      const { provider, model } = resolved;
      if (provider.apiKey.trim() === "" && !/localhost|127\.0\.0\.1/.test(provider.baseUrl)) {
        setConv((prev) => ({
          ...prev,
          messages: [...prev.messages, user, { ...assistant, error: `Add your ${provider.name} API key in Settings first.` }],
        }));
        return;
      }

      setRunning(true);
      const controller = new AbortController();
      abortRef.current = controller;
      const activeTab = await getActiveTab();

      // Gather page context: current tab (unless turned off) plus @-attached tabs.
      const pages: PageContext[] = [];
      if (settings.attachPage && options.includeCurrentTab && activeTab) {
        const ctx = await readTabContext(activeTab.id, "current tab", { withSnapshot: model.tools });
        if (ctx) pages.push(ctx);
      }
      for (const tabId of options.attachedTabIds) {
        if (tabId === activeTab?.id && pages.length > 0) continue;
        const ctx = await readTabContext(tabId, "attached tab");
        if (ctx) pages.push(ctx);
      }
      user.context = pages.map((p) => ({ title: p.title, url: p.url }));
      user.apiIndex = convRef.current.api.length;
      assistant.model = model.label ?? model.id;
      assistant.modelRef = settings.model ?? undefined;
      assistant.providerName = provider.name;
      const ledger: UsageRecord[] = [];
      const convId = convRef.current.id;

      setConv((prev) => ({
        ...prev,
        model: settings.model,
        title: prev.messages.length === 0 ? titleFrom(text) : prev.title,
        messages: [...prev.messages, user, assistant],
        updatedAt: Date.now(),
      }));

      const canAct = model.tools;
      const canRemember = canAct && settings.memory && settings.autoMemory;
      const memoryTools: MemoryTools = {
        remember: async (memoryText, replacesId) => {
          try {
            const { action, memory } = await saveMemory({ text: memoryText, source: "assistant", convId, replacesId });
            return action === "duplicate" ? `Already remembered as [${memory.id}].` : `${action === "added" ? "Saved" : "Updated"} memory [${memory.id}]: ${memory.text}`;
          } catch (error) {
            return `Not saved: ${error instanceof Error ? error.message : String(error)}`;
          }
        },
        forget: async (id) => {
          const removed = await deleteMemory(id);
          return removed ? `Deleted memory [${id}]: ${removed.text}` : `No memory with id ${id}.`;
        },
        recall: async (query) => {
          const found = searchMemories(await listMemories(), query, 15);
          return found.length > 0 ? formatMemories(found) : "No matching memories.";
        },
      };

      const upsertStep = (step: Step) =>
        patchMessage(assistantId, (m) => {
          const steps = m.steps ?? [];
          const index = steps.findIndex((s) => s.id === step.id);
          return { ...m, steps: index >= 0 ? steps.map((s, i) => (i === index ? step : s)) : [...steps, step] };
        });
      const onUsage = (usage: Parameters<typeof addUsage>[1]) => {
        ledger.push({ ...usage, ts: Date.now(), convId, providerId: provider.id, providerName: provider.name, modelId: model.id });
        patchMessage(assistantId, (m) => ({ ...m, usage: addUsage(m.usage ?? emptyUsage(), usage) }));
      };

      // Long-term memory: the memories most relevant to this question.
      const { selected: memories, total: memoryTotal } = settings.memory
        ? selectMemories(await listMemories(), [text, ...pages.map((p) => p.title)].join(" "))
        : { selected: [], total: 0 };
      if (memories.length > 0) patchMessage(assistantId, (m) => ({ ...m, memoriesUsed: memories.length }));

      // Short-term memory: fold older turns into the running summary once the chat gets long.
      let summary = convRef.current.summary;
      const cut = summaryCut(convRef.current.api.slice(summary?.upTo ?? 0));
      if (cut > 0) {
        const from = summary?.upTo ?? 0;
        const step: Step = { id: `summary-${assistantId}`, tool: "summary", label: "Condensing earlier messages into memory", status: "running" };
        upsertStep(step);
        try {
          const result = await summarizeConversation({
            provider,
            model,
            previous: summary?.text,
            messages: convRef.current.api.slice(from, from + cut),
            stream: streamModel,
            signal: controller.signal,
            sessionId: convId,
          });
          onUsage(result.usage);
          summary = { text: result.text, upTo: from + cut, updatedAt: Date.now() };
          const saved = summary;
          setConv((prev) => ({ ...prev, summary: saved }));
          upsertStep({ ...step, status: "ok", label: "Condensed earlier messages into memory", detail: result.text });
        } catch (error) {
          upsertStep({ ...step, status: "error", detail: `Kept full history instead: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      const executor = canAct
        ? new ToolExecutor(
            {
              controlMode: settings.controlMode,
              searchEngine: settings.searchEngine,
              cdp,
              riskyAllowed: () => convRef.current.allowRisky === true,
              allowRisky: () => setConv((prev) => ({ ...prev, allowRisky: true })),
              approve: (request) =>
                new Promise<ApprovalAnswer>((resolve) => {
                  if (controller.signal.aborted) {
                    resolve("deny");
                    return;
                  }
                  setApproval({
                    ...request,
                    resolve: (answer) => {
                      setApproval(null);
                      resolve(answer);
                    },
                  });
                }),
              memory: canRemember ? memoryTools : undefined,
            },
            activeTab?.id ?? null,
          )
        : null;

      let result;
      try {
        result = await runTurn({
          provider,
          model,
          systemPrompt: buildSystemPrompt({
            now: new Date(),
            canAct,
            vision: model.vision && settings.screenshots,
            memories,
            memoryTotal,
            canRemember,
            summary: summary?.text,
          }),
          history: convRef.current.api.slice(summary?.upTo ?? 0),
          userMessage: { role: "user", content: buildUserContent(text, pages) },
          tools: canAct ? toolsFor({ vision: model.vision, screenshots: settings.screenshots, memory: canRemember }) : undefined,
          maxSteps: settings.maxSteps,
          signal: controller.signal,
          executor,
          stream: streamModel,
          sessionId: convRef.current.id,
          callbacks: {
            onText: (delta) => patchMessage(assistantId, (m) => ({ ...m, text: m.text + delta })),
            onReasoning: (delta) => patchMessage(assistantId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + delta })),
            onStep: upsertStep,
            onUsage,
          },
        });
      } finally {
        void recordUsage(ledger).catch(() => undefined);
        await executor?.finish().catch(() => undefined);
        abortRef.current = null;
        setApproval(null);
        setRunning(false);
      }

      const notice =
        result.end === "cancelled"
          ? "Stopped."
          : result.end === "max_steps"
            ? `Reached the ${settings.maxSteps}-step limit. Say "continue" to keep going.`
            : undefined;
      patchMessage(assistantId, (m) => ({
        ...m,
        error: result.error,
        durationMs: Date.now() - now,
        text: notice && result.end !== "cancelled" ? `${m.text}${m.text ? "\n\n" : ""}_${notice}_` : m.text,
        steps: (m.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "error", detail: "Cancelled." } : s)),
        ...(result.end === "cancelled" && m.text === "" && (m.steps ?? []).length === 0 ? { error: "Stopped." } : {}),
      }));
      setConv((prev) => ({ ...prev, api: [...prev.api, ...result.api], updatedAt: Date.now() }));
      await saveConversation(convRef.current);
    },
    [running, patchMessage, setConv],
  );

  /** Re-ask the last question (after an error). */
  const retry = useCallback(
    (options: SendOptions) => {
      const messages = convRef.current.messages;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser || running) return;
      setConv((prev) => {
        const index = prev.messages.lastIndexOf(lastUser);
        const api = lastUser.apiIndex !== undefined ? prev.api.slice(0, lastUser.apiIndex) : prev.api;
        return {
          ...prev,
          messages: prev.messages.slice(0, index),
          api,
          // A summary that covers rewound messages is stale.
          summary: prev.summary && prev.summary.upTo <= api.length ? prev.summary : undefined,
        };
      });
      void send(lastUser.text, options);
    },
    [running, send, setConv],
  );

  return { conv, running, approval, send, stop, retry, newChat, openConversation };
}
