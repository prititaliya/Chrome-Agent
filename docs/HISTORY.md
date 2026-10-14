# History (schema v1, local-only)

Threads live in `storage.local` only — never `storage.sync`, never any server.

## Keys

- `history:v1:index` — array of `{threadId, title, createdAt, updatedAt,
messageCount, searchBlob}` (searchBlob ≤ 4 KB per thread).
- `history:v1:{threadId}` — `{id, title, titleSource, createdAt, updatedAt,
origin?, messages: Envelope[], artifacts?, outcome?, schemaVersion: 1}`.
- `history:blob:{threadId}:{artifactId}` — screenshot/extract bytes.

`Envelope = {id, threadId, role, ts, content, toolCallId?, toolName?,
artifactRefs?, outcomeUnknown?}`.

## Retention math

- `usedBytes = getBytesInUse() ?? Σ TextEncoder(JSON).length`
- `quota = QUOTA_BYTES ?? historySoftQuotaBytes (9_000_000)`
- Evict oldest non-pinned threads + orphaned artifacts at ≥ 0.8 × quota
  (Chrome: ≥ 8,388,480 B) until ≤ 0.6 × quota (Chrome: ≤ 6,291,360 B).
- `keepNMostRecentThreads` default 100, enforced first. Per-thread soft cap
  1 MB. Open and pinned threads are never evicted; overflow beyond pinned
  refuses the write with a visible UI state — never silent loss.

## Export / import

- JSON (byte-equal round-trip modulo `exportedAt`) and Markdown (metadata +
  per-message + tool-call sections), via `downloads.download` from the panel.
- Import dedups by `threadId` (newer `updatedAt` wins, else import-as-copy).
- `redact.ts` runs at persist time AND immediately before export.

## Resume

New `runId`, prior user/assistant messages as context, tool results replaced
by summaries with `outcomeUnknown: true`, budgets reset. Zero tool replay.
