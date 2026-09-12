import type { APIRequestContext } from "@playwright/test";
import { DEMO_APP_URL } from "./config";
import { expect, test, uniqueAddress } from "./fixtures";

interface ReceivedReply {
    from: string;
    to: string[];
    subject: string;
    inReplyTo?: string;
    references?: string[];
    html: string;
}

const received = async (request: APIRequestContext): Promise<ReceivedReply[]> =>
    (await request.get(`${DEMO_APP_URL}/outbound`)).json();

test("the full loop: the app sends in, you reply in the UI, the app gets the reply back", async ({ page, request }) => {
    const stamp = Date.now();
    const sender = uniqueAddress("alice");
    const inbox = uniqueAddress("support", "your-app.test");
    const subject = `Widget broken ${stamp}`;
    const knownMessageId = `<thread-${stamp}@demo.test>`;

    // 1. The app under test sends a message into Postloop's SMTP sink, with a known Message-ID so we can
    //    assert the reply threads onto exactly it.
    const sendRes = await request.post(`${DEMO_APP_URL}/send`, {
        data: { from: `"Alice" <${sender}>`, to: inbox, subject, html: "<p>My widget is broken.</p>", messageId: knownMessageId },
    });
    expect(sendRes.ok()).toBeTruthy();

    // 2. Open the Postloop UI and read the caught message (the inbox list polls, so it appears shortly).
    await page.goto("/");
    await expect(page.getByRole("button", { name: "New message" })).toBeVisible();

    const inboxRow = page.locator(".pane.inboxes .row", { hasText: inbox });
    await expect(inboxRow).toBeVisible();
    await inboxRow.click();

    await page.locator(".pane.messages .row", { hasText: subject }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(subject);
    await expect(page.locator(".pane.reader .body")).toContainText("My widget is broken");

    // The caught message's Message-ID as Postloop parsed it; the reply must chain onto exactly this.
    const messages = (await (await request.get(`/api/inboxes/${encodeURIComponent(inbox)}/messages`)).json()) as {
        id: string;
        subject: string;
    }[];
    const caughtSummary = messages.find(item => item.subject === subject);
    const detail = (await (
        await request.get(`/api/inboxes/${encodeURIComponent(inbox)}/messages/${encodeURIComponent(caughtSummary!.id)}`)
    ).json()) as { messageId?: string };
    const caughtId = detail.messageId;
    expect(caughtId, "the sink should preserve the sender's Message-ID").toContain(`thread-${stamp}`);

    // 3. Reply through the real editor.
    const editor = page.locator(".reply .ProseMirror");
    // Click the empty top paragraph (not the element centre, which can land in the quoted original).
    await editor.click({ position: { x: 8, y: 8 } });
    await page.keyboard.type("Have you tried turning it off and on again?");

    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.locator(".reply .status")).toContainText("HTTP 200");

    // 4. The app under test receives the reply, threaded onto the original.
    await expect
        .poll(async () => (await received(request)).find(reply => reply.subject === `Re: ${subject}`) ?? null)
        .not.toBeNull();

    const reply = (await received(request)).find(item => item.subject === `Re: ${subject}`);
    expect(reply?.from).toBe(inbox);
    expect(reply?.to).toContain(sender);
    expect(reply?.inReplyTo, "In-Reply-To should equal the original Message-ID").toBe(caughtId);
    expect(reply?.references, "References should include the original Message-ID").toContain(caughtId);
    expect(reply?.html).toContain("off and on again");
});

test("compose a new message wrapped as a Google Group and confirm the rewrite arrives", async ({ page, request }) => {
    const subject = `Via the list ${Date.now()}`;
    const sender = uniqueAddress("alice");
    const inbox = uniqueAddress("inbox", "your-app.test");
    const group = uniqueAddress("partners", "groups.example.test");

    // A forward profile adds fields that make the composer tall; a roomy viewport keeps the whole flow on
    // screen. Short-viewport scroll behaviour is guarded by its own test below.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await page.goto("/");
    await page.getByRole("button", { name: "New message" }).click();

    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    await modal.locator('label:has-text("From (original sender)") input').fill(`"Alice Sender" <${sender}>`);
    await modal.locator('label:has-text("To (delivered inbox)") input').fill(inbox);
    await modal.locator('label:has-text("Subject") input').fill(subject);
    await modal.locator('label:has-text("Forward style") select').selectOption("google-groups");
    await modal.locator('label:has-text("Group address") input').fill(group);
    await modal.locator('label:has-text("Group name") input').fill("Partner Integrations");

    const body = modal.locator(".ProseMirror");
    await body.click();
    await page.keyboard.type("Sent through a distribution list.");

    await modal.getByRole("button", { name: "Send", exact: true }).click();
    await expect(modal).toBeHidden();

    // The composed send lands at the demo app, with the From rewritten to the group and the true sender
    // recoverable from Reply-To.
    await expect.poll(async () => (await received(request)).find(item => item.subject === subject) ?? null).not.toBeNull();

    const delivered = (await received(request)).find(item => item.subject === subject);
    expect(delivered?.from).toBe(group);
    expect(delivered?.html).toContain("distribution list");
});

test("the compose modal's Send button stays reachable on a short viewport", async ({ page }) => {
    // Regression guard: with a forward profile's extra fields the modal outgrows a short viewport, so it
    // must scroll internally to keep Send reachable rather than pushing it off-screen.
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/");

    await page.getByRole("button", { name: "New message" }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    await modal.locator('label:has-text("Forward style") select').selectOption("google-groups");

    const send = modal.getByRole("button", { name: "Send", exact: true });
    await send.scrollIntoViewIfNeeded();
    await expect(send).toBeInViewport();
});
