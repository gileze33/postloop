import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { APIRequestContext } from "@playwright/test";
import { DEMO_APP_URL, POSTLOOP_URL } from "./config";
import { expect, test, uniqueAddress } from "./fixtures";

// These tests drive the MCP endpoint the way an AI agent would (over the Streamable HTTP transport) and,
// where it matters, cross-check against the browser UI: both read and write the one filesystem store, so a
// reply sent through MCP must surface in the UI, and a reply sent in the UI must be readable through MCP.

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

const connect = async (): Promise<Client> => {
    const client = new Client({ name: "postloop-e2e", version: "0.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${POSTLOOP_URL}/mcp`)));

    return client;
};

// Call a tool and parse its text content as JSON (every Postloop tool returns a JSON payload as text).
const callJson = async (
    client: Client,
    name: string,
    args: Record<string, unknown> = {},
): Promise<{ data: unknown; isError: boolean }> => {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as { type: string; text?: string }[]).map(part => part.text ?? "").join("");

    try {
        return { data: JSON.parse(text), isError: Boolean(result.isError) };
    } catch {
        return { data: text, isError: Boolean(result.isError) };
    }
};

test("the MCP endpoint advertises the Postloop tools", async () => {
    const client = await connect();

    try {
        const { tools } = await client.listTools();

        expect(tools.map(tool => tool.name)).toEqual(
            expect.arrayContaining([
                "list_inboxes",
                "list_messages",
                "get_message",
                "reply",
                "send",
                "delete_message",
                "clear_inbox",
                "wait_for_message",
            ]),
        );

        // The server tells agents, up front, that this is a local test sink and not real mail.
        const instructions = client.getInstructions() ?? "";
        expect(instructions.toLowerCase()).toContain("local");
        expect(instructions.toLowerCase()).toContain("test");
        expect(instructions.toLowerCase()).toContain("real");

        // Proof the per-test store wipe works: nothing from earlier tests remains.
        const inboxes = (await callJson(client, "list_inboxes")).data as unknown[];
        expect(inboxes, "the store is wiped before each test").toEqual([]);
    } finally {
        await client.close();
    }
});

test("MCP loop: the app sends in, an agent replies over MCP, the app gets it back, and the reply shows in the UI", async ({
    page,
    request,
}) => {
    const stamp = Date.now();
    const sender = uniqueAddress("mcp-alice");
    const inbox = `mcp-support-${stamp}@your-app.test`;
    const subject = `MCP widget ${stamp}`;
    const knownMessageId = `<mcp-thread-${stamp}@demo.test>`;

    const client = await connect();

    try {
        // 1. The app under test sends a message into Postloop's SMTP sink.
        const sendRes = await request.post(`${DEMO_APP_URL}/send`, {
            data: {
                from: `"MCP Alice" <${sender}>`,
                to: inbox,
                subject,
                html: "<p>My widget is broken.</p>",
                messageId: knownMessageId,
            },
        });
        expect(sendRes.ok()).toBeTruthy();

        // 2. The agent awaits the caught mail over MCP (SMTP delivery lands a beat after the POST resolves).
        const waited = await callJson(client, "wait_for_message", { address: inbox, subject, timeoutMs: 10_000 });
        expect(waited.isError).toBeFalsy();
        const outcome = waited.data as {
            found: boolean;
            message: { id: string; subject: string; messageId?: string; text?: string };
        };
        expect(outcome.found, "wait_for_message should catch the message").toBe(true);
        expect(outcome.message.subject).toBe(subject);
        const caughtId = outcome.message.messageId;
        expect(caughtId, "the sink preserves the sender's Message-ID").toContain(`mcp-thread-${stamp}`);

        // 3. The agent replies over MCP.
        const replied = await callJson(client, "reply", {
            address: inbox,
            id: outcome.message.id,
            text: "Have you tried turning it off and on again?",
        });
        expect(replied.isError).toBeFalsy();
        expect((replied.data as { status: number }).status).toBe(200);

        // 4. The app receives the reply, threaded onto the original.
        await expect
            .poll(async () => (await received(request)).find(reply => reply.subject === `Re: ${subject}`) ?? null)
            .not.toBeNull();

        const reply = (await received(request)).find(item => item.subject === `Re: ${subject}`);
        expect(reply?.from).toBe(inbox);
        expect(reply?.to).toContain(sender);
        expect(reply?.inReplyTo, "In-Reply-To should equal the original Message-ID").toBe(caughtId);
        expect(reply?.references, "References should include the original Message-ID").toContain(caughtId);
        expect(reply?.html).toContain("off and on again");

        // 5. UI cross-check: the reply the agent sent over MCP is a stored message the UI renders.
        await page.goto("/");
        await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
        await expect(page.locator(".pane.messages .row", { hasText: `Re: ${subject}` })).toBeVisible();
    } finally {
        await client.close();
    }
});

test("a reply sent in the UI is readable over MCP", async ({ page, request }) => {
    const stamp = Date.now();
    const inbox = `mcp-ui-${stamp}@your-app.test`;
    const subject = `UI to MCP ${stamp}`;
    const sender = uniqueAddress("ui-sender");

    // The app sends a message in.
    const sendRes = await request.post(`${DEMO_APP_URL}/send`, {
        data: {
            from: sender,
            to: inbox,
            subject,
            html: "<p>Reply to me in the UI.</p>",
            messageId: `<mcp-ui-${stamp}@demo.test>`,
        },
    });
    expect(sendRes.ok()).toBeTruthy();

    // Reply through the real editor.
    await page.goto("/");
    await page.locator(".pane.inboxes .row", { hasText: inbox }).click();
    await page.locator(".pane.messages .row", { hasText: subject }).click();
    await expect(page.locator(".pane.reader .subject")).toHaveText(subject);

    const editor = page.locator(".reply .ProseMirror");
    // Click the empty top paragraph (not the element centre, which can land in the quoted original).
    await editor.click({ position: { x: 8, y: 8 } });
    await page.keyboard.type("Replying via the browser UI.");
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.locator(".reply .status")).toContainText("HTTP 200");

    // The UI-sent reply (stored as an outbound message under the inbox) is visible and readable over MCP.
    const client = await connect();

    try {
        const list = await callJson(client, "list_messages", { address: inbox });
        const messages = list.data as { id: string; direction: string; subject: string }[];
        const outReply = messages.find(message => message.direction === "out" && message.subject === `Re: ${subject}`);
        expect(outReply, "MCP should see the reply the UI sent").toBeTruthy();

        const got = await callJson(client, "get_message", { address: inbox, id: outReply!.id });
        const detail = got.data as { text?: string; html: string };
        expect(detail.text ?? detail.html).toContain("Replying via the browser UI");

        // raw:true returns the untouched stored .eml.
        const rawGot = await callJson(client, "get_message", { address: inbox, id: outReply!.id, raw: true });
        expect((rawGot.data as { raw: string }).raw).toContain(`Subject: Re: ${subject}`);
    } finally {
        await client.close();
    }
});

