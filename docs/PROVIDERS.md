# Providers — adding one is config, never loop code

1. Create `src/providers/entries/<id>.ts` exporting a `ProviderDef`.
2. **State `wire` on every model** (`'chat.completions' | 'responses'`).
   No default, no guessing — TypeScript enforces it.
3. Declare `streamWire` (framing, tool-delta/usage emission, idle timeout),
   `capabilities.tools` (`native` | `prompted` | `unsupported`), quirks, retry.
4. Add the API origin to `origins` (must match manifest `host_permissions`;
   `pnpm gates` asserts this).
5. Gateway base URLs come from `.env.local` (`VITE_<ID>_BASE_URL`, gitignored)
   — never hardcoded, never committed.

## Known entries

| Provider       | Base URL source                                               | Wire notes                                                                             |
| -------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| openrouter     | `https://openrouter.ai/api/v1`                                | chat, native tools, `stream_options` usage                                             |
| opencode-go    | `VITE_OPENCODE_GO_BASE_URL` ← `~/.commandcode/providers.json` | chat; tools capability live-probed, persisted per model                                |
| cheapinference | `VITE_CHEAPINFERENCE_BASE_URL` ← same file                    | chat, except `gpt-5.6-terra/sol/luna` → `wire:'responses'` (chat path 400s on `tools`) |
| custom         | user-entered https origin                                     | user-declared                                                                          |
| mock           | —                                                             | scripted `fixtures/agent-scripts/*.json`, no network                                   |

## Fallback

Any provider with `tools !== 'native'` (or a 400 on `tools`) uses the
prompted protocol: one fenced `{"tool","args"}` JSON block per turn, parsed
then validated through the same Zod schemas as native calls.
