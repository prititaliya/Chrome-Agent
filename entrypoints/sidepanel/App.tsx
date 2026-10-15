import { useCallback, useEffect, useMemo, useState } from "react";
import { autoCandidates } from "../../src/agent/router";
import type { TabInfo } from "../../src/browser/tabs";
import { isChatModel } from "../../src/providers/catalog";
import { onPendingPrompt, takePendingPrompt } from "../../src/storage/pending";
import { resolveModel, saveSettings } from "../../src/storage/settings";
import { OpenChatContext } from "../../src/ui/chatLinks";
import ChatView from "../../src/ui/components/ChatView";
import HistoryView from "../../src/ui/components/HistoryView";
import { BackIcon, BrainIcon, ChartIcon, GearIcon, HistoryIcon, PlusIcon } from "../../src/ui/components/Icons";
import MemoryView from "../../src/ui/components/MemoryView";
import ModelPicker from "../../src/ui/components/ModelPicker";
import SettingsView from "../../src/ui/components/SettingsView";
import UsageView from "../../src/ui/components/UsageView";
import { useStt } from "../../src/ui/hooks/useCatalog";
import { useChat } from "../../src/ui/hooks/useChat";
import { useActiveTab, useProviders, useSettings } from "../../src/ui/hooks/useStores";

type View = "chat" | "history" | "memory" | "usage" | "settings";

const TITLES: Record<Exclude<View, "chat">, string> = { history: "History", memory: "Memory", usage: "Usage & cost", settings: "Settings" };

