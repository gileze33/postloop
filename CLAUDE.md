# Postloop

Keep the tests up to date and the suite green.

- Any change that affects behaviour ships with matching tests: update or add coverage alongside the code you touch.
- Before considering a change done, run the **full** suite and confirm it passes: `pnpm test` (builds the app, then runs the Playwright E2E suite).

Tests live in `tests/e2e/` and drive the real UI through the demo app in `examples/demo-app/`. See the Testing section of the README for how it fits together.

## Forward profiles

The "Forward style" profiles (`src/shared/forwardingProfiles.ts`) mimic how forwarded mail reaches an ingestion endpoint, so tests can check the pipeline recovers the true sender and destination inbox from headers (`Delivered-To`, `X-Original-From`, `Reply-To`, List-*), not from a quoted body block. Most model an automated rule (distribution-list rewrite, redirect) that re-delivers the original body verbatim with no human intro; a couple model a manual human forward (`Fwd:`/`FW:` subject, quoted-original block). The label marks which. Don't graft manual-forward behaviour, such as a typed intro above the quote, onto the automated ones: a rule never adds it.

## Test isolation

The E2E suite shares one Postloop server and one `DATA_DIR` for the whole run. A shared auto fixture in `tests/e2e/fixtures.ts` wipes the store and resets the demo app before each test, so import `test`/`expect` from `./fixtures`, not `@playwright/test`.

Still give every test email a unique element: use `uniqueAddress()` from `./fixtures` (or an inline `Date.now()` stamp) for inbox and sender addresses, so a case stays isolated even if the wipe or worker count changes. Don't hardcode addresses in functional specs. The screenshot seed (`seed-data.ts`, `capture.spec.ts`) is the deliberate exception: it uses fixed, realistic addresses for the README images.
