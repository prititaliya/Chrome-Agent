import { useEffect, useMemo, useState } from "react";
import {
  clearMemories,
  deleteMemory,
  listMemories,
  MEMORY_MAX_CHARS,
  saveMemory,
  searchMemories,
  updateMemoryText,
  watchMemories,
  type Memory,
} from "../../storage/memory";
import { saveSettings, type Settings } from "../../storage/settings";
import { when } from "../time";
import { PencilIcon, TrashIcon } from "./Icons";

function MemoryItem({ memory, onError }: { memory: Memory; onError: (message: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = () => {
    if (editing === null) return;
    void updateMemoryText(memory.id, editing)
      .then(() => setEditing(null))
      .catch((error: unknown) => onError(error instanceof Error ? error.message : String(error)));
  };
  return (
    <li className="memory">
      {editing === null ? (
        <>
          <div className="memory-main">
            <p className="memory-text">{memory.text}</p>
            <span className="memory-meta">
              {memory.source === "assistant" ? "Saved by assistant" : "Added by you"} · {when(memory.updatedAt)}
            </span>
          </div>
          <button className="icon-btn tiny" aria-label={`Edit memory: ${memory.text}`} title="Edit" onClick={() => setEditing(memory.text)}>
            <PencilIcon size={12} />
          </button>
          <button className="icon-btn tiny" aria-label={`Delete memory: ${memory.text}`} title="Delete" onClick={() => void deleteMemory(memory.id)}>
            <TrashIcon size={13} />
          </button>
        </>
      ) : (
        <div className="memory-edit">
          <textarea
            value={editing}
            maxLength={MEMORY_MAX_CHARS}
            rows={2}
            autoFocus
            aria-label="Edit memory"
            onChange={(e) => setEditing(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                save();
              }
              if (e.key === "Escape") setEditing(null);
            }}
          />
          <div className="row">
            <button className="btn small primary" onClick={save} disabled={editing.trim() === ""}>
              Save
            </button>
            <button className="btn small ghost" onClick={() => setEditing(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export default function MemoryView({ settings }: { settings: Settings }) {
  const [memories, setMemories] = useState<Memory[] | null>(null);
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    void listMemories().then(setMemories);
    return watchMemories(setMemories);
  }, []);

  const shown = useMemo(() => {
    if (!memories) return [];
    return query.trim() === "" ? memories : searchMemories(memories, query, memories.length);
  }, [memories, query]);

  function add() {
    setError("");
    void saveMemory({ text: draft, source: "user" })
      .then(() => setDraft(""))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }

  if (memories === null) return <div className="page" />;
  return (
    <div className="page memory-page">
      <section>
        <label className="check">
          <input type="checkbox" checked={settings.memory} onChange={(e) => void saveSettings({ memory: e.target.checked })} />
          <span>
            <strong>Use long-term memory</strong>
            <small className="muted">Include what the assistant knows about you in every chat.</small>
          </span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.autoMemory}
            disabled={!settings.memory}
            onChange={(e) => void saveSettings({ autoMemory: e.target.checked })}
          />
          <span>
            <strong>Let the assistant save memories</strong>
            <small className="muted">It remembers preferences and facts you mention. Each save shows up as a step in the chat. Passwords, keys and card numbers are never stored.</small>
          </span>
        </label>
        <label className="check">
          <input type="checkbox" checked={settings.sessionMemory} onChange={(e) => void saveSettings({ sessionMemory: e.target.checked })} />
          <span>
            <strong>Remember past chats</strong>
            <small className="muted">
              After each chat, a short digest of what happened is saved in this browser, and the assistant can search and read earlier chats when you ask about them. Secret values (keys, passwords, codes) are blanked out.
            </small>
          </span>
        </label>
      </section>

      <section>
        <h2>Saved memories ({memories.length})</h2>
        <div className="row memory-add">
          <input
            value={draft}
            maxLength={MEMORY_MAX_CHARS}
            placeholder="Add something to remember, e.g. I live in Ahmedabad"
            aria-label="New memory"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && draft.trim() !== "") add();
            }}
          />
          <button className="btn small primary" onClick={add} disabled={draft.trim() === ""}>
            Add
          </button>
        </div>
        {error && (
          <p className="status status-error" role="alert">
            {error}
          </p>
        )}
        {memories.length > 6 && (
          <input className="search" type="search" placeholder="Search memories" aria-label="Search memories" value={query} onChange={(e) => setQuery(e.target.value)} />
        )}
        {memories.length === 0 ? (
          <p className="muted memory-empty">
            Nothing saved yet. Tell the assistant things like "remember that I prefer short answers" or add them here.
          </p>
        ) : (
          <ul className="memory-list">
            {shown.map((m) => (
              <MemoryItem key={m.id} memory={m} onError={setError} />
            ))}
            {shown.length === 0 && <li className="muted">No matches.</li>}
          </ul>
        )}
      </section>

      <section>
        <h2>Short-term memory</h2>
        <p className="muted small">
          Long chats are condensed automatically: older messages are summarized so the assistant keeps the thread without running out of context. Open
          a chat's summary from the bar above the message box.
        </p>
      </section>

      {memories.length > 0 && (
        <div className="page-actions">
          <button
            className="btn small danger"
            onClick={() => {
              if (confirm("Delete all memories?")) void clearMemories();
            }}
          >
            Forget everything
          </button>
        </div>
      )}
    </div>
  );
}
