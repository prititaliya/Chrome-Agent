import { useCallback, useEffect, useState } from "react";
import type { TabInfo } from "../../src/browser/tabs";
import { onPendingPrompt, takePendingPrompt } from "../../src/storage/pending";
import { resolveModel, saveSettings } from "../../src/storage/settings";
import ChatView from "../../src/ui/components/ChatView";
import HistoryView from "../../src/ui/components/HistoryView";
import { BackIcon, BrainIcon, ChartIcon, GearIcon, HistoryIcon, PlusIcon } from "../../src/ui/components/Icons";
import MemoryView from "../../src/ui/components/MemoryView";
import ModelPicker from "../../src/ui/components/ModelPicker";
import SettingsView from "../../src/ui/components/SettingsView";
import UsageView from "../../src/ui/components/UsageView";
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
  const chat = useChat(settings.model);

  // Default to the first model of a provider that has a key.
  useEffect(() => {
    if (!providers || resolveModel(providers, settings.model)) return;
    const ready = providers.find((p) => p.apiKey && p.models.length > 0);
    if (ready) void saveSettings({ model: { providerId: ready.id, modelId: ready.models[0]!.id } });
  }, [providers, settings.model]);

  // A new active tab is shared again by default.
  useEffect(() => setIncludeCurrent(true), [activeTab?.id]);

  const send = useCallback(
    (text: string) => {
      setView("chat");
      setDraft("");
      const ids = attached.map((t) => t.id);
      setAttached([]);
      void chat.send(text, { includeCurrentTab: includeCurrent, attachedTabIds: ids });
    },
    [attached, chat, includeCurrent],
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
  const toggle = (next: View) => setView(view === next ? "chat" : next);
  return (
    <div className="app">
      <header className="topbar">
        {view === "chat" ? (
          <ModelPicker
            providers={providers ?? []}
            value={settings.model}
            disabled={chat.running}
            onChange={(model) => void saveSettings({ model })}
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
      <main className="content">
        {view === "chat" && (
          <ChatView
            conv={chat.conv}
            running={chat.running}
            approval={chat.approval}
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
            hasModel={resolved !== null}
            onOpenSettings={() => setView("settings")}
            onOpenUsage={() => setView("usage")}
            contextWindow={resolved?.model.contextWindow}
            providerName={resolved?.provider.name}
          />
        )}
        {view === "history" && (
          <HistoryView
            currentId={chat.conv.id}
            onOpen={(id) => {
              void chat.openConversation(id).then(() => setView("chat"));
            }}
          />
        )}
        {view === "memory" && <MemoryView settings={settings} />}
        {view === "usage" && <UsageView onOpenSettings={() => setView("settings")} />}
        {view === "settings" && providers && <SettingsView providers={providers} settings={settings} />}
      </main>
    </div>
  );
}
