import { promises as fs } from "fs";
import { join } from "path";
import { simpleParser } from "mailparser";
import type { InboxSummary, MessageDetail, MessageSummary } from "../shared/types";
import { getConfig } from "./config";

const safeSegment = (segment: string): string => {
    if (!segment || segment.includes("/") || segment.includes("\\") || segment.includes("..")) {
        throw new Error(`Unsafe path segment: ${segment}`);
    }

    return segment;
};

const inboxDir = (address: string): string => join(getConfig().dataDir, safeSegment(address.toLowerCase()));

const stampToIso = (id: string): string => {
    const ms = Number(id.split("-")[0]);

    return Number.isFinite(ms) ? new Date(ms).toISOString() : new Date().toISOString();
};

const escapeHtml = (text: string): string =>
    text.replace(/[&<>]/g, char => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"));

// Pull the bare address out of a `Name <email>` or bare-address string, for the on-disk folder name.
const extractAddress = (input: string): string => {
    const angle = input.match(/<([^<>]+)>/);

    return (angle ? angle[1] : input).trim().toLowerCase();
};

const writeMessage = async (rawEml: Buffer, address: string, suffix: "" | ".out"): Promise<void> => {
    const dir = inboxDir(address);
    await fs.mkdir(dir, { recursive: true });

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await fs.writeFile(join(dir, `${stamp}${suffix}.eml`), rawEml);
};

/** Store a message caught from the app under test, under every envelope recipient it was sent to. */
export const saveMessage = async (rawEml: Buffer, recipients: string[]): Promise<void> => {
    const unique = [...new Set(recipients.map(recipient => recipient.trim().toLowerCase()).filter(Boolean))];

    for (const address of unique) {
        await writeMessage(rawEml, address, "");
    }
};

/** Store a message Postloop sent, under its From address, so it shows in that address's mailbox. */
export const saveSentMessage = async (rawEml: Buffer, fromField: string): Promise<void> => {
    const address = extractAddress(fromField);

    if (address) {
        await writeMessage(rawEml, address, ".out");
    }
};

const listMessageIds = async (address: string): Promise<string[]> => {
    try {
        const files = await fs.readdir(inboxDir(address));

        return files.filter(file => file.endsWith(".eml")).map(file => file.slice(0, -".eml".length));
    } catch {
        return [];
    }
};

export const listInboxes = async (): Promise<InboxSummary[]> => {
    let addresses: string[];

    try {
        const entries = await fs.readdir(getConfig().dataDir, { withFileTypes: true });
        addresses = entries.filter(entry => entry.isDirectory()).map(entry => entry.name);
    } catch {
        return [];
    }

    const inboxes = await Promise.all(
        addresses.map(async address => {
            const ids = await listMessageIds(address);
            const latest = [...ids].sort().at(-1);

            return {
                address,
                messageCount: ids.length,
                lastMessageAt: latest ? stampToIso(latest) : new Date(0).toISOString(),
            };
        }),
    );

    return inboxes
        .filter(inbox => inbox.messageCount > 0)
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
};

const toDetail = async (address: string, id: string): Promise<MessageDetail | null> => {
    let raw: Buffer;

    try {
        raw = await fs.readFile(join(inboxDir(address), `${safeSegment(id)}.eml`));
    } catch {
        return null;
    }

    const parsed = await simpleParser(raw);
    const fromEntry = parsed.from?.value[0];
    const text = parsed.text ?? undefined;
    const toObjects = parsed.to ? (Array.isArray(parsed.to) ? parsed.to : [parsed.to]) : [];
    const attachments = parsed.attachments.map(attachment => ({
        filename: attachment.filename ?? "",
        contentType: attachment.contentType,
        size: attachment.size,
    }));

    return {
        id,
        inbox: address,
        direction: id.endsWith(".out") ? "out" : "in",
        from: fromEntry?.address ?? "",
        fromName: fromEntry?.name || undefined,
        to: toObjects
            .flatMap(object => object.value)
            .map(value => value.address ?? "")
            .filter(Boolean),
        subject: parsed.subject ?? "",
        receivedAt: stampToIso(id),
        snippet: (text ?? "").replace(/\s+/g, " ").trim().slice(0, 140),
        attachmentCount: attachments.length,
        html: parsed.html || (text ? `<pre>${escapeHtml(text)}</pre>` : ""),
        text,
        messageId: parsed.messageId ?? undefined,
        references: parsed.references
            ? Array.isArray(parsed.references)
                ? parsed.references
                : [parsed.references]
            : undefined,
        inReplyTo: parsed.inReplyTo ?? undefined,
        attachments,
    };
};

export const listMessages = async (address: string): Promise<MessageSummary[]> => {
    const ids = await listMessageIds(address);
    const details = await Promise.all(ids.map(id => toDetail(address, id)));

    return details
        .filter((detail): detail is MessageDetail => detail !== null)
        .map(detail => ({
            id: detail.id,
            inbox: detail.inbox,
            direction: detail.direction,
            from: detail.from,
            fromName: detail.fromName,
            to: detail.to,
            subject: detail.subject,
            receivedAt: detail.receivedAt,
            snippet: detail.snippet,
            attachmentCount: detail.attachmentCount,
        }))
        .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
};

export const getMessage = (address: string, id: string): Promise<MessageDetail | null> => toDetail(address, id);

export const readAttachment = async (
    address: string,
    id: string,
    index: number,
): Promise<{ filename: string; contentType: string; content: Buffer } | null> => {
    let raw: Buffer;

    try {
        raw = await fs.readFile(join(inboxDir(address), `${safeSegment(id)}.eml`));
    } catch {
        return null;
    }

    const parsed = await simpleParser(raw);
    const attachment = parsed.attachments[index];

    if (!attachment) {
        return null;
    }

    return {
        filename: attachment.filename ?? `attachment-${index}`,
        contentType: attachment.contentType,
        content: attachment.content,
    };
};