export default function App() {
  const settings = useSettings();
  const providers = useProviders();
  const activeTab = useActiveTab();
  const [view, setView] = useState<View>("chat");
  const [draft, setDraft] = useState("");
  const [includeCurrent, setIncludeCurrent] = useState(true);
  const [attached, setAttached] = useState<TabInfo[]>([]);
  const [notice, setNotice] = useState("");
  const chat = useChat(settings.model);
  const stt = useStt(providers, settings.voice);
  const voice = useMemo(
    () => ({ choice: stt.choice, language: settings.voice.language, autoSend: settings.voice.autoSend }),
    [stt.choice, settings.voice.language, settings.voice.autoSend],
  );

  // Default to the first model of a provider that has a key.
  useEffect(() => {
    if (!providers || settings.auto.enabled) return;
    const current = resolveModel(providers, settings.model);
    if (current && isChatModel(current.model.id)) return;
    for (const p of providers) {
      const first = p.apiKey ? p.models.find((m) => isChatModel(m.id)) : undefined;
      if (first) {
        void saveSettings({ model: { providerId: p.id, modelId: first.id } });
        return;
      }
    }
  }, [providers, settings.model, settings.auto.enabled]);

  // A new active tab is shared again by default.
  useEffect(() => setIncludeCurrent(true), [activeTab?.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 3500);
    return () => clearTimeout(timer);
  }, [notice]);

  const sendOptions = useCallback(() => {
    const ids = attached.map((t) => t.id);
    setAttached([]);
    return { includeCurrentTab: includeCurrent, attachedTabIds: ids };
  }, [attached, includeCurrent]);

  const send = useCallback(
    (text: string) => {
      setView("chat");
      setDraft("");
      void chat.send(text, sendOptions());
    },
    [chat, sendOptions],
  );

  const steer = useCallback(
    (text: string) => {
      setDraft("");
      chat.steer(text);
    },
    [chat],
  );

  const queue = useCallback(
    (text: string) => {
      setDraft("");
      chat.queue(text, sendOptions());
    },
    [chat, sendOptions],
  );

  const openChat = useCallback(
    (id: string) => {
      if (chat.running) {
        setNotice("Finish or stop the current task before opening another chat.");
        return;
      }
      void chat.openConversation(id).then((opened) => {
        if (opened) setView("chat");
        else setNotice("This chat was deleted.");
      });
    },
    [chat],
  );

  // Context-menu prompts ("Summarize this page", "Ask about selection").
  useEffect(() => {
    const consume = () =>
      void takePendingPrompt().then((p) => {
        if (p) send(p.text);
      });
    consume();
    return onPendingPrompt(consume);
  }, [send]);

  const resolved = providers ? resolveModel(providers, settings.model) : null;
  const autoReady = settings.auto.enabled && providers !== null && autoCandidates(providers, settings.auto).length > 0;
  const lastAuto = [...chat.conv.messages].reverse().find((m) => m.role === "assistant" && m.autoReason && m.model);
  const shownModel = settings.auto.enabled && lastAuto?.modelRef && providers ? resolveModel(providers, lastAuto.modelRef) : resolved;
  const toggle = (next: View) => setView(view === next ? "chat" : next);
  return (
    <OpenChatContext.Provider value={openChat}>
      <div className="app">
        <header className="topbar">
          {view === "chat" ? (
            <ModelPicker
              providers={providers ?? []}
              value={settings.model}
              disabled={chat.running}
              auto={settings.auto.enabled}
              lastAutoModel={lastAuto?.model}
              onAuto={() => void saveSettings({ auto: { ...settings.auto, enabled: true } })}
              onChange={(model) => void saveSettings({ model, auto: { ...settings.auto, enabled: false } })}
              onManage={() => setView("settings")}
            />
          ) : (
            <button className="back-btn" onClick={() => setView("chat")} aria-label="Back to chat">
              <BackIcon size={15} />
              <span className="topbar-title">{TITLES[view]}</span>
            </button>
          )}
          <div className="topbar-actions">
            <button
              className="icon-btn"
              title="New chat"
              aria-label="New chat"
              disabled={chat.running}
              onClick={() => {
                chat.newChat();
                setView("chat");
              }}
            >
              <PlusIcon />
            </button>
            <button className={view === "history" ? "icon-btn active" : "icon-btn"} title="History" aria-label="History" onClick={() => toggle("history")}>
              <HistoryIcon />
            </button>
            <button className={view === "memory" ? "icon-btn active" : "icon-btn"} title="Memory" aria-label="Memory" onClick={() => toggle("memory")}>
              <BrainIcon />
            </button>
            <button className={view === "usage" ? "icon-btn active" : "icon-btn"} title="Usage & cost" aria-label="Usage" onClick={() => toggle("usage")}>
              <ChartIcon />
            </button>
            <button className={view === "settings" ? "icon-btn active" : "icon-btn"} title="Settings" aria-label="Settings" onClick={() => toggle("settings")}>
              <GearIcon />
            </button>
          </div>
        </header>
        {notice && (
          <p className="app-notice" role="status">
            {notice}
          </p>
        )}
        <main className="content">
          {view === "chat" && (
            <ChatView
              conv={chat.conv}
              running={chat.running}
              approval={chat.approval}
              question={chat.question}
              queued={chat.queued}
              queuePaused={chat.queuePaused}
              onSteer={steer}
              onQueue={queue}
              onRemoveQueued={chat.removeQueued}
              onSendQueuedNow={chat.sendQueuedNow}
              onRunQueue={chat.runQueue}
              activeTab={activeTab}
              attachPage={settings.attachPage}
              includeCurrent={includeCurrent}
              onToggleCurrent={setIncludeCurrent}
              attached={attached}
              onAttachedChange={setAttached}
              draft={draft}
              onDraftChange={setDraft}
              onSend={send}
              onStop={chat.stop}
              onRetry={() => chat.retry({ includeCurrentTab: includeCurrent, attachedTabIds: [] })}
              hasModel={settings.auto.enabled ? autoReady : resolved !== null}
              onOpenSettings={() => setView("settings")}
              onOpenUsage={() => setView("usage")}
              contextWindow={shownModel?.model.contextWindow}
              providerName={shownModel?.provider.name}
              voice={voice}
              onNotice={setNotice}
            />
          )}
          {view === "history" && <HistoryView currentId={chat.conv.id} onOpen={openChat} />}
          {view === "memory" && <MemoryView settings={settings} />}
          {view === "usage" && <UsageView onOpenSettings={() => setView("settings")} />}
          {view === "settings" && providers && <SettingsView providers={providers} settings={settings} />}
        </main>
      </div>
    </OpenChatContext.Provider>
  );
}
