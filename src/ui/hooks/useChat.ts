import { useCallback, useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { buildUserContent, readTabContext, type PageContext } from "../../agent/context";
import { runTurn, STEER_PREFIX, type TurnResult } from "../../agent/loop";
import { buildSystemPrompt } from "../../agent/prompt";
import { autoCandidates, cheapestCandidate, hasKey, routeModel, type Candidate } from "../../agent/router";
import { digestSession, summarizeConversation, summaryCut } from "../../agent/summary";
import { addUsage, emptyUsage, type RequestUsage } from "../../agent/usage";
import { CdpController } from "../../browser/cdp";
import { getActiveTab } from "../../browser/tabs";
import { streamModel } from "../../providers";
import type { ModelConfig, ModelRef, ProviderConfig } from "../../providers/types";
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
import { getDigest, saveDigest } from "../../storage/digests";
import { deleteMemory, formatMemories, listMemories, saveMemory, searchMemories, selectMemories } from "../../storage/memory";
import { redactSecrets } from "../../storage/redact";
import { formatSessionHits, needsDigest, readSession, recentChats, searchSessions } from "../../storage/sessions";
import { getProviders, getSettings, resolveModel, type Settings } from "../../storage/settings";
import { recordUsage, type UsageRecord } from "../../storage/usage";
import { toolsFor } from "../../tools/definitions";
import {
  ToolExecutor,
  type ApprovalAnswer,
  type ApprovalRequest,
  type AskRequest,
  type MemoryTools,
  type SessionTools,
} from "../../tools/executor";

export interface PendingApproval extends ApprovalRequest {
  resolve: (answer: ApprovalAnswer) => void;
}

export interface PendingQuestion extends AskRequest {
  /** null means skipped. */
  resolve: (answer: string | null) => void;
}

export interface SendOptions {
  includeCurrentTab: boolean;
  attachedTabIds: number[];
}

export interface QueuedMessage {
  id: string;
  text: string;
  options: SendOptions;
}

interface ModelChoice {
  provider: ProviderConfig;
  model: ModelConfig;
}

const cdp = new CdpController();
const digesting = new Set<string>();

const displayName = (model: ModelConfig) => model.label ?? model.id;

function setBadge(text: string): void {
  try {
    void browser.action?.setBadgeText({ text })?.catch(() => undefined);
    if (text) void browser.action?.setBadgeBackgroundColor({ color: "#7c5cff" })?.catch(() => undefined);
  } catch {
    // No action API (tests).
  }
}

/** Model for background chores: the cheapest allowed one in Auto mode, else the chosen model. */
function choreModel(settings: Settings, providers: ProviderConfig[]): ModelChoice | undefined {
  if (settings.auto.enabled) return cheapestCandidate(autoCandidates(providers, settings.auto));
  const manual = resolveModel(providers, settings.model);
  return manual && hasKey(manual.provider) ? manual : undefined;
}

/** Write or refresh a chat's digest in the background; failures are retried next time. */
async function writeDigest(conv: Conversation, leaving: boolean): Promise<void> {
  if (conv.messages.length === 0 || digesting.has(conv.id)) return;
  const settings = await getSettings();
  if (!settings.sessionMemory) return;
  if (!needsDigest(conv.api, await getDigest(conv.id), leaving)) return;
  const pick = choreModel(settings, await getProviders());
  if (!pick) return;
  digesting.add(conv.id);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const result = await digestSession({
      provider: pick.provider,
      model: pick.model,
      title: conv.title,
      createdAt: conv.createdAt,
      api: conv.api,
      summary: conv.summary,
      stream: streamModel,
      redact: redactSecrets,
      signal: controller.signal,
      sessionId: conv.id,
    });
    await saveDigest({
      convId: conv.id,
      title: conv.title,
      updatedAt: conv.updatedAt,
      digest: result.digest,
      keywords: result.keywords,
      apiLength: conv.api.length,
    });
    await recordUsage([
      { ...result.usage, ts: Date.now(), convId: conv.id, providerId: pick.provider.id, providerName: pick.provider.name, modelId: pick.model.id },
    ]);
  } catch {
    // Keep the old digest; the next task or chat switch tries again.
  } finally {
    clearTimeout(timer);
    digesting.delete(conv.id);
  }
}

