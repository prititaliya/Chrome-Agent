import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import { ulid } from "../../src/lib/ulid";
import { handlePanelPorts, type Reply } from "../../src/messaging/port";
import type { BackgroundEvent, PanelCommand } from "../../src/messaging/protocol";
import {
  loadCustomProviders,
  materializeDiscoveredModel,
  resolveProvider,
} from "../../src/providers/registry";
import { refreshModels } from "../../src/providers/models";
import { streamChatCompletions, type ChatMessage } from "../../src/providers/wire/chat-completions";
import {
  cloneThread,
  createThread,
  deleteThread,
  finalizeThread,
  getThread,
  listThreads,
  putThreadExact,
  renameThread,
  setPinned,
} from "../../src/storage/history/store";
import { parseImportedThread, resolveImport } from "../../src/storage/history/export";
import { searchThreads } from "../../src/storage/history/index";
import { getSettings } from "../../src/storage/settings";
import { executeToolCall, TabGenerations, type ContentSender } from "../../src/tools/executor";
import { toolSchemasForProvider } from "../../src/tools/table";
import { loadState } from "../../src/agent/checkpoint";
import {
  resumeLoop,
  resumeThreadAsNewRun,
  runLoop,
  type LoopDeps,
  type PendingToolCall,
} from "../../src/agent/loop";
import type { PendingGate } from "../../src/agent/machine";
import type { AttestFacts } from "../../src/dom/attest-facts";
import { createAreaRunStore, resumeRuns } from "../../src/storage/runs";
import { readKey } from "../../src/storage/keys";
import { ensureOriginPermission, originOfUrl } from "../../src/security/origins";
import { armDevReload } from "./dev-reload";
import { AGENT_PORT_NAME } from "../../src/messaging/port";
import type { ContentResponse } from "../../src/messaging/content-protocol";

const runStore = createAreaRunStore(browser.storage.session);
const liveRuns = new Map<string, AbortController>();
const gateWaiters = new Map<string, (approved: boolean) => void>();
const tabGens = new TabGenerations();

// Panels come and go; the loop outlives all of them. A second onConnect
// listener (beside the command router) maintains the broadcast set.
const panelPorts = new Set<{ postMessage: (msg: unknown) => void }>();

function broadcast(event: BackgroundEvent): void {
  for (const port of panelPorts) {
    try {
      port.postMessage(event);
    } catch {
      // Dead port: pruned on disconnect.
    }
  }
}

