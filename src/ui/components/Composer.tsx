import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { isScriptableUrl } from "../../browser/content";
import { listTabs, type TabInfo } from "../../browser/tabs";
import type { QueuedMessage } from "../hooks/useChat";
import { AtIcon, CloseIcon, QueueIcon, SendIcon, StopIcon } from "./Icons";

interface Props {
  running: boolean;
  /** While running, Enter steers the current task. */
  onSteer: (text: string) => void;
  /** Alt+Enter (or the Queue button) saves the message for after the current task. */
  onQueue: (text: string) => void;
  queued: QueuedMessage[];
  queuePaused: boolean;
  onRemoveQueued: (id: string) => void;
  onSendQueuedNow: (id: string) => void;
  onRunQueue: () => void;
  activeTab: TabInfo | null;
  attachPage: boolean;
  includeCurrent: boolean;
  onToggleCurrent: (on: boolean) => void;
  attached: TabInfo[];
  onAttachedChange: (tabs: TabInfo[]) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  draft: string;
  onDraftChange: (text: string) => void;
}

function Favicon({ tab }: { tab: TabInfo }) {
  return tab.favIconUrl && /^https?:|^data:/.test(tab.favIconUrl) ? (
    <img className="favicon" src={tab.favIconUrl} alt="" />
  ) : (
    <span className="favicon favicon-blank" />
  );
}

const MENTION_RE = /(^|\s)@([^\s@]*)$/;

export default function Composer(props: Props) {
  const { running, activeTab, attached, draft } = props;
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<{ query: string; tabs: TabInfo[]; index: number } | null>(null);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [draft]);

  useEffect(() => {
    if (!running) inputRef.current?.focus();
  }, [running]);

  async function openPicker(query: string) {
    const tabs = (await listTabs()).filter(
      (t) => isScriptableUrl(t.url) && !attached.some((a) => a.id === t.id) && t.id !== (props.includeCurrent ? activeTab?.id : -1),
    );
    const q = query.toLowerCase();
    const filtered = tabs.filter((t) => t.title.toLowerCase().includes(q) || t.url.toLowerCase().includes(q));
    setPicker({ query, tabs: filtered.slice(0, 8), index: 0 });
  }

  function onChange(value: string) {
    props.onDraftChange(value);
    const caret = inputRef.current?.selectionStart ?? value.length;
    const match = MENTION_RE.exec(value.slice(0, caret));
    if (match) void openPicker(match[2] ?? "");
    else setPicker(null);
  }

  function choose(tab: TabInfo) {
    const caret = inputRef.current?.selectionStart ?? draft.length;
    const before = draft.slice(0, caret).replace(MENTION_RE, "$1");
    props.onDraftChange(before + draft.slice(caret));
    props.onAttachedChange([...attached, tab]);
    setPicker(null);
    inputRef.current?.focus();
  }

  function submit() {
    if (draft.trim() === "") return;
    if (running) props.onSteer(draft);
    else props.onSend(draft);
    setPicker(null);
  }

  function queueDraft() {
    if (draft.trim() === "") return;
    if (running) props.onQueue(draft);
    else props.onSend(draft);
    setPicker(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (picker && picker.tabs.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const delta = e.key === "ArrowDown" ? 1 : -1;
        setPicker({ ...picker, index: (picker.index + delta + picker.tabs.length) % picker.tabs.length });
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const tab = picker.tabs[picker.index];
        if (tab) choose(tab);
        return;
      }
    }
    if (e.key === "Escape" && picker) {
      setPicker(null);
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (e.altKey) queueDraft();
      else submit();
    }
  }

  const showCurrent = props.attachPage && activeTab !== null;
  const hasDraft = draft.trim() !== "";
  return (
    <div className="composer">
      {props.queued.length > 0 && (
        <div className="queue" aria-label="Queued messages">
          <div className="queue-head">
            <span>
              {props.queued.length} queued{props.queuePaused ? " (paused)" : running ? ", runs after this task" : ""}
            </span>
            {props.queuePaused && !running && (
              <button className="link-btn small" onClick={props.onRunQueue}>
                Run queued ({props.queued.length})
              </button>
            )}
          </div>
          {props.queued.map((q) => (
            <div key={q.id} className="queue-item">
              <span className="queue-text" title={q.text}>
                {q.text}
              </span>
              <button className="link-btn small" onClick={() => props.onSendQueuedNow(q.id)} title={running ? "Send now as a steer" : "Send now"}>
                Send now
              </button>
              <button className="chip-x" aria-label={`Remove queued message ${q.text}`} onClick={() => props.onRemoveQueued(q.id)}>
                <CloseIcon size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      {picker && (
        <div className="picker" role="listbox" aria-label="Attach a tab">
          <div className="picker-title">Attach a tab</div>
          {picker.tabs.length === 0 && <div className="picker-empty">No matching tabs</div>}
          {picker.tabs.map((t, i) => (
            <button
              key={t.id}
              role="option"
              aria-selected={i === picker.index}
              className={i === picker.index ? "picker-item active" : "picker-item"}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(t);
              }}
            >
              <Favicon tab={t} />
              <span className="picker-text">{t.title || t.url}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chips">
        {showCurrent && (
          <button
            className={props.includeCurrent ? "chip chip-on" : "chip chip-off"}
            onClick={() => props.onToggleCurrent(!props.includeCurrent)}
            title={props.includeCurrent ? "Current tab is shared with the assistant (click to exclude)" : "Click to share the current tab"}
          >
            <Favicon tab={activeTab} />
            <span className="chip-text">{activeTab.title || activeTab.url}</span>
            {props.includeCurrent ? <CloseIcon size={11} /> : <span className="chip-add">+</span>}
          </button>
        )}
        {attached.map((t) => (
          <span key={t.id} className="chip chip-on">
            <Favicon tab={t} />
            <span className="chip-text">{t.title || t.url}</span>
            <button
              className="chip-x"
              aria-label={`Remove ${t.title}`}
              onClick={() => props.onAttachedChange(attached.filter((a) => a.id !== t.id))}
            >
              <CloseIcon size={11} />
            </button>
          </span>
        ))}
        <button className="chip chip-ghost" onClick={() => (picker ? setPicker(null) : void openPicker(""))} title="Attach another tab (or type @)">
          <AtIcon size={12} />
          <span>Add tab</span>
        </button>
      </div>
      <div className="input-row">
        <textarea
          ref={inputRef}
          rows={1}
          value={draft}
          placeholder={running ? "Steer the agent, or queue a follow-up…" : "Ask anything, or tell me what to do…"}
          aria-label="Message"
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {running ? (
          <>
            {hasDraft && (
              <>
                <button className="send ghost" onClick={queueDraft} aria-label="Queue" title="Queue: run after this task (Alt+Enter)">
                  <QueueIcon size={16} />
                </button>
                <button className="send" onClick={submit} aria-label="Steer" title="Steer: tell the agent now (Enter)">
                  <SendIcon size={16} />
                </button>
              </>
            )}
            <button className="send stop" onClick={props.onStop} aria-label="Stop">
              <StopIcon size={16} />
            </button>
          </>
        ) : (
          <button className="send" onClick={submit} disabled={draft.trim() === ""} aria-label="Send">
            <SendIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
