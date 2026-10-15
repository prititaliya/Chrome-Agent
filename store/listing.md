# Store listing

## Short description (≤132 chars)

AI assistant in your side panel that reads pages, answers grounded questions, and drives the browser with approval gates.

## Full description

UnComet Assistant is a Comet-like AI browser assistant from one open codebase (Apache-2.0).

- Ask about the live page ("what does this cost?") — answers cite snapshot/extract cards.
- Agent loop: snapshot, read, extract, click, type, submit, navigate, tabs, wait, screenshot — with budgets and worker-restart resume that never replays tool calls.
- BYOK: OpenRouter, OpenCode Go, cheapinference, Ollama/LM Studio, custom OpenAI-compatible, or local mock. Keys stay write-only in `storage.local`.
- Local-only history: searchable, JSON/Markdown export (redacted), never synced.
- Selection quick-actions, keyboard-operable panel, approval card for every irreversible action.

Test notes for reviewers: load with mock provider (no key needed) or paste an OpenRouter key in Settings. Fixture server `pnpm fixtures` serves test pages on :4173.

Privacy policy: `docs/PRIVACY.md` (host raw URL at submission).

## Category

Productivity.

## Permission justifications

| Permission                     | Why                                                                              |
| ------------------------------ | -------------------------------------------------------------------------------- |
| storage                        | settings, BYOK keys (write-only), local history                                  |
| tabs / scripting / activeTab   | snapshot walker + DOM actions via content bridge                                 |
| contextMenus                   | selection "ask" quick-actions                                                    |
| identity                       | optional profile email for attribution; never synced                             |
| sidePanel (Chrome)             | panel UI                                                                         |
| debugger (Chrome, OFF default) | trusted-input escape hatch for guarded sites; declared, runtime-OFF, user toggle |
| downloads                      | history JSON/Markdown export                                                     |
| host `<all_urls>`              | read/drive user pages + call user-configured provider base URLs                  |

## Screenshots (1280x800, TODO capture)

1. Chat grounded answer with extract card
2. Approval card (form_submit preview)
3. History search + export
4. Settings providers + origins + denylist

## Submission checklist

- [ ] `pnpm zip` artifacts: manifest at zip root, icons 16/32/48/128
- [ ] CWS: single-purpose, justifications pasted, data disclosure (no sale, BYOK, local history), privacy URL
- [ ] AMO listed: `pnpm sign:firefox:listed`, source upload if minified, data questions answered
- [ ] Version bumped, tag pushed, Release notes with zips
