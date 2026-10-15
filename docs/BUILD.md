# Build

## Toolchain

Node 22, pnpm 9, WXT 0.21.4 exact, React 19, TS strict.

```sh
pnpm install
pnpm typecheck && pnpm lint && pnpm test && pnpm build
npx wxt build -b firefox   # pnpm build targets Chrome only; Firefox needs its own pass
pnpm e2e   # build first; mock provider, no spend
```

## Gates

- `pnpm gates` = `check-manifest.mjs` + `check-no-sync.mjs` (Task 53 restores scripts/).
- `web-ext lint` must be 0 errors for Firefox.

## Zip / sign

```sh
pnpm zip                  # chrome: .output/comet-assistant-<v>-chrome.zip
npx wxt zip -b firefox    # firefox + sources: .output/*-firefox.zip + *-sources.zip (AMO needs sources)
pnpm sign:firefox         # unlisted (needs AMO_JWT_ISSUER/SECRET)
pnpm sign:firefox:listed  # AMO listed submit
```

Chrome manifest keeps `sidePanel` + `debugger` (OFF default). Firefox uses `sidebar_action` + `gecko` id, omits `debugger`.

## Publishing log

- v0.1.0 — OSS public (Apache-2.0). CWS + AMO submit pending owner accounts.