test("MCP send delivers a new message and applies a forward profile", async ({ request }) => {
    const stamp = Date.now();
    const sender = uniqueAddress("mcp-sender");
    const inbox = `mcp-send-${stamp}@your-app.test`;
    const plainSubject = `MCP plain ${stamp}`;
    const groupSubject = `MCP via group ${stamp}`;
    const group = uniqueAddress("partners", "groups.example.test");

    const client = await connect();

    try {
        // A plain send lands at the app with the From unchanged.
        const sent = await callJson(client, "send", {
            from: sender,
            to: inbox,
            subject: plainSubject,
            text: "Hello from an agent.",
        });
        expect(sent.isError).toBeFalsy();
        expect((sent.data as { status: number }).status).toBe(200);

        await expect
            .poll(async () => (await received(request)).find(item => item.subject === plainSubject) ?? null)
            .not.toBeNull();
        const plain = (await received(request)).find(item => item.subject === plainSubject);
        expect(plain?.from).toBe(sender);
        expect(plain?.html).toContain("Hello from an agent");

        // A forward profile rewrites the From, driven by params.
        const viaGroupSent = await callJson(client, "send", {
            from: sender,
            to: inbox,
            subject: groupSubject,
            text: "Through a distribution list.",
            profile: "google-groups",
            params: { groupAddress: group, groupName: "Partners" },
        });
        expect(viaGroupSent.isError).toBeFalsy();

        await expect
            .poll(async () => (await received(request)).find(item => item.subject === groupSubject) ?? null)
            .not.toBeNull();
        const viaGroup = (await received(request)).find(item => item.subject === groupSubject);
        expect(viaGroup?.from, "google-groups rewrites From to the group address").toBe(group);

        // A sent message is stored under its From address, so list_inboxes surfaces it.
        const inboxes = (await callJson(client, "list_inboxes")).data as { address: string }[];
        expect(inboxes.map(entry => entry.address)).toContain(sender);
    } finally {
        await client.close();
    }
});

test("MCP delete_message and clear_inbox remove stored mail", async ({ request }) => {
    const stamp = Date.now();
    const inbox = `mcp-cleanup-${stamp}@your-app.test`;
    const keep = `Keep ${stamp}`;
    const drop = `Drop ${stamp}`;
    const sender = uniqueAddress("seed");

    for (const subject of [keep, drop]) {
        const res = await request.post(`${DEMO_APP_URL}/send`, {
            data: { from: sender, to: inbox, subject, html: `<p>${subject}</p>` },
        });
        expect(res.ok(), `seeding "${subject}"`).toBeTruthy();
    }

    const client = await connect();

    try {
        const list = async (): Promise<{ id: string; subject: string }[]> =>
            (await callJson(client, "list_messages", { address: inbox })).data as { id: string; subject: string }[];

        // Both messages land a beat after the SMTP POST resolves.
        await expect.poll(async () => (await list()).length).toBe(2);
        const dropId = (await list()).find(message => message.subject === drop)!.id;

        // delete_message removes just that one.
        const deleted = await callJson(client, "delete_message", { address: inbox, id: dropId });
        expect((deleted.data as { deleted: boolean }).deleted).toBe(true);
        expect((await list()).map(message => message.subject)).toEqual([keep]);

        // Deleting a gone message reports false.
        const again = await callJson(client, "delete_message", { address: inbox, id: dropId });
        expect((again.data as { deleted: boolean }).deleted).toBe(false);

        // clear_inbox empties it, and it drops out of list_inboxes.
        const cleared = await callJson(client, "clear_inbox", { address: inbox });
        expect((cleared.data as { cleared: boolean }).cleared).toBe(true);
        expect(await list()).toEqual([]);
        const inboxes = (await callJson(client, "list_inboxes")).data as { address: string }[];
        expect(inboxes.map(entry => entry.address)).not.toContain(inbox);
    } finally {
        await client.close();
    }
});
