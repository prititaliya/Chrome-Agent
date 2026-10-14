import { useEffect, useRef, useState } from "react";
import { openAgentPort, type AgentPort } from "../../../src/messaging/port";
import { getSettings, saveSettings } from "../../../src/storage/settings";
import { useRunStream } from "../../../src/ui/hooks/useRunStream";
import Markdown from "../../../src/ui/markdown";
import ModelPicker from "../../../src/ui/components/ModelPicker";
import ApprovalCard from "../../../src/ui/components/ApprovalCard";
import type { ThreadRecord } from "../../../src/storage/history/store";
import type { PendingGate } from "../../../src/agent/machine";

interface ToolCard {
  id: string;
  name: string;
  ok: boolean;
}

const TERMINAL = new Set(["done", "failed", "cancelled", "budget_paused"]);

// Task composer + live run view. The finished transcript is the history
// thread itself (single source of truth), opened when the run terminates.
export default function ChatTab() {
  const portRef = useRef<AgentPort | null>(null);
  const [task, setTask] = useState("");
  const [modelId, setModelId] = useState("");
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState("idle");
  const [cards, setCards] = useState<ToolCard[]>([]);
  const [transcript, setTranscript] = useState<ThreadRecord | null>(null);
  const [gate, setGate] = useState<{ runId: string; gate: PendingGate } | null>(null);
  const stream = useRunStream();
  const { pushDelta, complete, reset } = stream;

  useEffect(() => {
    const port = openAgentPort((event) => {
      if (event.type === "delta") pushDelta(event.text);
      else if (event.type === "toolResult") {
        setCards((prev) => [...prev, { id: event.toolCallId, name: event.toolName, ok: event.ok }]);
      } else if (event.type === "runState") {
        if (event.runId === "pending") {
          setStatus("running");
          return;
        }
        setRunId(event.runId);
        setStatus(event.status);
        complete();
        if (TERMINAL.has(event.status)) {
          port.send({ v: 1, type: "openThread", threadId: event.runId });
        }
      } else if (event.type === "thread" && event.thread) {
        setTranscript(event.thread);
      } else if (event.type === "gateRequest") {
        setGate({ runId: event.runId, gate: event.gate });
      }
    });
    portRef.current = port;
    void getSettings().then((s) => setModelId(s.defaultModel));
    return () => port.disconnect();
  }, [pushDelta, complete]);

  async function onModelChange(id: string) {
    setModelId(id);
    await saveSettings({ defaultModel: id });
  }

  function onStart() {
    if (task.trim() === "") return;
    reset();
    setCards([]);
    setTranscript(null);
    setGate(null);
    setRunId(null);
    setStatus("running");
    portRef.current?.send({ v: 1, type: "startRun", task: task.trim() });
  }

  function onStop() {
    if (runId) portRef.current?.send({ v: 1, type: "stopRun", runId });
  }

  const running = status === "running";

  return (
    <section>
      <h1>Chat</h1>
      <ModelPicker providerId="openrouter" modelId={modelId} onChange={(id) => void onModelChange(id)} />
      <label>
        Task{" "}
        <input
          type="text"
          aria-label="Task"
          placeholder="Ask about this page, or tell me what to do"
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onStart();
          }}
        />
      </label>
      <button onClick={onStart} disabled={running || task.trim() === ""}>
        Start
      </button>
      <button onClick={onStop} disabled={!running}>
        Stop
      </button>
      <p>Status: {status}</p>

      {gate && (
        <ApprovalCard
          toolName={gate.gate.toolName}
          reason={gate.gate.reason}
          argsSummary={gate.gate.argsSummary}
          onApprove={() => {
            portRef.current?.send({ v: 1, type: "resolveGate", runId: gate.runId, approved: true });
            setGate(null);
          }}
          onDeny={() => {
            portRef.current?.send({ v: 1, type: "resolveGate", runId: gate.runId, approved: false });
            setGate(null);
          }}
        />
      )}

      {cards.length > 0 && (
        <ul aria-label="Tool calls">
          {cards.map((c) => (
            <li key={c.id}>
              {c.ok ? "✓" : "✗"} {c.name}
            </li>
          ))}
        </ul>
      )}

      {stream.state.text !== "" && (
        <section>
          <h2>Streaming</h2>
          <Markdown source={stream.state.text} />
        </section>
      )}

      {transcript && (
        <article>
          <h2>{transcript.title}</h2>
          {transcript.messages
            .filter((m) => m.role !== "system")
            .map((m) => (
              <section key={m.id}>
                <h3>
                  {m.role}
                  {m.toolName ? ` · ${m.toolName}` : ""}
                  {m.outcomeUnknown ? " · outcome unknown" : ""}
                </h3>
                <Markdown source={m.content === "" ? "(calling tools)" : m.content} />
              </section>
            ))}
        </article>
      )}
    </section>
  );
}
