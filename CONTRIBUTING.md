# Contributing

## Setup

- Node 22 (`cat .nvmrc`), pnpm 9 (`corepack enable && pnpm i`).
- `cp .env.example .env.local` — real provider base URLs/keys go here only. Never commit `.env.local`.
- `pnpm dev` for Chrome; `pnpm build` emits `.output/chrome-mv3` (+ `firefox-mv3` once dual manifest lands).

## Before every PR

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm gates   # check-manifest + check-no-sync (CI-blocking once restored)
pnpm e2e     # ALWAYS build first; DISPLAY=:1 headful; mock provider, no spend
```

CI (`.github/workflows/ci.yml`) runs typecheck → lint → test → build → e2e (Chromium).

## Rules

- TypeScript strict + `noUncheckedIndexedAccess`. Zod validates every tool call, provider entry, history import.
- Background owns runs + history (single-writer). UI never imports `src/storage/history/**`.
- Never `storage.sync` for keys/history (mechanically gated). Keys are write-only in `storage.local`.
- No selectors from model — refs (`[e12]`) only. No `browser_eval` unless Power-user toggle ON.
- Write-gate: irreversible actions block on approval card. Test on `fixtures/pages/injection.html`.
- Keep `docs/` in sync with code changes.