async function serveModelList(
  command: Extract<PanelCommand, { type: "listModels" }>,
  reply: Reply,
): Promise<void> {
  try {
    const entry = resolveProvider(command.providerId, await loadCustomProviders());
    const apiKey = await readKey(command.providerId);
    const models = await refreshModels(entry.def, apiKey, { force: command.force });
    reply({ v: 1, type: "models", providerId: command.providerId, models });
  } catch (error) {
    reply({
      v: 1,
      type: "modelsError",
      providerId: command.providerId,
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function serveHistory(
  command: Extract<
    PanelCommand,
    | { type: "listThreads" }
    | { type: "openThread" }
    | { type: "renameThread" }
    | { type: "deleteThread" }
    | { type: "cloneThread" }
    | { type: "pinThread" }
    | { type: "importThread" }
    | { type: "searchThreads" }
  >,
  reply: Reply,
): Promise<void> {
  try {
    switch (command.type) {
      case "listThreads":
        reply({ v: 1, type: "threads", threads: await listThreads() });
        break;
      case "openThread":
        reply({ v: 1, type: "thread", thread: (await getThread(command.threadId)) ?? null });
        break;
      case "renameThread":
        await renameThread(command.threadId, command.title);
        reply({ v: 1, type: "threads", threads: await listThreads() });
        break;
      case "deleteThread":
        await deleteThread(command.threadId);
        reply({ v: 1, type: "threads", threads: await listThreads() });
        break;
      case "cloneThread":
        await cloneThread(command.threadId);
        reply({ v: 1, type: "threads", threads: await listThreads() });
        break;
      case "pinThread":
        await setPinned(command.threadId, command.pinned);
        reply({ v: 1, type: "threads", threads: await listThreads() });
        break;
      case "importThread": {
        const incoming = parseImportedThread(command.json);
        const existing = (await getThread(incoming.id)) ?? null;
        const { action, thread } = resolveImport(existing, incoming, command.onConflict, ulid);
        if (action !== "skipped") await putThreadExact(thread);
        reply({ v: 1, type: "importResult", action, threadId: thread.id });
        reply({ v: 1, type: "threads", threads: await listThreads() });
        break;
      }
      case "searchThreads": {
        const entries = await listThreads();
        reply({
          v: 1,
          type: "searchResults",
          results: await searchThreads(entries, command.query, getThread),
        });
        break;
      }
    }
  } catch (error) {
    reply({
      v: 1,
      type: "historyError",
      reason: error instanceof Error ? error.message : "unknown error",
    });
  }
}

async function activeTabId(): Promise<number> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) throw new Error("no active tab");
  return tab.id;
}

const contentSender: ContentSender = async (tabId, request) => {
  try {
    return (await browser.tabs.sendMessage(tabId, request)) as ContentResponse;
  } catch {
    return { ok: false, code: "E_TAB_GONE" };
  }
};

interface LiveModel {
  providerId: string;
  modelId: string;
  apiKey: string;
  entry: ReturnType<typeof resolveProvider>;
  model: { id: string; wire: "chat.completions" | "responses" };
}

async function resolveLiveModel(): Promise<LiveModel> {
  const settings = await getSettings();
  const entry = resolveProvider(settings.defaultProvider, await loadCustomProviders());
  if (settings.defaultModel === "") throw new Error("Select a model in the Chat tab first.");
  const apiKey = await readKey(entry.def.id);
  if (!apiKey) throw new Error(`Save a key for ${entry.def.label} in Settings first.`);
  const models = await refreshModels(entry.def, apiKey).catch(() => []);
  const found = models.find((m) => m.id === settings.defaultModel);
  const model = found ?? materializeDiscoveredModel(entry.def, settings.defaultModel);
  return { providerId: entry.def.id, modelId: model.id, apiKey, entry, model };
}

function buildLiveDeps(runId: string, live: LiveModel, signal: AbortSignal): LoopDeps {
  return {
    chat: (messages: ChatMessage[]) =>
      streamChatCompletions({
        def: live.entry.def,
        model: {
          ...live.model,
          label: live.model.id,
          contextWindow: 0,
          maxOutput: 0,
          supportsTools: true,
          supportsVision: false,
          reasoning: false,
        },
        apiKey: live.apiKey,
        messages,
        tools: toolSchemasForProvider(),
      }),
    execute: (call: PendingToolCall) =>
      executeToolCall(call, {
        sender: contentSender,
        activeTab: activeTabId,
        getTabUrl: async (tabId) => (await browser.tabs.get(tabId).catch(() => null))?.url,
        generations: tabGens,
      }),
    attest: async (call: PendingToolCall): Promise<AttestFacts | undefined> => {
      const argRecord = (call.args ?? {}) as Record<string, unknown>;
      const rawTab = argRecord["tab"];
      const tabId = typeof rawTab === "number" ? rawTab : await activeTabId();
      const rawRef = argRecord["ref"];
      const response = await contentSender(tabId, {
        type: "agent/attest",
        gen: tabGens.current(tabId),
        ref: typeof rawRef === "number" ? rawRef : undefined,
      });
      if (!response.ok || response.kind !== "attest") return undefined;
      return response.facts;
    },
    awaitApproval: (awaitRunId: string, gate: PendingGate): Promise<boolean> => {
      broadcast({ v: 1, type: "gateRequest", runId: awaitRunId, gate });
      return new Promise<boolean>((resolve) => {
        gateWaiters.set(awaitRunId, resolve);
      });
    },
    emit: (event) => broadcast({ v: 1, ...event }),
    store: runStore,
    settings: { maxSteps: 25, maxToolCalls: 60, maxCostUSD: 0.5 },
    signal,
  };
}

async function failThread(runId: string, note: string): Promise<void> {
  await createThread({ id: runId, firstMessage: { role: "user", content: note } });
  await finalizeThread(runId, "failed");
  broadcast({ v: 1, type: "runState", runId, status: "failed" });
}

async function startRun(task: string): Promise<void> {
  const runId = ulid();
  const controller = new AbortController();
  liveRuns.set(runId, controller);
  try {
    const settings = await getSettings();
    const live = await resolveLiveModel();
    // Closest thing to the Start-click gesture: prompt for the active tab's
    // origin now; per-dispatch checks after this never prompt.
    let grantedOrigins: string[] = [];
    try {
      const tab = await browser.tabs.get(await activeTabId()).catch(() => null);
      const origin = tab?.url ? originOfUrl(tab.url) : null;
      if (origin && (await ensureOriginPermission(origin)) === "granted") {
        grantedOrigins = [origin];
      }
    } catch {
      // Permission API unavailable: continue open; dispatch checks still apply.
    }
    const deps = buildLiveDeps(runId, live, controller.signal);
    deps.settings = {
      maxSteps: settings.maxSteps,
      maxToolCalls: settings.maxToolCalls,
      maxCostUSD: settings.maxCostUSD,
    };
    await runLoop(task, runId, deps, { providerId: live.providerId, modelId: live.modelId, grantedOrigins });
  } catch (error) {
    await failThread(runId, `Run setup failed: ${error instanceof Error ? error.message : "unknown"}`);
  } finally {
    liveRuns.delete(runId);
  }
}

async function resumeRun(oldThreadId: string): Promise<void> {
  const runId = ulid();
  const controller = new AbortController();
  liveRuns.set(runId, controller);
  try {
    const settings = await getSettings();
    const live = await resolveLiveModel();
    const deps = buildLiveDeps(runId, live, controller.signal);
    deps.settings = {
      maxSteps: settings.maxSteps,
      maxToolCalls: settings.maxToolCalls,
      maxCostUSD: settings.maxCostUSD,
    };
    await resumeThreadAsNewRun(oldThreadId, runId, deps, {
      providerId: live.providerId,
      modelId: live.modelId,
    });
  } catch (error) {
    await failThread(runId, `Resume failed: ${error instanceof Error ? error.message : "unknown"}`);
  } finally {
    liveRuns.delete(runId);
  }
}

export default defineBackground(() => {
  console.log("bg:ready");

  // Unpacked-build workflow only; silent no-op when no dev server listens.
  void armDevReload();

  // Best-effort keepalive (>=1 min on Chrome <120, >=0.5 min on >=120).
  // Durability comes from checkpoints, not from staying alive.
  void browser.alarms.create("agent-keepalive", { periodInMinutes: 1 });

  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== AGENT_PORT_NAME) return;
    panelPorts.add(port);
    port.onDisconnect.addListener(() => {
      panelPorts.delete(port);
    });
  });

  handlePanelPorts((command, reply) => {
    if (command.type === "ping") {
      reply({ v: 1, type: "pong" });
      return;
    }
    if (command.type === "listModels") {
      void serveModelList(command, reply);
      return;
    }
    if (command.type === "startRun") {
      // Acknowledge immediately; progress streams as run events.
      reply({ v: 1, type: "runState", runId: "pending", status: "running" });
      void startRun(command.task);
      return;
    }
    if (command.type === "stopRun") {
      liveRuns.get(command.runId)?.abort();
      return;
    }
    if (command.type === "resolveGate") {
      gateWaiters.get(command.runId)?.(command.approved);
      gateWaiters.delete(command.runId);
      return;
    }
    if (command.type === "resumeThread") {
      reply({ v: 1, type: "runState", runId: "pending", status: "running" });
      void resumeRun(command.threadId);
      return;
    }
    if (
      command.type === "listThreads" ||
      command.type === "openThread" ||
      command.type === "renameThread" ||
      command.type === "deleteThread" ||
      command.type === "cloneThread" ||
      command.type === "pinThread" ||
      command.type === "importThread" ||
      command.type === "searchThreads"
    ) {
      void serveHistory(command, reply);
      return;
    }
    // Exhaustive: adding a PanelCommand without a branch above is a type error.
    const _exhaustive: never = command;
    void _exhaustive;
    reply({ v: 1, type: "protocolError", reason: "unsupported command" });
  });

  void runStore
    .get("__boot__")
    .catch(() => undefined)
    .then(() => lockSessionToTrustedContexts())
    .then(() =>
      resumeRuns(runStore, async (checkpoint) => {
        const state = await loadState(runStore, checkpoint.runId);
        if (!state) return;
        const controller = new AbortController();
        liveRuns.set(state.runId, controller);
        try {
          const settings = await getSettings();
          const live = await resolveLiveModel();
          const deps = buildLiveDeps(state.runId, live, controller.signal);
          deps.settings = {
            maxSteps: settings.maxSteps,
            maxToolCalls: settings.maxToolCalls,
            maxCostUSD: settings.maxCostUSD,
          };
          await resumeLoop(state, deps);
        } catch {
          await finalizeThread(state.runId, "failed");
          broadcast({ v: 1, type: "runState", runId: state.runId, status: "failed" });
        } finally {
          liveRuns.delete(state.runId);
        }
      }),
    );
});

// Hide run state from content scripts. No-op on engines without the API.
async function lockSessionToTrustedContexts(): Promise<void> {
  const session = browser.storage.session as unknown as {
    setAccessLevel?: (options: { accessLevel: string }) => Promise<void>;
  };
  if (typeof session.setAccessLevel === "function") {
    await session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" });
  }
}
