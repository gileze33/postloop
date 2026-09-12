# Postloop

Keep the tests up to date and the suite green.

- Any change that affects behaviour ships with matching tests: update or add coverage alongside the code you touch.
- Before considering a change done, run the **full** suite and confirm it passes: `pnpm test` (builds the app, then runs the Playwright E2E suite).

Tests live in `tests/e2e/` and drive the real UI through the demo app in `examples/demo-app/`. See the Testing section of the README for how it fits together.

## Test isolation

The E2E suite shares one Postloop server and one `DATA_DIR` for the whole run. A shared auto fixture in `tests/e2e/fixtures.ts` wipes the store and resets the demo app before each test, so import `test`/`expect` from `./fixtures`, not `@playwright/test`.

Still give every test email a unique element: use `uniqueAddress()` from `./fixtures` (or an inline `Date.now()` stamp) for inbox and sender addresses, so a case stays isolated even if the wipe or worker count changes. Don't hardcode addresses in functional specs. The screenshot seed (`seed-data.ts`, `capture.spec.ts`) is the deliberate exception: it uses fixed, realistic addresses for the README images.
