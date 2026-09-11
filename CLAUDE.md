# Postloop

Keep the tests up to date and the suite green.

- Any change that affects behaviour ships with matching tests: update or add coverage alongside the code you touch.
- Before considering a change done, run the **full** suite and confirm it passes: `pnpm test` (builds the app, then runs the Playwright E2E suite).

Tests live in `tests/e2e/` and drive the real UI through the demo app in `examples/demo-app/`. See the Testing section of the README for how it fits together.
