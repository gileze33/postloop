import { forwardProfileById } from "../shared/forwardingProfiles";
import type { ReplyResult } from "../shared/types";
import type { ComposeAttachment } from "./compose";
import { composeReply } from "./compose";
import { getConfig } from "./config";
import { buildForwarded } from "./forwarding";
import { getMessage, saveSentMessage } from "./store";

export const REPLIES_DISABLED_MESSAGE =
    "Replies are disabled. Set the OUTBOUND_URL environment variable to your app's inbound endpoint to enable them.";

/** Replies and sends are gated on OUTBOUND_URL; thrown when it is unset. */
export class RepliesDisabledError extends Error {
    constructor() {
        super(REPLIES_DISABLED_MESSAGE);
        this.name = "RepliesDisabledError";
    }
}

/** The message being replied to was not found in its inbox. */
export class MessageNotFoundError extends Error {
    constructor() {
        super("not found");
        this.name = "MessageNotFoundError";
    }
}

/** A forward profile rejected its inputs (e.g. a missing group address); the HTTP layer maps this to 400. */
export class ForwardBuildError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ForwardBuildError";
    }
}

/** POST a composed `.eml` to the app's inbound endpoint and return its response, parsed as JSON when it is. */
export const forwardToOutbound = async (outboundUrl: string, rawEml: Buffer): Promise<ReplyResult> => {
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

/** Compose a reply to a caught (or previously sent) message, POST it to the inbound endpoint, and store it. */
export const replyToMessage = async (
    address: string,
    id: string,
    html: string,
    attachments: ComposeAttachment[] = [],
): Promise<ReplyResult> => {
    const config = getConfig();

    if (!config.outboundUrl) {
        throw new RepliesDisabledError();
    }

    const original = await getMessage(address, id);

    if (!original) {
        throw new MessageNotFoundError();
    }

    const { rawEml } = await composeReply(original, address, html, attachments);
    const result = await forwardToOutbound(config.outboundUrl, rawEml);
    await saveSentMessage(rawEml, address);

    return result;
};

export interface SendInput {
    from: string;
    to: string;
    cc?: string;
    subject: string;
    html: string;
    profile?: string;
    attachments?: ComposeAttachment[];
    /** Profile-specific fields (groupAddress, forwarderAddress, ...). */
    params?: Record<string, string>;
}

/** Start a new conversation (or forward one), optionally wrapped in a provider's forwarding shape, then POST it. */
export const sendComposed = async (input: SendInput): Promise<ReplyResult> => {
    const config = getConfig();

    if (!config.outboundUrl) {
        throw new RepliesDisabledError();
    }

    const profileId =
        input.profile && forwardProfileById(input.profile) ? input.profile : config.defaultForwardProfile;

    let rawEml: Buffer;

    try {
        ({ rawEml } = await buildForwarded(profileId, {
            originalSender: input.from,
            inbox: input.to,
            cc: input.cc,
            subject: input.subject,
            html: input.html,
            attachments: input.attachments,
            params: input.params ?? {},
        }));
    } catch (buildError) {
        throw new ForwardBuildError((buildError as Error).message);
    }

    const result = await forwardToOutbound(config.outboundUrl, rawEml);
    await saveSentMessage(rawEml, input.from);

    return result;
};
