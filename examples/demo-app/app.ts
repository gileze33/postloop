/**
 * A tiny stand-in for "your app" in the Postloop loop. It does the two things a real application does
 * with Postloop:
 *
 *   1. Sends mail OUT over SMTP into Postloop's sink (POST /send).
 *   2. Receives replies BACK on an inbound HTTP endpoint (POST /outbound), the address you point
 *      Postloop's OUTBOUND_URL at.
 *
 * It keeps what it has sent and received in memory and renders them on a dashboard at `/`, so you can
 * watch a message go out, reply to it in the Postloop UI, and see the reply arrive here. The Playwright
 * E2E suite drives this same app.
 *
 *   PORT       this app's HTTP port           (default 4000)
 *   SMTP_HOST  Postloop's SMTP sink host      (default 127.0.0.1)
 *   SMTP_PORT  Postloop's SMTP sink port      (default 1025)
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { simpleParser } from "mailparser";
import nodemailer from "nodemailer";

const PORT = Number(process.env.PORT ?? 4000);
const SMTP_HOST = process.env.SMTP_HOST ?? "127.0.0.1";
const SMTP_PORT = Number(process.env.SMTP_PORT ?? 1025);

interface SentMessage {
    sentAt: string;
    from: string;
    to: string;
    subject: string;
}

interface ReceivedReply {
    receivedAt: string;
    from: string;
    to: string[];
    subject: string;
    messageId?: string;
    inReplyTo?: string;
    references?: string[];
    html: string;
    text: string;
}

const sent: SentMessage[] = [];
const received: ReceivedReply[] = [];

const transport = nodemailer.createTransport({ host: SMTP_HOST, port: SMTP_PORT, secure: false, ignoreTLS: true });

const readBody = (req: IncomingMessage): Promise<Buffer> =>
    new Promise((resolvePromise, rejectPromise) => {
        const chunks: Buffer[] = [];
        req.on("data", chunk => chunks.push(chunk as Buffer));
        req.on("end", () => resolvePromise(Buffer.concat(chunks)));
        req.on("error", rejectPromise);
    });

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
};

const addresses = (value: unknown): string[] => {
    if (!value) {
        return [];
    }

    const list = Array.isArray(value) ? value : [value];

    return list
        .flatMap(entry => ("value" in entry ? entry.value : []))
        .map(item => item.address ?? "")
        .filter(Boolean);
};

const dashboard = (): string => `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Postloop demo app</title>
<style>
  body { font: 14px system-ui, sans-serif; margin: 0; background: #f6f7f9; color: #1c2230; }
  header { padding: 16px 24px; background: #12203a; color: #fff; }
  header h1 { margin: 0; font-size: 18px; }
  header p { margin: 4px 0 0; opacity: .75; }
  main { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; padding: 24px; }
  section { background: #fff; border: 1px solid #e3e6ec; border-radius: 8px; padding: 16px; }
  h2 { margin: 0 0 12px; font-size: 15px; }
  .item { border-top: 1px solid #eef0f4; padding: 10px 0; }
  .item:first-of-type { border-top: none; }
  .subject { font-weight: 600; }
  .meta { color: #66707f; font-size: 12px; margin-top: 2px; }
  .empty { color: #99a1ad; }
  button { font: inherit; padding: 6px 12px; border: 1px solid #12203a; background: #12203a; color: #fff; border-radius: 6px; cursor: pointer; }
</style></head>
<body>
  <header>
    <h1>Postloop demo app</h1>
    <p>Sends into the SMTP sink at ${SMTP_HOST}:${SMTP_PORT}, catches replies on POST /outbound.</p>
  </header>
  <main>
    <section>
      <h2>Sent into Postloop</h2>
      <button id="send">Send a test email</button>
      <div id="sent"></div>
    </section>
    <section>
      <h2>Replies received back</h2>
      <div id="received"></div>
    </section>
  </main>
  <script>
    const render = (el, items, kind) => {
      if (!items.length) { el.innerHTML = '<div class="item empty">Nothing yet.</div>'; return; }
      el.innerHTML = items.map(m =>
        '<div class="item"><div class="subject">' + (m.subject || '(no subject)') + '</div>' +
        '<div class="meta">' + (kind === 'sent' ? ('to ' + m.to + ' &middot; ' + m.sentAt) : ('from ' + m.from + ' &middot; ' + m.receivedAt)) + '</div></div>'
      ).join('');
    };
    const refresh = async () => {
      const [s, r] = await Promise.all([fetch('/sent').then(x => x.json()), fetch('/outbound').then(x => x.json())]);
      render(document.getElementById('sent'), s, 'sent');
      render(document.getElementById('received'), r, 'received');
    };
    document.getElementById('send').addEventListener('click', async () => {
      await fetch('/send', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
        from: '"Demo Sender" <sender@example.test>', to: 'demo@your-app.test',
        subject: 'Hello from the demo app', html: '<p>This went out over SMTP. Reply to me in Postloop.</p>',
      }) });
      refresh();
    });
    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
    const method = req.method ?? "GET";

    try {
        if (method === "GET" && url.pathname === "/health") {
            return sendJson(res, 200, { ok: true });
        }

        if (method === "GET" && url.pathname === "/") {
            res.writeHead(200, { "content-type": "text/html" });

            return res.end(dashboard());
        }

        if (method === "GET" && url.pathname === "/sent") {
            return sendJson(res, 200, sent);
        }

        if (method === "GET" && url.pathname === "/outbound") {
            return sendJson(res, 200, received);
        }

        if (method === "POST" && url.pathname === "/reset") {
            sent.length = 0;
            received.length = 0;

            return sendJson(res, 200, { ok: true });
        }

        // Send a message OUT into Postloop's SMTP sink, exactly as a real app's mail transport would.
        if (method === "POST" && url.pathname === "/send") {
            const payload = JSON.parse((await readBody(req)).toString() || "{}") as {
                from?: string;
                to?: string;
                subject?: string;
                html?: string;
            };
            const message = {
                from: payload.from ?? '"Demo Sender" <sender@example.test>',
                to: payload.to ?? "demo@your-app.test",
                subject: payload.subject ?? "Hello from the demo app",
                html: payload.html ?? "<p>Sent over SMTP by the demo app.</p>",
            };
            await transport.sendMail(message);
            sent.unshift({ sentAt: new Date().toISOString(), from: message.from, to: message.to, subject: message.subject });

            return sendJson(res, 200, { ok: true });
        }

        // Receive a reply BACK from Postloop (this is the address OUTBOUND_URL points at).
        if (method === "POST" && url.pathname === "/outbound") {
            const raw = await readBody(req);
            const parsed = await simpleParser(raw);
            received.unshift({
                receivedAt: new Date().toISOString(),
                from: parsed.from?.value[0]?.address ?? "",
                to: addresses(parsed.to),
                subject: parsed.subject ?? "",
                messageId: parsed.messageId,
                inReplyTo: parsed.inReplyTo,
                references: parsed.references ? (Array.isArray(parsed.references) ? parsed.references : [parsed.references]) : undefined,
                html: typeof parsed.html === "string" ? parsed.html : "",
                text: parsed.text ?? "",
            });
            console.log(`[demo-app] received reply "${parsed.subject}" from Postloop`);

            return sendJson(res, 200, { ok: true });
        }

        return sendJson(res, 404, { message: "not found" });
    } catch (error) {
        return sendJson(res, 500, { message: (error as Error).message });
    }
});

server.listen(PORT, "127.0.0.1", () => {
    console.log(`[demo-app] listening on http://127.0.0.1:${PORT} (sending to SMTP ${SMTP_HOST}:${SMTP_PORT})`);
});
