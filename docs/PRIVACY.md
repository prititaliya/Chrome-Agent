# Privacy

## What leaves your device

- Current page text/snapshot + your task → only to the provider YOU configured (OpenRouter / OpenCode Go / custom / Ollama / LM Studio) when you run the agent.
- Model listing (`GET /models`) when you refresh models.

## What never leaves

- Provider keys: write-only in `storage.local` (`key:v1:*`), never in `storage.sync`, never exported, masked in UI.
- History: `storage.local` only (+ conditional IndexedDB), never `storage.sync`. Export is a local file you choose to save; redacted (`sk-*`, `Bearer` masked).
- No analytics, no tracking, no remote config. Mock provider is fully local.

## Permissions why

See `store/listing.md` justification table. `debugger` declared but OFF by default (trusted-input escape hatch). Optional host access per-origin, revocable in Settings. Banking/webmail denylist ON by default.

Contact: `prititaliya2244@gmail.com`.
