import { expect, test } from "@playwright/test";
import { DEMO_APP_URL } from "./config";
import { PRIMARY_INBOX, SEED_MESSAGES } from "./seed-data";

// Not part of the functional suite: this seeds a lot of mail and writes the README screenshots, so it
// only runs when explicitly capturing. Normal `playwright test` (and CI) skips it.
test.skip(!process.env.POSTLOOP_CAPTURE, "screenshot capture; run with POSTLOOP_CAPTURE=1");

test("capture README screenshots from a well-seeded inbox", async ({ page, request }) => {
    await request.post(`${DEMO_APP_URL}/reset`);

    for (const message of SEED_MESSAGES) {
        const res = await request.post(`${DEMO_APP_URL}/send`, { data: message });
        expect(res.ok(), `seeding "${message.subject}"`).toBeTruthy();
    }

    await page.goto("/");
    await expect(page.getByRole("button", { name: "New message" })).toBeVisible();

    const primaryRow = page.locator(".pane.inboxes .row", { hasText: PRIMARY_INBOX });
    await expect(primaryRow).toBeVisible();
    await primaryRow.click();

    const messageRows = page.locator(".pane.messages .row");
    await expect.poll(() => messageRows.count()).toBeGreaterThanOrEqual(8);

    await messageRows.first().click();
    await expect(page.locator(".pane.reader .subject")).toBeVisible();

    const editor = page.locator(".reply .ProseMirror");
    // Click the empty top paragraph so the reply reads above the quoted original, like a real client.
    await editor.click({ position: { x: 8, y: 8 } });
    await page.keyboard.type("Thanks for the details, taking a look now.");

    await page.screenshot({ path: "docs/screenshots/inbox.png" });

    // Second shot: composing a new message wrapped in a provider's forwarding shape. Taller viewport so
    // the whole modal, Send button included, is in frame.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.getByRole("button", { name: "New message" }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    await modal.locator('label:has-text("From (original sender)") input').fill('"Dana Ops" <dana@partner.test>');
    await modal.locator('label:has-text("To (delivered inbox)") input').fill("inbox@your-app.test");
    await modal.locator('label:has-text("Subject") input').fill("Partner integration query");
    await modal.locator('label:has-text("Forward style") select').selectOption("google-groups");
    await modal.locator('label:has-text("Group address") input').fill("partners@groups.example.test");
    await modal.locator('label:has-text("Group name") input').fill("Partner Integrations");
    await modal.locator(".ProseMirror").click();
    await page.keyboard.type("How should we structure the webhook payloads?");

    await page.screenshot({ path: "docs/screenshots/compose.png" });
});
