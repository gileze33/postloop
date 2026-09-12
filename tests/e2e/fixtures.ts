import { rmSync } from "node:fs";
import { test as base, expect } from "@playwright/test";
import { DEMO_APP_URL } from "./config";

/**
 * The whole run shares one Postloop server and one `DATA_DIR` (see `playwright.config.ts`). This auto
 * fixture gives every test a clean slate: it wipes the store and resets the demo app before the test body
 * runs. Wiping the directory is safe because the store keeps no in-memory state (it reads the directory
 * per request), and the next write recreates it. Import `test`/`expect` from here, not `@playwright/test`,
 * so the isolation applies.
 */
export const test = base.extend<{ isolate: void }>({
    isolate: [
        async ({ request }, use) => {
            const dataDir = process.env.POSTLOOP_E2E_DATA_DIR;

            if (dataDir) {
                rmSync(dataDir, { recursive: true, force: true });
            }

            await request.post(`${DEMO_APP_URL}/reset`);
            await use();
        },
        { auto: true },
    ],
});

export { expect };

let seq = 0;

/**
 * A collision-free test email address. The store is wiped between tests, but every test email still carries
 * a unique (time + sequence) element so cases stay isolated even if that changes or the suite ever runs with
 * more than one worker. Prefer this over hardcoding addresses in a spec.
 */
export const uniqueAddress = (localPrefix: string, domain = "example.test"): string =>
    `${localPrefix}-${Date.now().toString(36)}${(seq++).toString(36)}@${domain}`;
