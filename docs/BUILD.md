# Build (reproducible, for AMO + CWS review)

## Commands

```
corepack enable && pnpm i
pnpm dev                 # Chrome dev with HMR
pnpm dev:ff              # Firefox dev (web-ext profile)
pnpm build               # .output/chrome-mv3 + .output/firefox-mv3 (both MV3)
pnpm zip                 # store packages (later task)
pnpm sign:firefox        # AMO unlisted signing (later task)
pnpm lint:firefox        # web-ext lint, must be 0 errors (later task)
```

## Reproducibility

- `wxt@0.21.4` pinned exact; single `pnpm-lock.yaml`; Node 22 (`.nvmrc`).
- One `wxt.config.ts` generates both manifests; `pnpm gates` asserts the
  per-browser invariants in CI.
- No remote code: everything is bundled; default MV3 CSP untouched.

## Known build notes

- WXT warns that Firefox wants `data_collection_permissions` for new
  extensions (Nov 2025+). Decision recorded at store-prep time: declare the
  minimal set truthfully (no telemetry — page text only goes to the
  user-chosen model provider) or suppress only if an exemption applies.
- Unpacked testing: `pnpm build`, load `.output/chrome-mv3` unpacked,
  `node scripts/dev-reload.mjs` in a second terminal for auto-reload.
