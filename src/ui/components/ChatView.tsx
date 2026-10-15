import { useEffect, useMemo, useRef, useState } from "react";
import iconUrl from "../../../assets/icon.svg";
import { costLabel, formatTokens } from "../../agent/usage";
import type { TabInfo } from "../../browser/tabs";
import { conversationUsage, type Conversation } from "../../storage/conversations";
import type { PendingApproval, PendingQuestion, QueuedMessage } from "../hooks/useChat";
import ApprovalCard from "./ApprovalCard";
import Composer, { type VoiceConfig } from "./Composer";
import Markdown from "../markdown";
import MessageView from "./MessageView";
import QuestionCard from "./QuestionCard";
import UsageBreakdown from "./UsageBreakdown";

export const QUICK_ACTIONS: { label: string; hint: string; prompt: string }[] = [
  { label: "Summarize", hint: "this page in a few lines", prompt: "Summarize this page." },
  { label: "Key points", hint: "as a bullet list", prompt: "List the key points of this page as bullets." },
  { label: "Explain", hint: "the text I selected", prompt: "Explain the text I selected on this page in simple terms." },
  { label: "Translate", hint: "the page into English", prompt: "Translate the main content of this page into English." },
];

interface Props {
  conv: Conversation;
  running: boolean;
  approval: PendingApproval | null;
  question: PendingQuestion | null;
  queued: QueuedMessage[];
  queuePaused: boolean;
  onSteer: (text: string) => void;
  onQueue: (text: string) => void;
  onRemoveQueued: (id: string) => void;
  onSendQueuedNow: (id: string) => void;
  onRunQueue: () => void;
  activeTab: TabInfo | null;
  attachPage: boolean;
  includeCurrent: boolean;
  onToggleCurrent: (on: boolean) => void;
  attached: TabInfo[];
  onAttachedChange: (tabs: TabInfo[]) => void;
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => void;
  onStop: () => void;
  onRetry: () => void;
  hasModel: boolean;
  onOpenSettings: () => void;
  onOpenUsage: () => void;
  /** Context window of the selected model, when known. */
  contextWindow?: number;
  providerName?: string;
  voice: VoiceConfig;
  onNotice: (message: string) => void;
}

function ChatStats({ conv, contextWindow, providerName, onOpenUsage }: Pick<Props, "conv" | "contextWindow" | "providerName" | "onOpenUsage">) {
  const [open, setOpen] = useState<"usage" | "summary" | null>(null);
  const usage = useMemo(() => conversationUsage(conv), [conv]);
  if (usage.requests === 0) return null;
  const fill = contextWindow ? Math.min(1, usage.lastInput / contextWindow) : null;
  return (
    <div className="chat-stats">
      <div className="chat-stats-row">
        <button
          className="stats-btn"
          onClick={() => setOpen(open === "usage" ? null : "usage")}
          aria-expanded={open === "usage"}
          title="This chat's token and cost breakdown"
        >
          <span className="stats-label">This chat</span>
          <span>{formatTokens(usage.input + usage.output)} tokens</span>
          <span className="dot">·</span>
          <span className="strong">{costLabel(usage)}</span>
        </button>
        {fill !== null && (
          <span
            className={fill > 0.8 ? "ctx-gauge hot" : "ctx-gauge"}
            title={`Last request used ${usage.lastInput.toLocaleString()} of ${contextWindow!.toLocaleString()} context tokens`}
          >
            <span className="ctx-track">
              <span className="ctx-fill" style={{ width: `${Math.max(2, fill * 100)}%` }} />
            </span>
            {Math.round(fill * 100)}% of {formatTokens(contextWindow!)}
          </span>
        )}
        {conv.summary && (
          <button
            className="stats-btn"
            onClick={() => setOpen(open === "summary" ? null : "summary")}
            aria-expanded={open === "summary"}
            title="Older messages were condensed into this summary (short-term memory)"
          >
            Summary
          </button>
        )}
        <button className="link-btn small" onClick={onOpenUsage}>
          All usage
        </button>
      </div>
      {open === "usage" && <UsageBreakdown usage={usage} providerName={providerName} />}
      {open === "summary" && conv.summary && (
        <div className="breakdown summary-box">
          <Markdown source={conv.summary.text} />
          <p className="breakdown-note">Short-term memory: the model sees this summary instead of the oldest messages.</p>
        </div>
      )}
    </div>
  );
}

export default function ChatView(props: Props) {
  const { conv, running, approval, question } = props;
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [conv.messages, approval, question]);

  const last = conv.messages[conv.messages.length - 1];
  return (
    <div className="chat">
      <div
        className="messages"
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        {conv.messages.length === 0 ? (
          <div className="empty">
            <img className="empty-logo" src={iconUrl} alt="" />
            <h1>What do you want to know?</h1>
            <p className="muted">Ask about this page, search the web, or have me click, type and navigate for you.</p>
            {!props.hasModel ? (
              <button className="btn primary" onClick={props.onOpenSettings}>
                Set up a model
              </button>
            ) : (
              <div className="quick">
                {QUICK_ACTIONS.map((a) => (
                  <button key={a.label} className="quick-btn" onClick={() => props.onSend(a.prompt)} disabled={running}>
                    <span className="quick-label">{a.label}</span>
                    <span className="quick-hint">{a.hint}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          conv.messages.map((m) => (
            <MessageView key={m.id} message={m} live={running && m === last} onRetry={!running && m === last ? props.onRetry : undefined} />
          ))
        )}
        {approval && <ApprovalCard label={approval.label} reason={approval.reason} onAnswer={(answer) => approval.resolve(answer)} />}
        {question && (
          <QuestionCard
            key={question.question}
            question={question.question}
            options={question.options}
            multiple={question.multiple}
            onAnswer={(answer) => question.resolve(answer)}
          />
        )}
      </div>
      <ChatStats conv={conv} contextWindow={props.contextWindow} providerName={props.providerName} onOpenUsage={props.onOpenUsage} />
      <Composer
        running={running}
        activeTab={props.activeTab}
        attachPage={props.attachPage}
        includeCurrent={props.includeCurrent}
        onToggleCurrent={props.onToggleCurrent}
        attached={props.attached}
        onAttachedChange={props.onAttachedChange}
        draft={props.draft}
        onDraftChange={props.onDraftChange}
        onSend={props.onSend}
        onStop={props.onStop}
        onSteer={props.onSteer}
        onQueue={props.onQueue}
        queued={props.queued}
        queuePaused={props.queuePaused}
        onRemoveQueued={props.onRemoveQueued}
        onSendQueuedNow={props.onSendQueuedNow}
        onRunQueue={props.onRunQueue}
        voice={props.voice}
        convId={conv.id}
        onNotice={props.onNotice}
      />
    </div>
  );
}
