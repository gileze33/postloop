/** Forwarding-profile metadata, shared by the server (which builds the .eml) and the UI (which renders
 * the "Forward style" selector and its per-profile fields). The build logic lives server-side. */

export type ForwardCategory = "plain" | "list-rewrite" | "body-forward";

export interface ForwardParamSpec {
    key: string;
    label: string;
    placeholder?: string;
    required?: boolean;
}

export interface ForwardProfileSpec {
    id: string;
    label: string;
    category: ForwardCategory;
    /** Where the true original sender ends up, so the tester knows what the pipeline must recover. */
    description: string;
    params: ForwardParamSpec[];
}

export const FORWARD_PROFILES: ForwardProfileSpec[] = [
    {
        id: "plain",
        label: "Plain (no wrapping)",
        category: "plain",
        description: "Sent as-is. From is the original sender.",
        params: [],
    },
    {
        id: "google-groups",
        label: "Google Groups (distribution list)",
        category: "list-rewrite",
        description: "From is rewritten to \"'Name' via Group\"; the real sender is in X-Original-From / Reply-To; List-* headers added.",
        params: [
            { key: "groupAddress", label: "Group address", placeholder: "group@company.com", required: true },
            { key: "groupName", label: "Group name", placeholder: "Partner Integrations" },
        ],
    },
    {
        id: "gmail-forward",
        label: "Gmail forward",
        category: "body-forward",
        description: "Manual Gmail forward: From is the forwarder, the original is quoted in the body block.",
        params: [{ key: "forwarderAddress", label: "Forwarded by", placeholder: "fred@gmail.com", required: true }],
    },
    {
        id: "outlook-forward",
        label: "Outlook forward (new / OWA)",
        category: "body-forward",
        description: "Manual Outlook forward: From is the forwarder, the original is in a divRplyFwdMsg block.",
        params: [{ key: "forwarderAddress", label: "Forwarded by", placeholder: "fred@company.com", required: true }],
    },
];

export const forwardProfileById = (id: string): ForwardProfileSpec | undefined =>
    FORWARD_PROFILES.find(profile => profile.id === id);
