import type { FastifyInstance, FastifyRequest } from "fastify";
import type { ComposeAttachment } from "./compose";
import { getConfig } from "./config";
import {
    ForwardBuildError,
    MessageNotFoundError,
    REPLIES_DISABLED_MESSAGE,
    replyToMessage,
    sendComposed,
} from "./operations";
import { clearInbox, deleteMessage, getMessage, listInboxes, listMessages, readAttachment, readRaw } from "./store";

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
            if (!getConfig().outboundUrl) {
                return reply.code(409).send({ message: REPLIES_DISABLED_MESSAGE });
            }

            const address = decodeURIComponent(request.params.address);
            const { fields, attachments } = await parseMultipart(request);

            try {
                const result = await replyToMessage(address, request.params.id, fields.html ?? "", attachments);

                return reply.code(result.status).send(result);
            } catch (error) {
                if (error instanceof MessageNotFoundError) {
                    return reply.code(404).send({ message: "not found" });
                }

                throw error;
            }
        },
    );

    // Start a brand-new conversation, or forward an existing one, optionally wrapped in a provider's
    // forwarding shape (the UI pre-fills the fields and picks a profile).
    app.post("/api/send", async (request, reply) => {
        if (!getConfig().outboundUrl) {
            return reply.code(409).send({ message: REPLIES_DISABLED_MESSAGE });
        }

        const { fields, attachments } = await parseMultipart(request);
        const from = (fields.from ?? "").trim();
        const to = (fields.to ?? "").trim();

        if (!from || !to) {
            return reply.code(400).send({ message: "from and to are required" });
        }

        try {
            const result = await sendComposed({
                from,
                to,
                cc: fields.cc?.trim() || undefined,
                subject: fields.subject ?? "",
                html: fields.html ?? "",
                profile: fields.profile,
                attachments,
                params: fields,
            });

            return reply.code(result.status).send(result);
        } catch (error) {
            if (error instanceof ForwardBuildError) {
                return reply.code(400).send({ message: error.message });
            }

            throw error;
        }
    });
};
