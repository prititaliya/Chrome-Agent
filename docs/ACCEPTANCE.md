# Acceptance checklist (each line is independently checkable)

## MVP (Phase 1 exit)

- [ ] Real OpenRouter key, real product page: "what does this page cost?"
      answers from live page content in < 30 s with a `browser_extract` card.
- [ ] The thread appears in History with a title, is searchable, exports to
      Markdown, and re-imports.
- [ ] `fixtures/pages/injection.html` run halts at the approval card; the
      Delete control is provably unclicked.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm gates` green.

## v1 (Phase 2 exit)

- [ ] Hero on both engines: fixture search page → search 'widgets' → open
      first result → price as JSON; submit gated and approved by the test;
      Chrome ≤ 10 model turns; Firefox passes DOM-only with degradations.
- [ ] Worker killed mid-run (`chrome.runtime.reload()`): resumes, never
      replays `executing_tool:*`, card reads "Verifying previous action".
- [ ] Killed mid-stream leaves no orphan assistant message.
- [ ] Multi-tab handoff, CDP-vs-DOM escalation, and post-grant content-script
      re-inject all proven in e2e.

## Hardening (Phase 3 exit)

- [ ] ≥ 8 injection vectors fail to trigger an ungated write.
- [ ] `pnpm zip` loads unpacked (Chrome) and passes `web-ext lint` 0 errors.
- [ ] Panel fully keyboard-operable; axe-core clean.
