/** DTOs shared between the Fastify server and the React UI. */

export type MessageDirection = "in" | "out";

export interface InboxSummary {
    /** The address the mail was received on, or sent as; the on-disk inbox folder name. */
    address: string;
    messageCount: number;
    lastMessageAt: string;
}

export interface AttachmentMetadata {
    filename: string;
    contentType: string;
    size: number;
}

export interface MessageSummary {
    /** The `{epoch-ms}-{rand}` filename stem (plus `.out` for a sent message); unique within an inbox. */
    id: string;
    inbox: string;
    /** `in` = caught from the app under test; `out` = sent from Postloop. */
    direction: MessageDirection;
    from: string;
    fromName?: string;
    to: string[];
    subject: string;
    /** When Postloop caught (in) or sent (out) it. */
    receivedAt: string;
    snippet: string;
    attachmentCount: number;
}

export interface MessageDetail extends MessageSummary {
    html: string;
    text?: string;
    messageId?: string;
    references?: string[];
    inReplyTo?: string;
    attachments: AttachmentMetadata[];
}

export interface ReplyResult {
    status: number;
    body: unknown;
}

export interface ClientConfig {
    /** False until OUTBOUND_URL is set; the UI disables replying/sending when false. */
    repliesEnabled: boolean;
    /** The default forward-wrapper profile id (from DEFAULT_FORWARD_PROFILE); the compose UI pre-selects it. */
    defaultForwardProfile: string;
}
