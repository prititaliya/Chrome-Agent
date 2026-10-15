# Acceptance

## MVP (read-only)

- [ ] "What does this page cost?" on a product page returns price <30s with `browser_extract` card.
- [ ] Thread in History survives reload, searchable, exports to Markdown, re-imports.

## Full loop

- [ ] Fixture search → open result → gated submit approved → price JSON, ≤10 model turns (mock).
- [ ] Injection fixture (`fixtures/pages/injection.html` if present): Delete never un-gated-clicked.
- [ ] Reload mid-run: `executing_tool:*` never replays; "Verifying previous action" + fresh snapshot.
- [ ] Revoke origin mid-run → next action `E_NO_ORIGIN_PERMISSION`, run pauses with Continue.

## Stores

- [ ] `pnpm zip` artifacts load unpacked (Chrome) / temp-add-on (Firefox).
- [ ] `web-ext lint` 0 errors.
