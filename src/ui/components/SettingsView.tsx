import { useState } from "react";
import { isChatModel } from "../../providers/catalog";
import type { ProviderConfig } from "../../providers/types";
import { clearConversations } from "../../storage/conversations";
import { removeProvider, saveSettings, upsertProvider, type Settings } from "../../storage/settings";
import AutoModelSettings from "./AutoModelSettings";
import ProviderEditor, { blankProvider } from "./ProviderEditor";
import VoiceInputSettings from "./VoiceInputSettings";

interface Props {
  providers: ProviderConfig[];
  settings: Settings;
}

export default function SettingsView({ providers, settings }: Props) {
  const [editing, setEditing] = useState<{ provider: ProviderConfig; isNew: boolean } | null>(null);
  const [addPreset, setAddPreset] = useState<"openrouter" | "opencode-go" | "custom">("custom");
  const [notice, setNotice] = useState("");

  if (editing) {
    return (
      <div className="page">
        <ProviderEditor
          initial={editing.provider}
          isNew={editing.isNew}
          onCancel={() => setEditing(null)}
          onSave={(provider) => {
            void upsertProvider(provider).then(async () => {
              // First usable model becomes the default so chat works right away.
              const first = provider.models.find((m) => isChatModel(m.id));
              if (!settings.model && first && provider.apiKey) {
                await saveSettings({ model: { providerId: provider.id, modelId: first.id } });
              }
              setEditing(null);
              setNotice(`Saved ${provider.name}.`);
            });
          }}
        />
      </div>
    );
  }

  return (
    <div className="page settings">
      {notice && (
        <p className="status status-ok" role="status">
          {notice}
        </p>
      )}
      <section>
        <h2>Providers</h2>
        <p className="muted">Bring your own API keys. Any OpenAI-compatible endpoint works.</p>
        <ul className="provider-list">
          {providers.map((p) => (
            <li key={p.id} className="provider">
              <div className="provider-main">
                <strong>{p.name}</strong>
                <span className="muted small">{p.baseUrl}</span>
                <span className="small">
                  {p.apiKey ? <span className="ok">● key saved</span> : <span className="warn">● no key</span>} · {p.models.length} models
                </span>
              </div>
              <div className="provider-actions">
                <button className="btn small" onClick={() => setEditing({ provider: p, isNew: false })}>
                  {p.apiKey ? "Edit" : "Add key"}
                </button>
                <button
                  className="btn small ghost"
                  onClick={() => {
                    if (confirm(`Remove ${p.name}?`)) void removeProvider(p.id);
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="row">
          <select value={addPreset} onChange={(e) => setAddPreset(e.target.value as typeof addPreset)} aria-label="Provider type">
            <option value="custom">Custom (OpenAI-compatible)</option>
            <option value="openrouter">OpenRouter</option>
            <option value="opencode-go">OpenCode Go</option>
          </select>
          <button className="btn primary small" onClick={() => setEditing({ provider: blankProvider(addPreset), isNew: true })}>
            Add provider
          </button>
        </div>
      </section>

      <AutoModelSettings providers={providers} settings={settings} />

      <VoiceInputSettings providers={providers} settings={settings} />

      <section>
        <h2>Browser control</h2>
        <label className="radio">
          <input
            type="radio"
            name="control"
            checked={settings.controlMode === "cdp"}
            onChange={() => void saveSettings({ controlMode: "cdp" })}
          />
          <span>
            <strong>Full control (recommended)</strong>
            <small className="muted">Real mouse and keyboard input via Chrome's debugger. Works on every site; Chrome shows a "started debugging" bar while the agent acts.</small>
          </span>
        </label>
        <label className="radio">
          <input
            type="radio"
            name="control"
            checked={settings.controlMode === "dom"}
            onChange={() => void saveSettings({ controlMode: "dom" })}
          />
          <span>
            <strong>Basic</strong>
            <small className="muted">Simulated events only. No debugging bar, but some sites ignore simulated clicks and typing.</small>
          </span>
        </label>
        <label className="field inline">
          <span>Max steps per request</span>
          <input
            type="number"
            min={3}
            max={100}
            value={settings.maxSteps}
            onChange={(e) => void saveSettings({ maxSteps: Math.max(3, Math.min(100, Number(e.target.value) || 30)) })}
          />
        </label>
        <label className="field inline">
          <span>Search engine</span>
          <select value={settings.searchEngine} onChange={(e) => void saveSettings({ searchEngine: e.target.value as Settings["searchEngine"] })}>
            <option value="google">Google</option>
            <option value="duckduckgo">DuckDuckGo</option>
            <option value="bing">Bing</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.attachPage} onChange={(e) => void saveSettings({ attachPage: e.target.checked })} />
          <span>Share the current tab with every question</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.screenshots} onChange={(e) => void saveSettings({ screenshots: e.target.checked })} />
          <span>Let vision models take screenshots</span>
        </label>
      </section>

      <section>
        <h2>Data</h2>
        <p className="muted">Conversations and their digests are stored only in this browser.</p>
        <button
          className="btn danger small"
          onClick={() => {
            if (confirm("Delete all conversations?")) void clearConversations().then(() => setNotice("History cleared."));
          }}
        >
          Clear all history
        </button>
      </section>
    </div>
  );
}
