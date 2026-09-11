import { join } from "path";
import { forwardProfileById } from "../shared/forwardingProfiles";

export interface PostloopConfig {
    /** HTTP port serving the UI and JSON API. */
    port: number;
    /** SMTP port the sink listens on; the app under test points its outbound transport here. */
    smtpPort: number;
    /** Where composed replies are POSTed as raw `.eml`. Null disables replies until OUTBOUND_URL is set. */
    outboundUrl: string | null;
    /** Root of the filesystem store: data/{received-address}/{timestamp}.eml. */
    dataDir: string;
    /** Default forward-wrapper profile id; the UI pre-selects it and sends use it when none is given. */
    defaultForwardProfile: string;
}

let cached: PostloopConfig | null = null;

const resolveDefaultForwardProfile = (): string => {
    const requested = process.env.DEFAULT_FORWARD_PROFILE;

    if (!requested) {
        return "plain";
    }

    if (!forwardProfileById(requested)) {
        console.warn(`[postloop] Unknown DEFAULT_FORWARD_PROFILE "${requested}"; falling back to "plain".`);

        return "plain";
    }

    return requested;
};

export const getConfig = (): PostloopConfig => {
    if (cached) {
        return cached;
    }

    cached = {
        port: Number(process.env.PORT ?? 8025),
        smtpPort: Number(process.env.SMTP_PORT ?? 1025),
        outboundUrl: process.env.OUTBOUND_URL || null,
        dataDir: process.env.DATA_DIR ?? join(process.cwd(), "data"),
        defaultForwardProfile: resolveDefaultForwardProfile(),
    };

    return cached;
};
