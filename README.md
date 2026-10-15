# Chrome-Agent (UnComet Assistant)

Comet-like AI browser assistant as a cross-browser MV3 extension — one WXT codebase for Chrome (side panel) + Firefox (sidebar).

Side-panel chat grounded in live page content, full agent loop (snapshot, read, extract, click, type, submit, navigate, tabs, wait, screenshot), BYOK multi-provider models, local-only searchable history.

## Status

`v0.1.0` — source-public under Apache-2.0. Store submission in progress (see `store/listing.md`).

## Quick start

Requirements: Node 22 (`.nvmrc`), pnpm 9.

```sh
pnpm install
cp .env.example .env.local   # never commit .env.local
pnpm dev                     # Chrome dev build
pnpm typecheck && pnpm lint && pnpm test && pnpm build
pnpm e2e                     # headful Chrome + mock provider, no token spend
```

BYOK: open Settings → paste provider key (stored write-only in `storage.local`, never synced, never exported). Or run e2e/demo with the scripted mock provider.

## Features

- Grounded Q&A over live pages (snapshot + extract with stable refs)
- Gated writes: irreversible actions block on approval card
- Multi-tab (`t1..tn`), budgets (`maxSteps=25`, cost caps), worker-restart resume without tool replay
- History local-only (`storage.local`, never `storage.sync`), searchable, JSON/Markdown export (redacted)
- Providers: OpenRouter, opencode-go, cheapinference (`responses` wire), Ollama/LM Studio, custom OpenAI-compatible, mock

## Docs

- `docs/ARCHITECTURE.md` — agent loop, storage schemas, provider wires
- `docs/BUILD.md` — builds, gates, zip/sign, publishing log
- `docs/PRIVACY.md` — what leaves the device, what never does
- `docs/ACCEPTANCE.md` — manual acceptance checklist
- `store/listing.md` — submission copy + permission justifications

## Contributing

See `CONTRIBUTING.md`. PRs must pass `pnpm typecheck && pnpm lint && pnpm test && pnpm build`.

## Security

See `SECURITY.md`. Do not file key-leak issues publicly — email the maintainer.

## License

Apache-2.0 — see `LICENSE`.
