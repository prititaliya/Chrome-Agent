import { useEffect, useRef, useState } from "react";
import { browser } from "wxt/browser";
import { openAgentPort, type AgentPort } from "../../../src/messaging/port";
import { toJSONThread, toMarkdownThread } from "../../../src/storage/history/export";
import type { ThreadIndexEntry, ThreadRecord } from "../../../src/storage/history/store";
import type { SearchResult } from "../../../src/storage/history/index";

// Thread list + viewer over background RPC. The background is the single
// writer; this module never imports the history store. Search (Task 15),
// export/import (Task 14), and resume (Task 16) extend this tab.
export default function HistoryTab() {
  const portRef = useRef<AgentPort | null>(null);
  const [threads, setThreads] = useState<ThreadIndexEntry[]>([]);
  const [open, setOpen] = useState<ThreadRecord | null>(null);
  const [renaming, setRenaming] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [conflict, setConflict] = useState<"skip" | "copy">("skip");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const port = openAgentPort((event) => {
      if (event.type === "threads") setThreads(event.threads);
      else if (event.type === "thread") setOpen(event.thread);
      else if (event.type === "searchResults") setResults(event.results);
      else if (event.type === "importResult") setNotice(`Import ${event.action}: ${event.threadId}`);
      else if (event.type === "historyError") setError(event.reason);
    });
    portRef.current = port;
    port.send({ v: 1, type: "listThreads" });
    return () => port.disconnect();
  }, []);

  const send = (command: Parameters<AgentPort["send"]>[0]) => {
    setError("");
    setNotice("");
    portRef.current?.send(command);
  };

  function onQueryChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.trim() === "") {
      setResults(null);
      return;
    }
    debounceRef.current = setTimeout(() => {
      portRef.current?.send({ v: 1, type: "searchThreads", query: value });
    }, 150);
  }

  // The panel page serializes the user-chosen format and renders the result,
  // so the Blob lives here; the background only stores and serves threads.
  async function onExport(format: "json" | "md") {
    if (!open) return;
    const text = format === "json" ? toJSONThread(open) : toMarkdownThread(open);
    const blob = new Blob([text], {
      type: format === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const slug = open.title.replace(/[^\w]+/g, "-").slice(0, 40) || "thread";
    const date = new Date().toISOString().slice(0, 10);
    try {
      const downloadId = await browser.downloads.download({
        url,
        filename: `agent-history/${date}-${slug}.${format}`,
        saveAs: true,
      });
      const onChanged = (delta: { id: number; state?: { current?: string } }) => {
        if (delta.id === downloadId && delta.state?.current !== "in_progress") {
          URL.revokeObjectURL(url);
          browser.downloads.onChanged.removeListener(onChanged);
        }
      };
      browser.downloads.onChanged.addListener(onChanged);
      setNotice(`Export started: ${format.toUpperCase()}`);
    } catch (error) {
      URL.revokeObjectURL(url);
      setError(error instanceof Error ? error.message : "export failed");
    }
  }

  async function onImportFile(file: File) {
    const json = await file.text();
    send({ v: 1, type: "importThread", json, onConflict: conflict });
  }

  return (
    <section>
      <h1>History</h1>
      {error !== "" && <p role="alert">{error}</p>}
      {notice !== "" && <p role="status">{notice}</p>}
      <label>
        Search{" "}
        <input
          type="search"
          aria-label="Search threads"
          placeholder="title or message text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      </label>
      {results !== null && (
        <section>
          <h2>
            {results.length} result{results.length === 1 ? "" : "s"}
          </h2>
          <ul>
            {results.slice(0, 50).map((r) => (
              <li key={r.threadId}>
                <button onClick={() => send({ v: 1, type: "openThread", threadId: r.threadId })}>
                  {r.title}
                </button>{" "}
                <span>{r.snippet}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section>
        <h2>Import</h2>
        <label>
          On conflict{" "}
          <select value={conflict} onChange={(e) => setConflict(e.target.value as "skip" | "copy")}>
            <option value="skip">skip (keep newer)</option>
            <option value="copy">import as copy</option>
          </select>
        </label>{" "}
        <input
          type="file"
          accept="application/json,.json"
          aria-label="Import thread JSON"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onImportFile(file);
            e.target.value = "";
          }}
        />
      </section>
      {threads.length === 0 && <p>No threads yet. Completed runs will appear here.</p>}
      <ul>
        {threads.map((t) => (
          <li key={t.threadId}>
            <button onClick={() => send({ v: 1, type: "openThread", threadId: t.threadId })}>
              {t.title}
            </button>{" "}
            <span>
              ({t.messageCount} messages, {new Date(t.updatedAt).toLocaleString()})
            </span>{" "}
            <button onClick={() => send({ v: 1, type: "cloneThread", threadId: t.threadId })}>Clone</button>{" "}
            <button
              onClick={() =>
                send({ v: 1, type: "pinThread", threadId: t.threadId, pinned: t.pinned !== true })
              }
            >
              {t.pinned === true ? "Unpin" : "Pin"}
            </button>{" "}
            <button onClick={() => send({ v: 1, type: "resumeThread", threadId: t.threadId })}>Resume</button>{" "}
            <button
              onClick={() => {
                if (window.confirm(`Delete "${t.title}"?`)) {
                  send({ v: 1, type: "deleteThread", threadId: t.threadId });
                  if (open?.id === t.threadId) setOpen(null);
                }
              }}
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
      {open && (
        <article>
          <h2>{open.title}</h2>
          <label>
            Rename{" "}
            <input value={renaming} placeholder={open.title} onChange={(e) => setRenaming(e.target.value)} />
          </label>
          <button
            onClick={() => {
              send({ v: 1, type: "renameThread", threadId: open.id, title: renaming });
              setRenaming("");
            }}
            disabled={renaming.trim() === ""}
          >
            Apply
          </button>
          <button onClick={() => setOpen(null)}>Close</button>{" "}
          <button onClick={() => void onExport("json")}>Export JSON</button>{" "}
          <button onClick={() => void onExport("md")}>Export Markdown</button>
          {open.messages.map((m) => (
            <section key={m.id}>
              <h3>
                {m.role}
                {m.toolName ? ` · ${m.toolName}` : ""}
                {m.outcomeUnknown ? " · outcome unknown" : ""}
              </h3>
              <p>{m.content}</p>
            </section>
          ))}
        </article>
      )}
    </section>
  );
}
