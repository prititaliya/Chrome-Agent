# Architecture

Seven components, one durable source of truth per concern (run state in the
background, transcripts on the user's disk):

1. **Background** (`entrypoints/background/`) — agent run state machine,
   provider transport, tool executor, write-gate, tab registry, single writer
   of the HistoryStore. Never touches DOM.
2. **Side panel / sidebar** (`entrypoints/sidepanel/`) — same React app on both
   engines: Chat, History, Settings. Sends typed RPC; never writes history directly.
3. **Overlay** (`entrypoints/content/overlay/`) — closed-shadow-root bubble +
   agent-active banner with panic stop.
4. **Content bridge** (`entrypoints/content/index.ts`, ISOLATED world) — the
   only page-touching code: snapshots, ref map, input, extraction.
5. **Provider registry** (`src/providers/`) — declarative entries; `wire`
   required per model.
6. **Browser control** (`src/browser/`) — `CdpControl` (Chrome, toggle OFF by
   default) + `DomControl` (both engines, always on), selected per action.
7. **HistoryStore** (`src/storage/history/`) — durable local-only transcripts.

## State machine invariants (frozen)

- Atomic checkpoint at every tool boundary (`storage.session` + local mirror).
- `lastPhase startsWith 'executing_tool:'` → on resume NEVER replay; record
  `outcome:'unknown'`, force a fresh snapshot first.
- Partial streamed assistant text is display-only; a killed `calling_model`
  phase is discarded and re-requested.

## Token/cost table

| Budget          | Default                                              |
| --------------- | ---------------------------------------------------- |
| maxSteps        | 25                                                   |
| maxToolCalls    | 60                                                   |
| maxCostUSD      | 0.50                                                 |
| snapshot cap    | 12,000 chars (~3k tokens)                            |
| context pruning | system + last 6 verbatim, older tool obs → summaries |
| recap           | progress summary every 5 steps via `summarizerModel` |

Median tokens/run: measured in a later task and recorded here.
