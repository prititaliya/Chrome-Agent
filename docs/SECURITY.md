# Security (also written for store reviewers)

## Threat model

1. **Prompt injection** — all page text is wrapped as
   `<untrusted origin tab trust>…</untrusted>` (delimiter neutralized), enters
   only tool/user messages, never system. The model supplies only integer refs
   it received — it cannot invent targets. Residual persuasion is stopped by
   the write-gate, which is code, not compliance.
2. **Irreversible actions** — pure `classify()` over attested DOM facts.
   `form_submit` always gates; approvals are per-run, session-scoped, never
   sticky; denial returns an observation so the agent can try alternatives.
3. **SSRF/egress** — scheme allowlist `http/https`; denylist loopback,
   RFC1918, 169.254/16, CGNAT, `*.local`, `.internal`, metadata hosts.
   Blocked calls return `E_BLOCKED_BY_POLICY` + a UI event.
4. **Extension-page XSS (= key theft)** — `marked` → `DOMPurify` allowlist,
   no raw HTML sinks, default MV3 CSP untouched, everything bundled.
5. **Key leakage** — keys in `storage.local` only (never `sync`, never
   `session`), write-only UI, `redact.ts` scrubs logs/errors/exports,
   content scripts receive no key material.
6. **Visibility** — overlay banner + toolbar badge during runs; Esc / Stop
   aborts and detaches the debugger.
7. **Privacy** — per-origin consent before page text reaches any model,
   banking/webmail denylist preset; history is local-only by construction
   (enforced by `scripts/check-no-sync.mjs`).
8. **History exposure** — user-initiated local download only, redacted;
   background refuses content-script history requests; UI never imports the
   history store (single-writer invariant, unit-tested).

## Permission justifications

- `storage` — settings, keys, runs, history (all local).
- `tabs` / `activeTab` — multi-tab registry, screenshots of the active tab.
- `scripting` — content-script re-inject after optional-origin grants.
- `alarms` — best-effort keepalive heartbeat.
- `downloads` — history JSON/Markdown export.
- `debugger` (Chrome, declared but runtime-OFF by default) — trusted input
  and full-page screenshots only after explicit user opt-in.
- `optional_host_permissions <all_urls>` — page access granted per origin at
  first agent use, revocable any time.
