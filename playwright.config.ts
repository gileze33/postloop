import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { DEMO_APP_PORT, DEMO_APP_URL, POSTLOOP_HTTP_PORT, POSTLOOP_SMTP_PORT, POSTLOOP_URL } from "./tests/e2e/config";

// The E2E store lives in a repo-local, gitignored directory (never the normal ./data), in a per-run
// subdirectory so no earlier run's mail leaks in. Handed to global-teardown to remove.
// One stable store directory for the whole run: the per-test wipe (tests/e2e/fixtures.ts) gives each test a
// clean slate, and the fixed server ports already stop two runs overlapping, so there is no need to mint a
// fresh per-run path. An env override wins (e.g. a CI runner); global-teardown removes whatever is used.
const DATA_DIR = process.env.POSTLOOP_E2E_DATA_DIR ?? join(process.cwd(), ".e2e-data");
mkdirSync(DATA_DIR, { recursive: true });
process.env.POSTLOOP_E2E_DATA_DIR = DATA_DIR;

export default defineConfig({
    testDir: "tests/e2e",
    globalTeardown: "./tests/e2e/global-teardown.ts",
    fullyParallel: false,
    workers: 1,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
    timeout: 30_000,
    expect: { timeout: 10_000 },
    use: {
        baseURL: POSTLOOP_URL,
        viewport: { width: 1280, height: 820 },
        trace: "on-first-retry",
        screenshot: "only-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
    // Postloop (serving the built UI) and the demo app, wired together: Postloop POSTs replies to the
    // demo app's /outbound, the demo app sends into Postloop's SMTP sink.
    webServer: [
        {
            command: "node dist/server/index.js",
            url: `${POSTLOOP_URL}/api/config`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
                PORT: String(POSTLOOP_HTTP_PORT),
                SMTP_PORT: String(POSTLOOP_SMTP_PORT),
                OUTBOUND_URL: `${DEMO_APP_URL}/outbound`,
                DATA_DIR,
            },
        },
        {
            command: "node_modules/.bin/tsx examples/demo-app/app.ts",
            url: `${DEMO_APP_URL}/health`,
            reuseExistingServer: false,
            timeout: 30_000,
            env: {
                PORT: String(DEMO_APP_PORT),
                SMTP_HOST: "127.0.0.1",
                SMTP_PORT: String(POSTLOOP_SMTP_PORT),
            },
        },
    ],
});
