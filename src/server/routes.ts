import type { FastifyInstance, FastifyRequest } from "fastify";
import { forwardProfileById } from "../shared/forwardingProfiles";
import type { ReplyResult } from "../shared/types";
import type { ComposeAttachment } from "./compose";
import { composeReply } from "./compose";
import { getConfig } from "./config";
import { buildForwarded } from "./forwarding";
import {
    clearInbox,
    deleteMessage,
    getMessage,
    listInboxes,
    listMessages,
    readAttachment,
    readRaw,
    saveSentMessage,
} from "./store";

const REPLIES_DISABLED_MESSAGE =
    "Replies are disabled. Set the OUTBOUND_URL environment variable to your app's inbound endpoint to enable them.";

interface ParsedForm {
    fields: Record<string, string>;
    attachments: ComposeAttachment[];
}

const parseMultipart = async (request: FastifyRequest): Promise<ParsedForm> => {
    const fields: Record<string, string> = {};
    const attachments: ComposeAttachment[] = [];

    for await (const part of request.parts()) {
        if (part.type === "file") {
            attachments.push({
                filename: part.filename || "attachment",
                content: await part.toBuffer(),
                contentType: part.mimetype,
            });
        } else {
            fields[part.fieldname] = String(part.value);
        }
    }

    return { fields, attachments };
};

const forwardToOutbound = async (outboundUrl: string, rawEml: Buffer): Promise<ReplyResult> => {
    const res = await fetch(outboundUrl, {
        method: "POST",
        headers: { "content-type": "message/rfc822" },
        body: rawEml,
    });

    const rawBody = await res.text();
    let body: unknown = rawBody;

    try {
        body = JSON.parse(rawBody);
    } catch {
        // The endpoint may return plain text; keep the raw string.
    }

    return { status: res.status, body };
};

export const registerApiRoutes = (app: FastifyInstance): void => {
    app.get("/api/config", () => {
        const config = getConfig();

        return { repliesEnabled: Boolean(config.outboundUrl), defaultForwardProfile: config.defaultForwardProfile };
    });

    app.get("/api/inboxes", () => listInboxes());

    app.get<{ Params: { address: string } }>("/api/inboxes/:address/messages", request =>
        listMessages(decodeURIComponent(request.params.address)),
    );

    app.get<{ Params: { address: string; id: string } }>(
        "/api/inboxes/:address/messages/:id",
        async (request, reply) => {
            const message = await getMessage(decodeURIComponent(request.params.address), request.params.id);

            if (!message) {
                return reply.code(404).send({ message: "not found" });
            }

            return message;
        },
    );

    app.get<{ Params: { address: string; id: string; index: string } }>(
        "/api/inboxes/:address/messages/:id/attachments/:index",
        async (request, reply) => {
            const attachment = await readAttachment(
                decodeURIComponent(request.params.address),
                request.params.id,
                Number(request.params.index),
            );

            if (!attachment) {
                return reply.code(404).send({ message: "not found" });
            }

            return reply
                .header("content-type", attachment.contentType || "application/octet-stream")
                .header("content-disposition", `attachment; filename="${attachment.filename.replace(/"/g, "")}"`)
                .send(attachment.content);
        },
    );

    // The raw stored `.eml`, unsanitised, so you can see exactly what was caught or sent.
    app.get<{ Params: { address: string; id: string } }>(
        "/api/inboxes/:address/messages/:id/raw",
        async (request, reply) => {
            const raw = await readRaw(decodeURIComponent(request.params.address), request.params.id);

            if (!raw) {
                return reply.code(404).send({ message: "not found" });
            }

            return reply.header("content-type", "text/plain; charset=utf-8").send(raw);
        },
    );

    app.delete<{ Params: { address: string; id: string } }>(
        "/api/inboxes/:address/messages/:id",
        async (request, reply) => {
            const deleted = await deleteMessage(decodeURIComponent(request.params.address), request.params.id);

            if (!deleted) {
                return reply.code(404).send({ message: "not found" });
            }

            return reply.code(204).send();
        },
    );

    app.delete<{ Params: { address: string } }>("/api/inboxes/:address", async (request, reply) => {
        await clearInbox(decodeURIComponent(request.params.address));

        return reply.code(204).send();
    });

    app.post<{ Params: { address: string; id: string } }>(
        "/api/inboxes/:address/messages/:id/reply",
        async (request, reply) => {
            const config = getConfig();

            if (!config.outboundUrl) {
                return reply.code(409).send({ message: REPLIES_DISABLED_MESSAGE });
            }

            const address = decodeURIComponent(request.params.address);
            const original = await getMessage(address, request.params.id);

            if (!original) {
                return reply.code(404).send({ message: "not found" });
            }

            const { fields, attachments } = await parseMultipart(request);
            const { rawEml } = await composeReply(original, address, fields.html ?? "", attachments);
            const result = await forwardToOutbound(config.outboundUrl, rawEml);
            await saveSentMessage(rawEml, address);

            return reply.code(result.status).send(result);
        },
    );

    // Start a brand-new conversation, or forward an existing one, optionally wrapped in a provider's
    // forwarding shape (the UI pre-fills the fields and picks a profile).
    app.post("/api/send", async (request, reply) => {
        const config = getConfig();

        if (!config.outboundUrl) {
            return reply.code(409).send({ message: REPLIES_DISABLED_MESSAGE });
        }

        const { fields, attachments } = await parseMultipart(request);
        const from = (fields.from ?? "").trim();
        const to = (fields.to ?? "").trim();

        if (!from || !to) {
            return reply.code(400).send({ message: "from and to are required" });
        }

        const profileId =
            fields.profile && forwardProfileById(fields.profile) ? fields.profile : config.defaultForwardProfile;

        let rawEml: Buffer;

        try {
            ({ rawEml } = await buildForwarded(profileId, {
                originalSender: from,
                inbox: to,
                cc: fields.cc?.trim() || undefined,
                subject: fields.subject ?? "",
                html: fields.html ?? "",
                attachments,
                params: fields,
            }));
        } catch (buildError) {
            return reply.code(400).send({ message: (buildError as Error).message });
        }

        const result = await forwardToOutbound(config.outboundUrl, rawEml);
        await saveSentMessage(rawEml, from);

        return reply.code(result.status).send(result);
    });
};
