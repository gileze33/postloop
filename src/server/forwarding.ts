import { randomBytes } from "crypto";
import { forwardProfileById } from "../shared/forwardingProfiles";
import type { ComposeAttachment } from "./compose";
import { composeMessage } from "./compose";

export interface ForwardBase {
    /** The true original sender (the compose From). */
    originalSender: string;
    /** The address the message is delivered to; the detox door resolves the inbox from here. */
    inbox: string;
    cc?: string;
    subject: string;
    html: string;
    attachments?: ComposeAttachment[];
    /** Profile-specific fields (groupAddress, forwarderAddress, ...). */
    params: Record<string, string>;
}

type Built = Promise<{ rawEml: Buffer; messageId: string }>;

const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_FULL = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
];
const DAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const pad = (value: number): string => String(value).padStart(2, "0");

const bareAddress = (input: string): string => {
    const angle = input.match(/<([^<>]+)>/);

    return (angle ? angle[1] : input).trim();
};

const displayName = (input: string): string => {
    const named = input.match(/^\s*"?([^"<]*?)"?\s*<[^<>]+>/);

    return (named && named[1].trim()) || bareAddress(input).split("@")[0];
};

const localPart = (address: string): string => bareAddress(address).split("@")[0];
const domainPart = (address: string): string => bareAddress(address).split("@")[1] ?? "";
const stripFwd = (subject: string): string => subject.replace(/^(\s*(re|fwd|fw)\s*:\s*)+/i, "").trim();

