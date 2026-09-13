import { useEffect, useMemo, useState } from "react";
import type { InboxSummary, MessageDetail, MessageSummary } from "../shared/types";
import {
    attachmentUrl,
    clearInbox,
    deleteMessage,
    fetchAttachmentFile,
    fetchConfig,
    fetchInboxes,
    fetchMessage,
    fetchMessages,
    fetchRaw,
    sendReply,
} from "./api";
import { AttachmentPicker } from "./components/AttachmentPicker";
import { ComposeModal, type ComposeInitial } from "./components/ComposeModal";
import { Editor } from "./components/Editor";

const formatTime = (iso: string): string => new Date(iso).toLocaleString();

const directionLabel = (direction: "in" | "out"): string => (direction === "out" ? "Sent" : "Received");

// Pre-fill the composer with the caught message as the original being forwarded; the chosen forward
// profile decides how it's wrapped in the outbound `.eml`.
const forwardInitial = (message: MessageDetail): ComposeInitial => ({
    from: message.fromName ? `${message.fromName} <${message.from}>` : message.from,
    to: "",
    subject: message.subject,
    html: message.html,
});

// A reply pre-filled with the quoted original, so you type above it like a normal email client.
const quotedReply = (message: MessageDetail): string => {
    const sender = message.fromName ? `${message.fromName} <${message.from}>` : message.from;

    return (
        "<p></p>" +
        `<p>On ${new Date(message.receivedAt).toLocaleString()}, ${sender} wrote:</p>` +
        `<blockquote>${message.html}</blockquote>`
    );
};

