import { expect, test, type APIRequestContext } from "@playwright/test";
import { DEMO_APP_URL } from "./config";

const enc = encodeURIComponent;

interface SeedMessage {
    from: string;
    to: string;
    subject: string;
    html: string;
    messageId?: string;
}

const sendMail = async (request: APIRequestContext, data: SeedMessage): Promise<void> => {
    const res = await request.post(`${DEMO_APP_URL}/send`, { data });
    expect(res.ok(), `seeding "${data.subject}"`).toBeTruthy();
};

// The app under test sends over SMTP, so the message lands a beat after the POST resolves; poll for it.
const waitForMessageId = async (request: APIRequestContext, inbox: string, subject: string): Promise<string> => {
    for (let attempt = 0; attempt < 50; attempt++) {
        const messages = (await (await request.get(`/api/inboxes/${enc(inbox)}/messages`)).json()) as {
            id: string;
            subject: string;
        }[];
        const found = messages.find(message => message.subject === subject);

        if (found) {
            return found.id;
        }

        await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`message "${subject}" never appeared in ${inbox}`);
};

test("raw source view shows the untouched .eml", async ({ page, request }) => {
    const stamp = Date.now();
    const inbox = `raw-${stamp}@your-app.test`;
    const subject = `Raw ${stamp}`;
    await sendMail(request, {
        from: "sender@example.test",
        to: inbox,
        subject,
        html: "<p>Body here.</p>",
        messageId: `<raw-${stamp}@demo.test>`,
    });
    await waitForMessageId(request, inbox, subject);

    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await page.locator(".pane.messages .row", { hasText: subject }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(subject);

    await page.getByRole("button", { name: "Raw source" }).click();
    const raw = page.locator(".raw-source");
    await expect(raw).toBeVisible();
    await expect(raw).toContainText(`Subject: ${subject}`);
    await expect(raw).toContainText(`raw-${stamp}@demo.test`);

    // Toggling back restores the rendered body.
    await page.getByRole("button", { name: "Rendered" }).click();
    await expect(page.locator(".pane.reader .body")).toContainText("Body here.");
});

test("received HTML is sanitised for rendering while the stored source stays untouched", async ({ request }) => {
    const stamp = Date.now();
    const inbox = `xss-${stamp}@your-app.test`;
    const subject = `XSS ${stamp}`;
    await sendMail(request, {
        from: "attacker@example.test",
        to: inbox,
        subject,
        html: `<p>Hello there.</p><script>window.__pwned = 1;</script><a href="javascript:alert(1)">click</a>`,
    });
    const id = await waitForMessageId(request, inbox, subject);

    const detail = (await (await request.get(`/api/inboxes/${enc(inbox)}/messages/${enc(id)}`)).json()) as {
        html: string;
    };
    expect(detail.html, "the script tag is stripped from the rendered HTML").not.toContain("<script");
    expect(detail.html.toLowerCase(), "the javascript: URL is stripped").not.toContain("javascript:");
    expect(detail.html, "legitimate content survives").toContain("Hello there.");

    const raw = await (await request.get(`/api/inboxes/${enc(inbox)}/messages/${enc(id)}/raw`)).text();
    expect(raw, "the stored .eml keeps the original, unsanitised markup").toContain("<script>");
});

test("deleting a message removes it and leaves the rest", async ({ page, request }) => {
    const stamp = Date.now();
    const inbox = `del-${stamp}@your-app.test`;
    const keep = `Keep ${stamp}`;
    const drop = `Drop ${stamp}`;
    await sendMail(request, { from: "a@example.test", to: inbox, subject: keep, html: "<p>keep</p>" });
    await sendMail(request, { from: "a@example.test", to: inbox, subject: drop, html: "<p>drop</p>" });
    const dropId = await waitForMessageId(request, inbox, drop);
    await waitForMessageId(request, inbox, keep);

    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await page.locator(".pane.messages .row", { hasText: drop }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(drop);

    await page.getByRole("button", { name: "Delete", exact: true }).click();

    await expect(page.locator(".pane.messages .row", { hasText: drop })).toHaveCount(0);
    await expect(page.locator(".pane.messages .row", { hasText: keep })).toBeVisible();

    const res = await request.get(`/api/inboxes/${enc(inbox)}/messages/${enc(dropId)}`);
    expect(res.status(), "the deleted message is gone from the API too").toBe(404);
});

test("clearing an inbox empties it", async ({ page, request }) => {
    const stamp = Date.now();
    const inbox = `clear-${stamp}@your-app.test`;
    await sendMail(request, { from: "a@example.test", to: inbox, subject: `One ${stamp}`, html: "<p>1</p>" });
    await sendMail(request, { from: "a@example.test", to: inbox, subject: `Two ${stamp}`, html: "<p>2</p>" });
    await waitForMessageId(request, inbox, `Two ${stamp}`);

    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await expect(page.locator(".pane.messages .row")).toHaveCount(2);

    page.once("dialog", dialog => dialog.accept());
    await page.getByRole("button", { name: "Clear inbox" }).click();

    await expect(page.locator(".pane.inboxes .row", { hasText: inbox })).toHaveCount(0);

    const messages = (await (await request.get(`/api/inboxes/${enc(inbox)}/messages`)).json()) as unknown[];
    expect(messages, "the API reports the inbox as empty").toEqual([]);
});