const escapeHtml = (text: string): string =>
    text.replace(/[&<>]/g, char => (char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;"));

const htmlToText = (html: string): string =>
    html
        .replace(/<br\s*\/?>(?=)/gi, "\n")
        .replace(/<\/(p|div|tr|li|h[1-6])>/gi, "\n")
        .replace(/<[^>]+>/g, "")
        .replace(/&nbsp;/gi, " ")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&amp;/gi, "&")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

// Gmail's in-block date, e.g. "Fri, 11 Sep 2026 at 09:05".
const gmailDate = (date: Date): string =>
    `${DAYS_SHORT[date.getUTCDay()]}, ${date.getUTCDate()} ${MONTHS_SHORT[date.getUTCMonth()]} ${date.getUTCFullYear()} at ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

// Outlook's Sent: line, en-GB long form, e.g. "11 September 2026 09:05".
const outlookDate = (date: Date): string =>
    `${date.getUTCDate()} ${MONTHS_FULL[date.getUTCMonth()]} ${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;

const requireParam = (params: Record<string, string>, key: string, profile: string): string => {
    const value = (params[key] ?? "").trim();

    if (!value) {
        throw new Error(`${profile} requires "${key}"`);
    }

    return value;
};

const token = (bytes: number): string => randomBytes(bytes).toString("hex");

const buildPlain = (base: ForwardBase): Built =>
    composeMessage({
        from: base.originalSender,
        to: base.inbox,
        cc: base.cc,
        subject: base.subject,
        html: base.html,
        attachments: base.attachments,
        headers: { "Delivered-To": bareAddress(base.inbox) },
    });

const buildGoogleGroups = (base: ForwardBase): Built => {
    const group = requireParam(base.params, "groupAddress", "Google Groups");
    const groupName = (base.params.groupName ?? "").trim() || group;
    const author = displayName(base.originalSender);
    const authorAddr = bareAddress(base.originalSender);
    const inbox = bareAddress(base.inbox);
    const gLocal = localPart(group);
    const gDomain = domainPart(group);

    return composeMessage({
        from: `"'${author}' via ${groupName}" <${group}>`,
        to: group,
        cc: base.cc,
        replyTo: base.originalSender,
        subject: base.subject,
        html: base.html,
        attachments: base.attachments,
        messageIdDomain: gDomain || "googlegroups.com",
        headers: {
            "X-Original-From": base.originalSender,
            "X-Original-Sender": authorAddr,
            "Delivered-To": inbox,
            "X-Forwarded-To": inbox,
            "X-Forwarded-For": `${authorAddr} ${inbox}`,
            Precedence: "list",
            "Mailing-list": `list ${group}; contact ${gLocal}+owners@${gDomain}`,
            "List-ID": `<${gLocal}.${gDomain}>`,
            "List-Post": `<mailto:${group}>`,
            "List-Unsubscribe": `<mailto:${gLocal}+unsubscribe@${gDomain}>`,
            "X-Google-Group-Id": String(Math.floor(Math.random() * 9e11) + 1e11),
            "Return-Path": `<${gLocal}+bnc${token(12)}@${gDomain}>`,
        },
    });
};

const buildGmailForward = (base: ForwardBase): Built => {
    const forwarder = requireParam(base.params, "forwarderAddress", "Gmail forward");
    const author = displayName(base.originalSender);
    const authorAddr = bareAddress(base.originalSender);
    const inbox = bareAddress(base.inbox);
    const when = gmailDate(new Date());

    const html =
        `<div dir="ltr"><br><br><div class="gmail_quote gmail_quote_container">` +
        `<div dir="ltr" class="gmail_attr">---------- Forwarded message ---------<br>` +
        `From: <strong class="gmail_sendername" dir="auto">${escapeHtml(author)}</strong> ` +
        `<span dir="auto">&lt;<a href="mailto:${authorAddr}">${authorAddr}</a>&gt;</span><br>` +
        `Date: ${escapeHtml(when)}<br>Subject: ${escapeHtml(base.subject)}<br>` +
        `To: <a href="mailto:${inbox}">${inbox}</a><br></div><br><br>` +
        `${base.html}</div></div>`;

    const text =
        `---------- Forwarded message ---------\n` +
        `From: ${author} <${authorAddr}>\nDate: ${when}\nSubject: ${base.subject}\nTo: ${inbox}\n\n\n` +
        `${htmlToText(base.html)}\n`;

    return composeMessage({
        from: forwarder,
        to: base.inbox,
        subject: `Fwd: ${stripFwd(base.subject)}`,
        html,
        text,
        attachments: base.attachments,
        messageIdDomain: "mail.gmail.com",
        headers: { "Delivered-To": inbox },
    });
};

const buildOutlookForward = (base: ForwardBase): Built => {
    const forwarder = requireParam(base.params, "forwarderAddress", "Outlook forward");
    const author = displayName(base.originalSender);
    const authorAddr = bareAddress(base.originalSender);
    const inbox = bareAddress(base.inbox);
    const when = outlookDate(new Date());

    const html =
        `<div><hr tabindex="-1" style="display:inline-block; width:98%">` +
        `<div id="divRplyFwdMsg" dir="ltr">` +
        `<font face="Calibri, sans-serif" style="font-size:11pt" color="#000000">` +
        `<b>From:</b> ${escapeHtml(author)} &lt;${authorAddr}&gt;<br>` +
        `<b>Sent:</b> ${escapeHtml(when)}<br><b>To:</b> ${inbox}<br>` +
        (base.cc ? `<b>Cc:</b> ${escapeHtml(base.cc)}<br>` : "") +
        `<b>Subject:</b> ${escapeHtml(base.subject)}</font><div>&nbsp;</div></div>` +
        `${base.html}</div>`;

    const text =
        `________________________________\n` +
        `From: ${author} <${authorAddr}>\nSent: ${when}\nTo: ${inbox}\n` +
        (base.cc ? `Cc: ${base.cc}\n` : "") +
        `Subject: ${base.subject}\n\n${htmlToText(base.html)}\n`;

    return composeMessage({
        from: forwarder,
        to: base.inbox,
        subject: `FW: ${stripFwd(base.subject)}`,
        html,
        text,
        attachments: base.attachments,
        headers: {
            "Delivered-To": inbox,
            "Thread-Topic": stripFwd(base.subject),
            "Thread-Index": randomBytes(22).toString("base64"),
        },
    });
};

export const buildForwarded = (profileId: string, base: ForwardBase): Built => {
    if (!forwardProfileById(profileId)) {
        throw new Error(`Unknown forward profile: ${profileId}`);
    }

    switch (profileId) {
        case "google-groups":
            return buildGoogleGroups(base);
        case "gmail-forward":
            return buildGmailForward(base);
        case "outlook-forward":
            return buildOutlookForward(base);
        default:
            return buildPlain(base);
    }
};
