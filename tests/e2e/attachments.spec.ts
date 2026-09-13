import type { APIRequestContext } from "@playwright/test";
import { DEMO_APP_URL } from "./config";
import { expect, test, uniqueAddress } from "./fixtures";

const enc = encodeURIComponent;

interface SeedAttachment {
    filename: string;
    content: string;
    contentType?: string;
}

const sendMail = async (
    request: APIRequestContext,
    data: { from: string; to: string; subject: string; html: string; attachments?: SeedAttachment[] },
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
    attachments: { filename: string; content: string }[];
}

const received = async (request: APIRequestContext): Promise<ReceivedReply[]> =>
    (await request.get(`${DEMO_APP_URL}/outbound`)).json();

test("forwarding carries the original's attachments", async ({ page, request }) => {
    const stamp = Date.now();
    const sender = uniqueAddress("sender");
    const inbox = uniqueAddress("support", "your-app.test");
    const target = uniqueAddress("colleague", "your-app.test");
    const subject = `Spec attached ${stamp}`;
    const filename = `spec-${stamp}.txt`;
    const fileBody = `widget dimensions ${stamp}`;

    await sendMail(request, {
        from: `"Alice" <${sender}>`,
        to: inbox,
        subject,
        html: "<p>See the attached spec.</p>",
        attachments: [{ filename, content: fileBody, contentType: "text/plain" }],
    });
    await waitForSubject(request, inbox, subject);

    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await page.locator(".pane.messages .row", { hasText: subject }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(subject);

    // The caught message shows the attachment for download.
    await expect(page.locator(".pane.reader .attach-list.read")).toContainText(filename);

    // Forward: the composer opens with the original's attachment already carried across.
    await page.getByRole("button", { name: "Forward" }).click();
    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();
    await expect(modal.locator(".attachments .attach-list li")).toContainText(filename);

    await modal.locator('label:has-text("To (delivered inbox)") input').fill(target);
    const body = modal.locator(".ProseMirror");
    await body.click();
    await page.keyboard.type("Forwarding this on.");

    await modal.getByRole("button", { name: "Send", exact: true }).click();
    await expect(modal).toBeHidden();

    // The forwarded message lands at the app's inbound endpoint, attachment intact.
    await expect
        .poll(async () => (await received(request)).find(reply => reply.subject === subject) ?? null)
        .not.toBeNull();

    const forwarded = (await received(request)).find(reply => reply.subject === subject);
    const carried = forwarded?.attachments.find(attachment => attachment.filename === filename);
    expect(carried, "the original attachment is on the forward").toBeTruthy();
    expect(carried?.content, "its bytes survive the round trip").toBe(fileBody);
});

test("compose attachments persist across reopens", async ({ page }) => {
    const stamp = Date.now();
    const filename = `draft-note-${stamp}.txt`;

    await page.goto("/");
    await page.getByRole("button", { name: "New message" }).click();

    const modal = page.locator(".modal");
    await expect(modal).toBeVisible();

    await modal.locator('.attachments input[type="file"]').setInputFiles({
        name: filename,
        mimeType: "text/plain",
        buffer: Buffer.from(`draft body ${stamp}`),
    });
    await expect(modal.locator(".attachments .attach-list li")).toContainText(filename);

    // Wait for the async serialise-and-save to land before closing, so the reopen is deterministic.
    await expect
        .poll(async () => await page.evaluate(() => localStorage.getItem("postloop:compose-draft") ?? ""))
        .toContain(filename);

    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();

    await page.getByRole("button", { name: "New message" }).click();
    await expect(modal).toBeVisible();
    await expect(modal.locator(".attachments .attach-list li")).toContainText(filename);
});