export function useChat(modelRef: ModelRef | null) {
  const [conv, setConvState] = useState<Conversation>(() => createConversation(modelRef));
  const [running, setRunning] = useState(false);
  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [question, setQuestion] = useState<PendingQuestion | null>(null);
  const [queued, setQueued] = useState<QueuedMessage[]>([]);
  const [queuePaused, setQueuePaused] = useState(false);
  const convRef = useRef(conv);
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const steerRef = useRef<string[]>([]);
  const assistantRef = useRef<string | null>(null);
  const executorRef = useRef<ToolExecutor | null>(null);
  const approvalRef = useRef<PendingApproval | null>(null);
  const questionRef = useRef<PendingQuestion | null>(null);

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

  const showApproval = useCallback((pending: PendingApproval | null) => {
    approvalRef.current = pending;
    setApproval(pending);
  }, []);

  const showQuestion = useCallback((pending: PendingQuestion | null) => {
    questionRef.current = pending;
    setQuestion(pending);
    setBadge(pending ? "?" : "");
  }, []);

  useEffect(() => {
    if (!running && modelRef) setConv((prev) => ({ ...prev, model: modelRef }));
  }, [modelRef, running, setConv]);

  const newChat = useCallback(() => {
    if (busyRef.current) return;
    const previous = convRef.current;
    setConv(() => createConversation(modelRef));
    void writeDigest(previous, true);
  }, [modelRef, setConv]);

  /** Returns false when the chat no longer exists or a task is running. */
  const openConversation = useCallback(
    async (id: string): Promise<boolean> => {
      if (busyRef.current) return false;
      const loaded = await loadConversation(id);
      if (!loaded) return false;
      const previous = convRef.current;
      if (previous.id !== id) void writeDigest(previous, true);
      setConv(() => loaded);
      return true;
    },
    [setConv],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    approvalRef.current?.resolve("deny");
    questionRef.current?.resolve(null);
  }, []);

  const send = useCallback(
    async (input: string, options: SendOptions) => {
      const text = input.trim();
      if (text === "" || busyRef.current) return;
      busyRef.current = true;
      try {
        await runMessage(text, options);
      } finally {
        busyRef.current = false;
        // After busyRef clears, so the queue effect sees an idle chat.
        setRunning(false);
      }
    },
    // runMessage only uses refs and stable callbacks.
    [],
  );

  async function runMessage(text: string, options: SendOptions): Promise<void> {
    const settings = await getSettings();
    const providers = await getProviders();
    const autoOn = settings.auto.enabled;
    const candidates = autoOn ? autoCandidates(providers, settings.auto) : [];
    const manual = autoOn ? null : resolveModel(providers, settings.model);

    const userId = newId();
    const assistantId = newId();
    const now = Date.now();
    const assistant: UiMessage = { id: assistantId, role: "assistant", text: "", steps: [], createdAt: now };
    const user: UiMessage = { id: userId, role: "user", text, createdAt: now };
    const fail = (error: string) => setConv((prev) => ({ ...prev, messages: [...prev.messages, user, { ...assistant, error }] }));

    if (autoOn && candidates.length === 0) {
      fail("Auto mode: no allowed model has an API key. Add a key or allow models in Settings → Auto model.");
      return;
    }
    if (!autoOn && !manual) {
      fail("Pick a model from the menu at the top (add providers and keys in Settings).");
      return;
    }
    if (manual && !hasKey(manual.provider)) {
      fail(`Add your ${manual.provider.name} API key in Settings first.`);
      return;
    }

    setRunning(true);
    steerRef.current = [];
    assistantRef.current = assistantId;
    const controller = new AbortController();
    abortRef.current = controller;
    const ledger: UsageRecord[] = [];
    const convId = convRef.current.id;
    let executor: ToolExecutor | null = null;
    let result: TurnResult | null = null;
    let failure: string | null = null;

    const upsertStep = (step: Step) =>
      patchMessage(assistantId, (m) => {
        const steps = m.steps ?? [];
        const index = steps.findIndex((s) => s.id === step.id);
        return { ...m, steps: index >= 0 ? steps.map((s, i) => (i === index ? step : s)) : [...steps, step] };
      });
    const record = (usage: RequestUsage, provider: ProviderConfig, modelId: string) => {
      ledger.push({ ...usage, ts: Date.now(), convId, providerId: provider.id, providerName: provider.name, modelId });
      patchMessage(assistantId, (m) => ({ ...m, usage: addUsage(m.usage ?? emptyUsage(), usage) }));
    };
    const showModel = (pick: ModelChoice) =>
      patchMessage(assistantId, (m) => ({
        ...m,
        model: displayName(pick.model),
        modelRef: { providerId: pick.provider.id, modelId: pick.model.id },
        providerName: pick.provider.name,
      }));

    try {
      const activeTab = await getActiveTab();
      const mayAct = autoOn ? candidates.some((c) => c.model.tools) : manual!.model.tools;

      // Gather page context: current tab (unless turned off) plus @-attached tabs.
      const pages: PageContext[] = [];
      if (settings.attachPage && options.includeCurrentTab && activeTab) {
        const ctx = await readTabContext(activeTab.id, "current tab", { withSnapshot: mayAct });
        if (ctx) pages.push(ctx);
      }
      for (const tabId of options.attachedTabIds) {
        if (tabId === activeTab?.id && pages.length > 0) continue;
        const ctx = await readTabContext(tabId, "attached tab");
        if (ctx) pages.push(ctx);
      }
      user.context = pages.map((p) => ({ title: p.title, url: p.url }));
      user.apiIndex = convRef.current.api.length;
      const earlier = convRef.current.messages
        .filter((m) => m.role === "user")
        .slice(-2)
        .map((m) => m.text);

      setConv((prev) => ({
        ...prev,
        model: settings.model,
        title: prev.messages.length === 0 ? titleFrom(text) : prev.title,
        messages: [...prev.messages, user, assistant],
        updatedAt: Date.now(),
      }));

      let current: ModelChoice;
      let fallbacks: Candidate[] = [];
      if (autoOn) {
        const step: Step = { id: `route-${assistantId}`, tool: "auto", label: "Choosing a model", status: "running" };
        upsertStep(step);
        const route = await routeModel({
          providers,
          auto: settings.auto,
          question: text,
          page: pages[0] ? { title: pages[0].title, url: pages[0].url } : undefined,
          earlier,
          stream: streamModel,
          signal: controller.signal,
          onUsage: (usage, by) => record(usage, by.provider, by.modelId),
        });
        if (!route) throw new Error("Auto mode: no allowed model has an API key.");
        current = { provider: route.provider, model: route.model };
        fallbacks = route.fallbacks.slice(0, 2);
        upsertStep({ ...step, status: "ok", label: `Auto: ${displayName(route.model)}, ${route.reason}` });
        patchMessage(assistantId, (m) => ({ ...m, autoReason: route.reason }));
      } else {
        current = manual!;
      }
      showModel(current);

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
      const sessionTools: SessionTools = {
        search: async (args) => formatSessionHits(await searchSessions({ ...args, excludeId: convId }), args),
        read: async (id, args) => (id === convId ? "That is the current chat; it is already in your context." : readSession(id, args)),
      };

      // Long-term memory: the memories most relevant to this question.
      const { selected: memories, total: memoryTotal } = settings.memory
        ? selectMemories(await listMemories(), [text, ...pages.map((p) => p.title)].join(" "))
        : { selected: [], total: 0 };
      if (memories.length > 0) patchMessage(assistantId, (m) => ({ ...m, memoriesUsed: memories.length }));
      const recent = settings.sessionMemory ? await recentChats(convId) : [];

      // Short-term memory: fold older turns into the running summary once the chat gets long.
      let summary = convRef.current.summary;
      const cut = summaryCut(convRef.current.api.slice(summary?.upTo ?? 0));
      if (cut > 0) {
        const from = summary?.upTo ?? 0;
        const summarizer = (autoOn ? choreModel(settings, providers) : undefined) ?? current;
        const step: Step = { id: `summary-${assistantId}`, tool: "summary", label: "Condensing earlier messages into memory", status: "running" };
        upsertStep(step);
        try {
          const condensed = await summarizeConversation({
            provider: summarizer.provider,
            model: summarizer.model,
            previous: summary?.text,
            messages: convRef.current.api.slice(from, from + cut),
            stream: streamModel,
            signal: controller.signal,
            sessionId: convId,
          });
          record(condensed.usage, summarizer.provider, summarizer.model.id);
          summary = { text: condensed.text, upTo: from + cut, updatedAt: Date.now() };
          const saved = summary;
          setConv((prev) => ({ ...prev, summary: saved }));
          upsertStep({ ...step, status: "ok", label: "Condensed earlier messages into memory", detail: condensed.text });
        } catch (error) {
          upsertStep({ ...step, status: "error", detail: `Kept full history instead: ${error instanceof Error ? error.message : String(error)}` });
        }
      }

      const executorFor = (canAct: boolean): ToolExecutor | null => {
        if (!canAct) return null;
        executor ??= new ToolExecutor(
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
                showApproval({
                  ...request,
                  resolve: (answer) => {
                    showApproval(null);
                    resolve(answer);
                  },
                });
              }),
            ask: (request) =>
              new Promise<string | null>((resolve) => {
                if (controller.signal.aborted) {
                  resolve(null);
                  return;
                }
                showQuestion({
                  ...request,
                  resolve: (answer) => {
                    showQuestion(null);
                    resolve(answer);
                  },
                });
              }),
            memory: settings.memory && settings.autoMemory ? memoryTools : undefined,
            sessions: settings.sessionMemory ? sessionTools : undefined,
          },
          activeTab?.id ?? null,
        );
        executorRef.current = executor;
        return executor;
      };

      for (let attempt = 0; ; attempt++) {
        const { provider, model } = current;
        const canAct = model.tools;
        const canRemember = canAct && settings.memory && settings.autoMemory;
        const canSearchChats = canAct && settings.sessionMemory;
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
            canAsk: canAct,
            canSearchChats,
            recentChats: canSearchChats ? recent : undefined,
          }),
          history: convRef.current.api.slice(summary?.upTo ?? 0),
          userMessage: { role: "user", content: buildUserContent(text, pages) },
          tools: canAct
            ? toolsFor({ vision: model.vision, screenshots: settings.screenshots, memory: canRemember, ask: true, sessions: canSearchChats })
            : undefined,
          maxSteps: settings.maxSteps,
          signal: controller.signal,
          executor: executorFor(canAct),
          stream: streamModel,
          sessionId: convId,
          takeSteering: () => steerRef.current.splice(0),
          callbacks: {
            onText: (delta) => patchMessage(assistantId, (m) => ({ ...m, text: m.text + delta })),
            onReasoning: (delta) => patchMessage(assistantId, (m) => ({ ...m, reasoning: (m.reasoning ?? "") + delta })),
            onStep: upsertStep,
            onUsage: (usage) => record(usage, provider, model.id),
          },
        });
        const next = fallbacks[attempt];
        const nothingProduced = result.api.every((m) => m.role === "user");
        if (result.end !== "error" || !nothingProduced || !next || controller.signal.aborted) break;
        // Steering consumed by the failed attempt goes to the next model.
        const lost = result.api
          .slice(1)
          .map((m) => (typeof m.content === "string" && m.content.startsWith(STEER_PREFIX) ? m.content.slice(STEER_PREFIX.length) : null))
          .filter((t): t is string => t !== null);
        steerRef.current.unshift(...lost);
        upsertStep({
          id: `fallback-${attempt}-${assistantId}`,
          tool: "auto",
          label: `${displayName(model)} failed; trying ${displayName(next.model)}`,
          status: "error",
          detail: result.error,
        });
        current = { provider: next.provider, model: next.model };
        showModel(current);
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      void recordUsage(ledger).catch(() => undefined);
      await (executor as ToolExecutor | null)?.finish().catch(() => undefined);
      abortRef.current = null;
      assistantRef.current = null;
      executorRef.current = null;
      steerRef.current = [];
      showApproval(null);
      showQuestion(null);
    }

    if (!result) {
      const stopped = controller.signal.aborted;
      patchMessage(assistantId, (m) => ({
        ...m,
        error: stopped ? "Stopped." : (failure ?? "Something went wrong."),
        durationMs: Date.now() - now,
        steps: (m.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "error", detail: "Cancelled." } : s)),
      }));
      setQueuePaused(true);
      await saveConversation(convRef.current);
      return;
    }

    const final = result;
    const notice =
      final.end === "cancelled"
        ? "Stopped."
        : final.end === "max_steps"
          ? `Reached the ${settings.maxSteps}-step limit. Say "continue" to keep going.`
          : undefined;
    patchMessage(assistantId, (m) => ({
      ...m,
      error: final.error,
      durationMs: Date.now() - now,
      text: notice && final.end !== "cancelled" ? `${m.text}${m.text ? "\n\n" : ""}_${notice}_` : m.text,
      steps: (m.steps ?? []).map((s) => (s.status === "running" ? { ...s, status: "error", detail: "Cancelled." } : s)),
      ...(final.end === "cancelled" && m.text === "" && (m.steps ?? []).every((s) => s.tool === "auto" || s.tool === "summary") ? { error: "Stopped." } : {}),
    }));
    setConv((prev) => ({ ...prev, api: [...prev.api, ...final.api], updatedAt: Date.now() }));
    await saveConversation(convRef.current);
    if (final.end === "done") void writeDigest(convRef.current, false);
    else setQueuePaused(true);
  }

  /** Redirect the running task: skip actions that haven't started and give the model this instruction. */
  const steer = useCallback(
    (input: string) => {
      const text = input.trim();
      if (text === "" || !busyRef.current) return;
      const assistantId = assistantRef.current;
      if (assistantId) {
        patchMessage(assistantId, (m) => ({
          ...m,
          steps: [...(m.steps ?? []), { id: `steer-${newId()}`, tool: "steer", label: `You: ${text}`, status: "ok" }],
        }));
      }
      const pendingQuestion = questionRef.current;
      if (pendingQuestion) {
        pendingQuestion.resolve(text);
        return;
      }
      steerRef.current.push(text);
      approvalRef.current?.resolve("deny");
      void executorRef.current?.flash("Got your update");
    },
    [patchMessage],
  );

  const queue = useCallback((input: string, options: SendOptions) => {
    const text = input.trim();
    if (text === "") return;
    setQueued((prev) => [...prev, { id: newId(), text, options }]);
  }, []);

  const removeQueued = useCallback((id: string) => setQueued((prev) => prev.filter((q) => q.id !== id)), []);

  /** Send a queued message right away: as a steer while running, otherwise as a normal message. */
  const sendQueuedNow = useCallback(
    (id: string) => {
      const item = queued.find((q) => q.id === id);
      if (!item) return;
      setQueued((prev) => prev.filter((q) => q.id !== id));
      if (busyRef.current) steer(item.text);
      else void send(item.text, item.options);
    },
    [queued, send, steer],
  );

  const runQueue = useCallback(() => setQueuePaused(false), []);

  // Run the next queued message after a task finishes normally.
  useEffect(() => {
    if (running || queuePaused || busyRef.current || queued.length === 0) return;
    const [next, ...rest] = queued;
    setQueued(rest);
    void send(next!.text, next!.options);
  }, [running, queuePaused, queued, send]);

  /** Re-ask the last question (after an error). */
  const retry = useCallback(
    (options: SendOptions) => {
      const messages = convRef.current.messages;
      const lastUser = [...messages].reverse().find((m) => m.role === "user");
      if (!lastUser || busyRef.current) return;
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
    [send, setConv],
  );

  return {
    conv,
    running,
    approval,
    question,
    queued,
    queuePaused,
    send,
    stop,
    retry,
    newChat,
    openConversation,
    steer,
    queue,
    removeQueued,
    sendQueuedNow,
    runQueue,
  };
}
