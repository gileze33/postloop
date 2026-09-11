import { randomUUID } from "crypto";
import MailComposer from "nodemailer/lib/mail-composer";
import type { MessageDetail } from "../shared/types";

export interface ComposeAttachment {
    filename: string;
    content: Buffer;
    contentType?: string;
}

export interface ComposeInput {
    from: string;
    to: string;
    cc?: string;
    replyTo?: string;
    subject: string;
    html: string;
    text?: string;
    attachments?: ComposeAttachment[];
    inReplyTo?: string;
    references?: string[];
    /** Extra raw headers (X-Original-From, List-*, Delivered-To, ...) for forwarding profiles. */
    headers?: Record<string, string>;
    /** Domain for the generated Message-ID, so a profile can mint a provider-appropriate id. */
    messageIdDomain?: string;
}

const stripRe = (subject: string): string => subject.replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "").trim();

export const composeMessage = async (input: ComposeInput): Promise<{ rawEml: Buffer; messageId: string }> => {
    const messageId = `<${randomUUID()}@${input.messageIdDomain ?? "postloop.local"}>`;

    const mail = new MailComposer({
        from: input.from,
        to: input.to,
        ...(input.cc ? { cc: input.cc } : {}),
        ...(input.replyTo ? { replyTo: input.replyTo } : {}),
        subject: input.subject,
        html: input.html,
        ...(input.text ? { text: input.text } : {}),
        messageId,
        ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
        ...(input.references && input.references.length ? { references: input.references } : {}),
        ...(input.headers ? { headers: input.headers } : {}),
        ...(input.attachments && input.attachments.length
            ? {
                  attachments: input.attachments.map(attachment => ({
                      filename: attachment.filename,
                      content: attachment.content,
                      contentType: attachment.contentType,
                  })),
              }
            : {}),
    });

    const rawEml = await mail.compile().build();

    return { rawEml, messageId };
};

/**
 * A reply from the inbox we're viewing back to the other party in the thread: for a caught (in) message
 * that's its sender, for one we already sent (out) that's its recipient. Chained via In-Reply-To /
 * References so the app under test threads it.
 */
export const composeReply = (
    original: MessageDetail,
    fromAddress: string,
    html: string,
    attachments: ComposeAttachment[] = [],
): Promise<{ rawEml: Buffer; messageId: string }> => {
    const otherParty = original.direction === "in" ? original.from : original.to[0] ?? original.from;
    const references = [...(original.references ?? []), ...(original.messageId ? [original.messageId] : [])];

    return composeMessage({
        from: fromAddress,
        to: otherParty,
        subject: `Re: ${stripRe(original.subject || "")}`,
        html,
        attachments,
        ...(original.messageId ? { inReplyTo: original.messageId } : {}),
        references,
    });
};
