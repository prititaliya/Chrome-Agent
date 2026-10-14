import { useState } from "react";
import ChatTab from "./tabs/ChatTab";
import HistoryTab from "./tabs/HistoryTab";
import SettingsTab from "./tabs/SettingsTab";

type TabId = "chat" | "history" | "settings";

const TABS: { id: TabId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "history", label: "History" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState<TabId>("chat");
  return (
    <div>
      <nav>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-pressed={tab === t.id}>
            {t.label}
          </button>
        ))}
      </nav>
      <main>
        {tab === "chat" && <ChatTab />}
        {tab === "history" && <HistoryTab />}
        {tab === "settings" && <SettingsTab />}
      </main>
    </div>
  );
}
