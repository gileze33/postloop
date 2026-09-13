import type { APIRequestContext } from "@playwright/test";
import { DEMO_APP_URL } from "./config";
import { expect, test, uniqueAddress } from "./fixtures";

const enc = encodeURIComponent;

const sendMail = async (
    request: APIRequestContext,
    data: { from: string; to: string; subject: string; html: string },
): Promise<void> => {
    const res = await request.post(`${DEMO_APP_URL}/send`, { data });
    expect(res.ok(), `seeding "${data.subject}"`).toBeTruthy();
};

const waitForSubject = async (request: APIRequestContext, inbox: string, subject: string): Promise<void> => {
    for (let attempt = 0; attempt < 50; attempt++) {
        const messages = (await (await request.get(`/api/inboxes/${enc(inbox)}/messages`)).json()) as {
            subject: string;
        }[];

        if (messages.some(message => message.subject === subject)) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`message "${subject}" never appeared in ${inbox}`);
};

interface ReceivedReply {
    subject: string;
    html: string;
    text: string;
}

const received = async (request: APIRequestContext): Promise<ReceivedReply[]> =>
    (await request.get(`${DEMO_APP_URL}/outbound`)).json();

test("forwarding carries the original body underneath the intro", async ({ page, request }) => {
    const stamp = Date.now();
    const sender = uniqueAddress("alice");
    const inbox = uniqueAddress("support", "your-app.test");
    const target = uniqueAddress("colleague", "your-app.test");
    const subject = `Chain ${stamp}`;
    const originalBody = `original body sentinel ${stamp}`;

    await sendMail(request, { from: `"Alice" <${sender}>`, to: inbox, subject, html: `<p>${originalBody}</p>` });
    await waitForSubject(request, inbox, subject);

    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await page.locator(".pane.messages .row", { hasText: subject }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(subject);

    await page.getByRole("button", { name: "Forward" }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    // The composer opens with the original already in the editor, ready to forward.
    await expect(modal.locator(".ProseMirror")).toContainText(originalBody);

    await modal.locator('label:has-text("To (delivered inbox)") input').fill(target);
    // Compose extra text above the seeded original: both must survive into the sent message.
    await modal.locator(".ProseMirror").click({ position: { x: 8, y: 8 } });
    await page.keyboard.type("Passing this along.");

    await modal.getByRole("button", { name: "Send", exact: true }).click();
    await expect(modal).toBeHidden();

    await expect
        .poll(async () => (await received(request)).find(reply => reply.subject === subject) ?? null)
        .not.toBeNull();

    const forwarded = (await received(request)).find(reply => reply.subject === subject);
    expect(forwarded?.html, "the composed text survives").toContain("Passing this along.");
    expect(forwarded?.html, "the original body is carried underneath").toContain(originalBody);
});

test("a Gmail forward wraps the original beneath a Forwarded-message header", async ({ page, request }) => {
    const stamp = Date.now();
    const sender = uniqueAddress("alice");
    const inbox = uniqueAddress("support", "your-app.test");
    const forwarder = uniqueAddress("me", "gmail.test");
    const target = uniqueAddress("colleague", "your-app.test");
    const subject = `Please see ${stamp}`;
    const originalBody = `escalation detail ${stamp}`;

    // The profile's extra field makes the modal tall; a roomy viewport keeps Send on screen.
    await page.setViewportSize({ width: 1280, height: 1100 });
    await sendMail(request, { from: `"Alice" <${sender}>`, to: inbox, subject, html: `<p>${originalBody}</p>` });
    await waitForSubject(request, inbox, subject);

    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await page.locator(".pane.messages .row", { hasText: subject }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(subject);

    await page.getByRole("button", { name: "Forward" }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    await modal.locator('label:has-text("To (delivered inbox)") input').fill(target);
    await modal.locator('label:has-text("Forward style") select').selectOption("gmail-forward");
    await modal.locator('label:has-text("Forwarded by") input').fill(forwarder);

    await modal.getByRole("button", { name: "Send", exact: true }).click();
    await expect(modal).toBeHidden();

    const fwdSubject = `Fwd: ${subject}`;
    await expect
        .poll(async () => (await received(request)).find(reply => reply.subject === fwdSubject) ?? null)
        .not.toBeNull();

    const forwarded = (await received(request)).find(reply => reply.subject === fwdSubject);
    expect(forwarded?.html, "the Gmail forward header is present").toContain("Forwarded message");
    expect(forwarded?.html, "the original sender is named in the header").toContain(sender);
    expect(forwarded?.html, "the original body is carried underneath").toContain(originalBody);
});
