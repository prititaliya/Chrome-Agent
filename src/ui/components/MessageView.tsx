import { useState } from "react";
import { costLabel, formatTokens } from "../../agent/usage";
import type { Step, UiMessage } from "../../storage/conversations";
import Markdown from "../markdown";
import { AlertIcon, CheckIcon, ChevronIcon, CloseIcon, CopyIcon, GlobeIcon, RefreshIcon } from "./Icons";
import UsageBreakdown from "./UsageBreakdown";

function StepRow({ step }: { step: Step }) {
  const [open, setOpen] = useState(false);
  const icon =
    step.status === "running" || step.status === "awaiting" ? (
      <span className="spinner" aria-label="running" />
    ) : step.status === "ok" ? (
      <CheckIcon size={12} />
    ) : (
      <CloseIcon size={12} />
    );
  return (
    <li className={`step step-${step.status}`}>
      <button className="step-head" onClick={() => setOpen(!open)} disabled={!step.detail && !step.image}>
        <span className="step-icon">{icon}</span>
        <span className="step-label">{step.label}</span>
      </button>
      {open && step.detail && <pre className="step-detail">{step.detail}</pre>}
      {step.image && <img className="step-shot" src={step.image} alt="Screenshot taken by the agent" />}
    </li>
  );
}

function Steps({ steps, running }: { steps: Step[]; running: boolean }) {
  const [collapsed, setCollapsed] = useState(false);
  if (steps.length === 0) return null;
  const active = steps.some((s) => s.status === "running");
  return (
    <div className="steps">
      <button className="steps-toggle" onClick={() => setCollapsed(!collapsed)} aria-expanded={!collapsed}>
        {active || running ? <span className="spinner" /> : <GlobeIcon size={12} />}
        <span>
          {steps.length} browser step{steps.length === 1 ? "" : "s"}
        </span>
        <span className={collapsed ? "chev" : "chev open"}>
          <ChevronIcon size={12} />
        </span>
      </button>
      {!collapsed && (
        <ol className="step-list">
          {steps.map((s) => (
            <StepRow key={s.id} step={s} />
          ))}
        </ol>
      )}
    </div>
  );
}

function Footer({ message, live, onRegenerate }: { message: UiMessage; live: boolean; onRegenerate?: () => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const usage = message.usage;
  if (!message.model && !usage) return null;
  const tokens = usage ? usage.input + usage.output : 0;
  return (
    <>
      <div className="msg-foot">
        {message.model && (
          <span className="model-tag" title={`${message.providerName ?? ""} · ${message.modelRef?.modelId ?? message.model}`}>
            {message.model}
          </span>
        )}
        {usage && usage.requests > 0 && (
          <button className="foot-btn" onClick={() => setOpen(!open)} aria-expanded={open} title="Token and cost breakdown">
            <span>
              {usage.approx > 0 ? "~" : ""}
              {formatTokens(tokens)} tokens
            </span>
            <span className="dot">·</span>
            <span>{costLabel(usage)}</span>
            {message.memoriesUsed !== undefined && message.memoriesUsed > 0 && (
              <>
                <span className="dot">·</span>
                <span title="Long-term memories included in the prompt">
                  {message.memoriesUsed} memor{message.memoriesUsed === 1 ? "y" : "ies"}
                </span>
              </>
            )}
            {!live && message.durationMs !== undefined && (
              <>
                <span className="dot">·</span>
                <span>{(message.durationMs / 1000).toFixed(1)}s</span>
              </>
            )}
          </button>
        )}
        {!live && (
          <span className="foot-actions">
            {message.text !== "" && (
              <button
                className="icon-btn tiny"
                title={copied ? "Copied" : "Copy answer"}
                aria-label="Copy answer"
                onClick={() =>
                  void navigator.clipboard.writeText(message.text).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1200);
                  })
                }
              >
                {copied ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
              </button>
            )}
            {onRegenerate && (
              <button className="icon-btn tiny" title="Regenerate" aria-label="Regenerate answer" onClick={onRegenerate}>
                <RefreshIcon size={13} />
              </button>
            )}
          </span>
        )}
      </div>
      {open && usage && <UsageBreakdown usage={usage} providerName={message.providerName} durationMs={live ? undefined : message.durationMs} />}
    </>
  );
}

interface Props {
  message: UiMessage;
  live: boolean;
  /** Re-ask the last question; only passed for the latest answer. */
  onRetry?: () => void;
}

export default function MessageView({ message, live, onRetry }: Props) {
  const [showThinking, setShowThinking] = useState(false);
  if (message.role === "user") {
    return (
      <div className="msg msg-user">
        {message.context && message.context.length > 0 && (
          <div className="msg-context">
            {message.context.map((c) => (
              <span key={c.url} className="ctx-pill" title={c.url}>
                {c.title || c.url}
              </span>
            ))}
          </div>
        )}
        <div className="bubble">{message.text}</div>
      </div>
    );
  }
  const working = live && message.text === "" && !message.error;
  return (
    <div className="msg msg-assistant">
      {message.reasoning && (
        <div className="thinking">
          <button className="thinking-toggle" onClick={() => setShowThinking(!showThinking)}>
            {working ? "Thinking…" : "Reasoning"}
            <span className={showThinking ? "chev open" : "chev"}>
              <ChevronIcon size={12} />
            </span>
          </button>
          {showThinking && <div className="thinking-body">{message.reasoning}</div>}
        </div>
      )}
      <Steps steps={message.steps ?? []} running={live} />
      {message.text !== "" && <Markdown source={message.text} />}
      {working && !message.reasoning && (message.steps ?? []).length === 0 && (
        <div className="typing" aria-label="Assistant is working">
          <span />
          <span />
          <span />
        </div>
      )}
      {message.error && (
        <div className="msg-error" role="alert">
          <AlertIcon size={14} />
          <span>{message.error}</span>
          {onRetry && message.error !== "Stopped." && (
            <button className="link-btn" onClick={onRetry}>
              Retry
            </button>
          )}
        </div>
      )}
      <Footer message={message} live={live} onRegenerate={!message.error ? onRetry : undefined} />
    </div>
  );
}
