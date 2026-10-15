# Security Policy

## Supported

- Latest `main` + latest tagged `v0.x` release. Older tags get fixes only via upgrade.

## Invariants we defend

- Provider keys live write-only in `storage.local` (`key:v1:{providerId}`), never in `storage.session`, never in `storage.sync`, never exported.
- History is local-only (`history:v1:*` in `storage.local` + conditional IndexedDB), never `storage.sync`.
- Egress guard denies private IPs/metadata/`chrome://`/`file:`/`data:` URLs. Write-gate blocks ungated irreversible actions.

## Reporting

- Do NOT open public issues for key leaks, XSS, bypass of approval card, or SSRF/egress bypass.
- Email `prititaliya2244@gmail.com` with repro steps, extension version (`chrome://extensions`), and whether mock or live provider.
- Expect ack in 72h. We will rotate/audit and credit reporters in release notes (opt-in).

## After a key leak

Rotate the key at the provider, delete it from extension Settings, check `git log` for accidental commits (`git log -S 'sk-' --all -p`).