export const App = () => {
    const [inboxes, setInboxes] = useState<InboxSummary[]>([]);
    const [search, setSearch] = useState("");
    const [selectedInbox, setSelectedInbox] = useState<string | null>(null);
    const [messages, setMessages] = useState<MessageSummary[]>([]);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [message, setMessage] = useState<MessageDetail | null>(null);
    const [replyHtml, setReplyHtml] = useState("");
    const [replyFiles, setReplyFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [status, setStatus] = useState<string | null>(null);
    const [replyKey, setReplyKey] = useState(0);
    const [repliesEnabled, setRepliesEnabled] = useState(true);
    const [defaultForwardProfile, setDefaultForwardProfile] = useState("plain");
    const [compose, setCompose] = useState<{
        initial?: ComposeInitial;
        initialFiles?: File[];
        persist: boolean;
    } | null>(null);
    const [showRaw, setShowRaw] = useState(false);
    const [rawSource, setRawSource] = useState("");

    const refreshInboxes = () => {
        fetchInboxes()
            .then(setInboxes)
            .catch(() => undefined);
    };

    // Poll so newly caught mail appears without a refresh. TODO: replace with SSE or a websocket.
    useEffect(() => {
        refreshInboxes();
        const timer = setInterval(refreshInboxes, 4000);

        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        fetchConfig()
            .then(config => {
                setRepliesEnabled(config.repliesEnabled);
                setDefaultForwardProfile(config.defaultForwardProfile);
            })
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        if (!selectedInbox) {
            setMessages([]);

            return;
        }

        fetchMessages(selectedInbox)
            .then(setMessages)
            .catch(() => setMessages([]));
    }, [selectedInbox, inboxes]);

    useEffect(() => {
        setReplyHtml("");
        setReplyFiles([]);
        setStatus(null);
        setShowRaw(false);
        setRawSource("");

        if (!selectedInbox || !selectedId) {
            setMessage(null);

            return;
        }

        fetchMessage(selectedInbox, selectedId)
            .then(loaded => {
                setMessage(loaded);
                setReplyHtml(quotedReply(loaded));
            })
            .catch(() => setMessage(null));
    }, [selectedInbox, selectedId]);

    const filteredInboxes = useMemo(() => {
        const query = search.trim().toLowerCase();

        return query ? inboxes.filter(inbox => inbox.address.toLowerCase().includes(query)) : inboxes;
    }, [inboxes, search]);

    const onSend = async () => {
        if (!selectedInbox || !selectedId) {
            return;
        }

        setSending(true);
        setStatus(null);

        try {
            const result = await sendReply(selectedInbox, selectedId, replyHtml, replyFiles);
            setStatus(`Sent, the door replied HTTP ${result.status}`);
            setReplyFiles([]);

            if (message) {
                setReplyHtml(quotedReply(message));
                setReplyKey(key => key + 1);
            }

            refreshInboxes();
        } catch (error) {
            setStatus(`Failed: ${(error as Error).message}`);
        } finally {
            setSending(false);
        }
    };

    // Carry the original's attachments onto the forward: pull each stored file down so it re-attaches (and
    // shows, removable) in the composer. If a fetch fails, forward with whatever came back rather than block.
    const onForward = async (original: MessageDetail) => {
        const settled = await Promise.allSettled(
            original.attachments.map((attachment, index) =>
                fetchAttachmentFile(original.inbox, original.id, index, attachment.filename, attachment.contentType),
            ),
        );
        const initialFiles = settled
            .filter((result): result is PromiseFulfilledResult<File> => result.status === "fulfilled")
            .map(result => result.value);

        setCompose({ initial: forwardInitial(original), initialFiles, persist: false });
    };

    const closeCompose = () => {
        setCompose(null);
        refreshInboxes();
    };

    const toggleRaw = async () => {
        if (!showRaw && !rawSource && selectedInbox && selectedId) {
            try {
                setRawSource(await fetchRaw(selectedInbox, selectedId));
            } catch {
                setRawSource("(failed to load raw source)");
            }
        }

        setShowRaw(value => !value);
    };

    const onDelete = async () => {
        if (!selectedInbox || !selectedId) {
            return;
        }

        try {
            await deleteMessage(selectedInbox, selectedId);
            setSelectedId(null);
            setMessage(null);
            fetchMessages(selectedInbox)
                .then(setMessages)
                .catch(() => setMessages([]));
            refreshInboxes();
        } catch {
            // Deleting caught test mail is best-effort; ignore failures.
        }
    };

    const onClearInbox = async () => {
        if (!selectedInbox || !window.confirm(`Clear all messages in ${selectedInbox}?`)) {
            return;
        }

        try {
            await clearInbox(selectedInbox);
            setSelectedInbox(null);
            setSelectedId(null);
            setMessages([]);
            refreshInboxes();
        } catch {
            // Best-effort; ignore failures.
        }
    };

    return (
        <div className="app">
            <header className="topbar">
                <span className="brand">Postloop</span>
                <span className="tagline">local two-way mail</span>
                <button
                    type="button"
                    className="new-btn"
                    disabled={!repliesEnabled}
                    title={repliesEnabled ? "Start a new conversation" : "Set OUTBOUND_URL to enable sending"}
                    onClick={() => setCompose({ persist: true })}
                >
                    New message
                </button>
            </header>

            <main className="panes">
                <section className="pane inboxes">
                    <input
                        className="search"
                        placeholder="Search addresses"
                        value={search}
                        onChange={event => setSearch(event.target.value)}
                    />
                    <ul className="list">
                        {filteredInboxes.map(inbox => (
                            <li
                                key={inbox.address}
                                className={inbox.address === selectedInbox ? "row active" : "row"}
                                onClick={() => {
                                    setSelectedInbox(inbox.address);
                                    setSelectedId(null);
                                }}
                            >
                                <span className="row-title">{inbox.address}</span>
                                <span className="row-meta">{inbox.messageCount}</span>
                            </li>
                        ))}
                        {filteredInboxes.length === 0 && <li className="empty">No addresses yet</li>}
                    </ul>
                </section>

                <section className="pane messages">
                    {selectedInbox && (
                        <div className="pane-head">
                            <span className="pane-head-title">{selectedInbox}</span>
                            <button type="button" className="reader-btn delete" onClick={onClearInbox}>
                                Clear inbox
                            </button>
                        </div>
                    )}
                    <ul className="list">
                        {messages.map(item => (
                            <li
                                key={item.id}
                                className={item.id === selectedId ? "row active" : "row"}
                                onClick={() => setSelectedId(item.id)}
                            >
                                <span className="row-title">{item.subject || "(no subject)"}</span>
                                <span className="row-sub">
                                    <span className={`tag ${item.direction}`}>{directionLabel(item.direction)}</span>
                                    {item.fromName || item.from}
                                    {item.attachmentCount > 0 && <span className="clip">{item.attachmentCount} file(s)</span>}
                                </span>
                                <span className="row-snippet">{item.snippet}</span>
                                <span className="row-meta">{formatTime(item.receivedAt)}</span>
                            </li>
                        ))}
                        {selectedInbox && messages.length === 0 && <li className="empty">No messages</li>}
                        {!selectedInbox && <li className="empty">Pick an address</li>}
                    </ul>
                </section>

                <section className="pane reader">
                    {message ? (
                        <>
                            <div className="reader-head">
                                <h2 className="subject">{message.subject || "(no subject)"}</h2>
                                <span className={`tag ${message.direction}`}>{directionLabel(message.direction)}</span>
                                <button type="button" className="reader-btn" onClick={toggleRaw}>
                                    {showRaw ? "Rendered" : "Raw source"}
                                </button>
                                <button
                                    type="button"
                                    className="forward-btn"
                                    disabled={!repliesEnabled}
                                    onClick={() => void onForward(message)}
                                >
                                    Forward
                                </button>
                                <button type="button" className="reader-btn delete" onClick={onDelete}>
                                    Delete
                                </button>
                            </div>
                            <div className="meta">
                                <div>
                                    <strong>From</strong> {message.fromName ? `${message.fromName} <${message.from}>` : message.from}
                                </div>
                                <div>
                                    <strong>To</strong> {message.to.join(", ")}
                                </div>
                                <div>
                                    <strong>{directionLabel(message.direction)}</strong> {formatTime(message.receivedAt)}
                                </div>
                            </div>
                            {message.attachments.length > 0 && (
                                <div className="attach-list read">
                                    {message.attachments.map((attachment, index) => (
                                        <a
                                            key={index}
                                            href={attachmentUrl(message.inbox, message.id, index)}
                                            download={attachment.filename || undefined}
                                        >
                                            {attachment.filename || `attachment ${index + 1}`}
                                        </a>
                                    ))}
                                </div>
                            )}
                            {showRaw ? (
                                <pre className="raw-source">{rawSource}</pre>
                            ) : (
                                // Sanitised server-side at the DTO boundary; the raw view shows the original.
                                <div className="body" dangerouslySetInnerHTML={{ __html: message.html }} />
                            )}

                            <div className="reply">
                                <h3>Reply as {selectedInbox}</h3>
                                <Editor
                                    key={`${message.id}-${replyKey}`}
                                    value={replyHtml}
                                    onChange={setReplyHtml}
                                    placeholder="Write your reply..."
                                />
                                <AttachmentPicker files={replyFiles} onChange={setReplyFiles} />
                                <div className="reply-actions">
                                    <button type="button" disabled={sending || !repliesEnabled} onClick={onSend}>
                                        {sending ? "Sending..." : "Send reply"}
                                    </button>
                                    {!repliesEnabled && <span className="status">Set OUTBOUND_URL to enable replies</span>}
                                    {repliesEnabled && status && <span className="status">{status}</span>}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="empty">Pick a message to read</div>
                    )}
                </section>
            </main>

            {compose !== null && (
                <ComposeModal
                    initial={compose.initial}
                    initialFiles={compose.initialFiles}
                    persist={compose.persist}
                    defaultProfile={defaultForwardProfile}
                    onClose={closeCompose}
                />
            )}
        </div>
    );
};
