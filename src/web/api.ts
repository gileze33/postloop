import type { ClientConfig, InboxSummary, MessageDetail, MessageSummary, ReplyResult } from "../shared/types";

const json = async <T>(url: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(url, init);

    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
    }

    return res.json() as Promise<T>;
};

const request = async (url: string, init?: RequestInit): Promise<void> => {
    const res = await fetch(url, init);

    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
    }
};

const text = async (url: string): Promise<string> => {
    const res = await fetch(url);

    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
    }

    return res.text();
};

const encode = (segment: string): string => encodeURIComponent(segment);

export const fetchConfig = (): Promise<ClientConfig> => json("/api/config");

export const fetchInboxes = (): Promise<InboxSummary[]> => json("/api/inboxes");

export const fetchMessages = (address: string): Promise<MessageSummary[]> =>
    json(`/api/inboxes/${encode(address)}/messages`);

export const fetchMessage = (address: string, id: string): Promise<MessageDetail> =>
    json(`/api/inboxes/${encode(address)}/messages/${encode(id)}`);

export const attachmentUrl = (address: string, id: string, index: number): string =>
    `/api/inboxes/${encode(address)}/messages/${encode(id)}/attachments/${index}`;

// Pull a stored attachment down as a File, so it can be re-attached to a forward (and shown, removable,
// in the composer) and re-sent through the same multipart path as a hand-picked file.
export const fetchAttachmentFile = async (
    address: string,
    id: string,
    index: number,
    filename: string,
    contentType: string,
): Promise<File> => {
    const res = await fetch(attachmentUrl(address, id, index));

    if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}`);
    }

    const blob = await res.blob();

    return new File([blob], filename || `attachment-${index + 1}`, {
        type: contentType || blob.type || "application/octet-stream",
    });
};

export const fetchRaw = (address: string, id: string): Promise<string> =>
    text(`/api/inboxes/${encode(address)}/messages/${encode(id)}/raw`);

export const deleteMessage = (address: string, id: string): Promise<void> =>
    request(`/api/inboxes/${encode(address)}/messages/${encode(id)}`, { method: "DELETE" });

export const clearInbox = (address: string): Promise<void> =>
    request(`/api/inboxes/${encode(address)}`, { method: "DELETE" });

export const sendReply = (address: string, id: string, html: string, attachments: File[]): Promise<ReplyResult> => {
    const form = new FormData();
    form.append("html", html);
    attachments.forEach(file => form.append("attachments", file));

    return json(`/api/inboxes/${encode(address)}/messages/${encode(id)}/reply`, { method: "POST", body: form });
};

export interface SendInput {
    from: string;
    to: string;
    cc?: string;
    subject: string;
    html: string;
    attachments: File[];
    profile: string;
    params: Record<string, string>;
}

export const sendNew = (input: SendInput): Promise<ReplyResult> => {
    const form = new FormData();
    form.append("from", input.from);
    form.append("to", input.to);

    if (input.cc) {
        form.append("cc", input.cc);
    }

    form.append("subject", input.subject);
    form.append("html", input.html);
    form.append("profile", input.profile);

    Object.entries(input.params).forEach(([key, value]) => {
        if (value) {
            form.append(key, value);
        }
    });

    input.attachments.forEach(file => form.append("attachments", file));

    return json("/api/send", { method: "POST", body: form });
};
