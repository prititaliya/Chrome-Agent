# Storage submodule roles

- `settings.ts` — user preferences under `settings:v1` in `storage.local`
  (budgets, `keepNMostRecentThreads`, `controlMode`, denylists). The UI
  subscribes via `watchSettings`.
- `keys.ts` — provider API keys under `key:v1:{providerId}` in `storage.local`
  behind a write-only API (`saveKey`/`deleteKey`/`hasKey`). Values are never
  read into any UI, never copied to `storage.session`, never exported.
- `runs.ts` — ephemeral live run checkpoints (`run:v1:{runId}`).
- `history/` — the durable transcript store (plan Task 12+).
- `grants.ts` — per-run approvals + persistent per-origin lists (plan Task 19+).

Rule: `runs` may be lost, `history` must not. When a run terminates, `runs`
finalizes exactly one write into `history/store` and then deletes the checkpoint.
