import { useEffect, useState } from "react";
import { FORWARD_PROFILES, forwardProfileById } from "../../shared/forwardingProfiles";
import { sendNew } from "../api";
import { AttachmentPicker } from "./AttachmentPicker";
import { Editor } from "./Editor";

export interface ComposeInitial {
    from?: string;
    to?: string;
    cc?: string;
    subject?: string;
    html?: string;
}

interface ComposeDraft extends ComposeInitial {
    profile?: string;
    params?: Record<string, string>;
}

interface ComposeModalProps {
    initial?: ComposeInitial;
    /** When true, seed from and persist every change to a local draft, so "New message" reopens ready to re-send. */
    persist?: boolean;
    defaultProfile: string;
    onClose: () => void;
}

const DRAFT_KEY = "postloop:compose-draft";

const loadDraft = (): ComposeDraft => {
    try {
        return JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "{}") as ComposeDraft;
    } catch {
        return {};
    }
};

const saveDraft = (draft: ComposeDraft): void => {
    try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
        // Ignore storage failures (private mode, quota); the draft is a convenience only.
    }
};

// Compose a from-scratch message, or (with `initial`) forward an existing one, optionally wrapped in a
// provider's forwarding shape (Google Groups, Gmail, Outlook). From is always the true original sender.
export const ComposeModal = ({ initial, persist = false, defaultProfile, onClose }: ComposeModalProps) => {
    const [seed] = useState<ComposeDraft>(() => (initial ? { ...initial } : persist ? loadDraft() : {}));
    const [from, setFrom] = useState(seed.from ?? "");
    const [to, setTo] = useState(seed.to ?? "");
    const [cc, setCc] = useState(seed.cc ?? "");
    const [subject, setSubject] = useState(seed.subject ?? "");
    const [html, setHtml] = useState(seed.html ?? "");
    const [profile, setProfile] = useState(seed.profile ?? defaultProfile ?? "plain");
    const [params, setParams] = useState<Record<string, string>>(seed.params ?? {});
    const [files, setFiles] = useState<File[]>([]);
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Attachments are per-session only (File objects don't serialise); the rest is the persisted draft.
    useEffect(() => {
        if (persist) {
            saveDraft({ from, to, cc, subject, html, profile, params });
        }
    }, [persist, from, to, cc, subject, html, profile, params]);

    const spec = forwardProfileById(profile);
    const setParam = (key: string, value: string) => setParams(current => ({ ...current, [key]: value }));

    const onSend = async () => {
        setError(null);

        if (!from.trim() || !to.trim()) {
            setError("From and To are required.");

            return;
        }

        const missing = spec?.params.find(param => param.required && !(params[param.key] ?? "").trim());

        if (missing) {
            setError(`${spec?.label} needs "${missing.label}".`);

            return;
        }

        setSending(true);

        try {
            await sendNew({ from: from.trim(), to: to.trim(), cc: cc.trim() || undefined, subject, html, attachments: files, profile, params });
            onClose();
        } catch (sendError) {
            setError((sendError as Error).message);
        } finally {
            setSending(false);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal" onClick={event => event.stopPropagation()}>
                <h2>New message</h2>
                <label>
                    From (original sender)
                    <input value={from} onChange={event => setFrom(event.target.value)} placeholder="someone@example.com" />
                </label>
                <label>
                    To (delivered inbox)
                    <input value={to} onChange={event => setTo(event.target.value)} placeholder="inbox@your-app.example" />
                </label>
                <label>
                    Cc
                    <input value={cc} onChange={event => setCc(event.target.value)} placeholder="optional" />
                </label>
                <label>
                    Subject
                    <input value={subject} onChange={event => setSubject(event.target.value)} />
                </label>
                <label>
                    Forward style
                    <select value={profile} onChange={event => setProfile(event.target.value)}>
                        {FORWARD_PROFILES.map(option => (
                            <option key={option.id} value={option.id}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
                {spec && spec.category !== "plain" && <p className="profile-hint">{spec.description}</p>}
                {spec?.params.map(param => (
                    <label key={param.key}>
                        {param.label}
                        {param.required ? " *" : ""}
                        <input
                            value={params[param.key] ?? ""}
                            placeholder={param.placeholder}
                            onChange={event => setParam(param.key, event.target.value)}
                        />
                    </label>
                ))}
                <Editor value={html} onChange={setHtml} placeholder="Write your message..." />
                <AttachmentPicker files={files} onChange={setFiles} />
                <div className="modal-actions">
                    <button type="button" className="secondary" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" disabled={sending} onClick={onSend}>
                        {sending ? "Sending..." : "Send"}
                    </button>
                    {error && <span className="status">{error}</span>}
                </div>
            </div>
        </div>
    );
};
