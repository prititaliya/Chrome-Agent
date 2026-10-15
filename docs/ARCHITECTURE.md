# Architecture

One WXT codebase → Chrome MV3 (side panel) + Firefox MV3 (sidebar, Task 53 restores).

## Entrypoints

- `entrypoints/background/index.ts` — owns agent loop, checkpoints, single-writer for runs/history.
- `entrypoints/sidepanel/` (`App.tsx`, `main.tsx`) — React 19 Chat/History/Settings.
- `entrypoints/content/index.ts` — isolated bridge: snapshot walker, DOM actions, overlay.
- `entrypoints/mic/` — voice input entry.

## Agent loop

`src/agent/loop.ts` + `router.ts` + `risk.ts` + `usage.ts`:
checkpoint `calling_model` → model → Zod (`src/tools/definitions.ts`) → classify via `src/agent/risk.ts` over attested DOM facts → `src/tools/executor.ts` → checkpoint. Budgets: `maxSteps=25`, `maxToolCalls=60`, cost caps. Worker-kill resume never replays `executing_tool:*` (outcome unknown + fresh snapshot).

## DOM / tools

`src/dom/snapshot.ts` → `[e12]` refs per-tab per-gen; `extract.ts`, `readability.ts`, `actions.ts`, `selection.ts`. Executor dispatches snapshot/read/extract/click/type/submit/navigate/tabs/wait/screenshot. `form_submit` always gated; `browser_type` never submits.

## Providers

`src/providers/` (`types.ts`, `presets.ts`, `chat.ts`, `responses.ts`, `sse.ts`, `http.ts`, `catalog.ts`): `wire: chat | responses` required per model. OpenRouter `https://openrouter.ai/api/v1`, OpenCode Go `https://opencode.ai/zen/go/v1`, custom/Ollama/LM Studio OpenAI-compatible, mock (`scripts/mock-provider.mjs`). Keys write-only in `storage.local`, never `storage.sync`.

## Storage (local-only)

`src/storage/` (`sessions.ts`, `conversations.ts`, `settings.ts`, `redact.ts`, `usage.ts`): history + keys in `storage.local` only. `redact.ts` masks `sk-*`/`Bearer` at persist + export. No `storage.sync` (gated).

## UI safety

`src/ui/markdown.tsx` + `sanitize.ts` (marked + DOMPurify allowlist), `ApprovalCard.tsx` for gated writes.
