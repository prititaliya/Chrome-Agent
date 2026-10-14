import { useEffect, useState } from "react";
import { deleteKey, hasKey, saveKey } from "../../../src/storage/keys";

// Provider list is static until the provider registry lands (plan Task 8).
const PROVIDERS = ["openrouter"];

// Write-only key field: after save the input is cleared and only presence
// ("saved") is shown. The value is never rendered back.
export default function SettingsPanel() {
  const [provider, setProvider] = useState(PROVIDERS[0] ?? "openrouter");
  const [draft, setDraft] = useState("");
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void hasKey(provider).then((present) => {
      if (!cancelled) setSaved(present);
    });
    return () => {
      cancelled = true;
    };
  }, [provider]);

  async function onSave() {
    await saveKey(provider, draft);
    setDraft("");
    setSaved(draft.trim() !== "");
    setNotice(draft.trim() === "" ? "Key cleared." : "Key saved locally (this machine only).");
  }

  async function onDelete() {
    await deleteKey(provider);
    setDraft("");
    setSaved(false);
    setNotice("Key deleted.");
  }

  return (
    <section>
      <h2>Provider keys</h2>
      <label>
        Provider{" "}
        <select value={provider} onChange={(e) => setProvider(e.target.value)}>
          {PROVIDERS.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </label>
      <label>
        API key{" "}
        <input
          type="password"
          autoComplete="off"
          placeholder={saved ? "saved (enter a new key to replace)" : "paste key"}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button onClick={() => void onSave()}>Save key</button>
      <button onClick={() => void onDelete()} disabled={!saved && draft === ""}>
        Delete key
      </button>
      {saved && <p>Stored: yes (value never shown)</p>}
      {notice !== "" && <p role="status">{notice}</p>}
    </section>
  );
}
