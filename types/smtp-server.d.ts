// Minimal ambient declaration for the slice of `smtp-server` Postloop uses, so the server type-checks
// without depending on a published @types package. Widen as we use more of the API.
declare module "smtp-server" {
    import type { Readable } from "stream";

    export interface SMTPServerAddress {
        address: string;
        args: Record<string, string | boolean>;
    }

    export interface SMTPServerSession {
        id: string;
        remoteAddress: string;
        envelope: {
            mailFrom: SMTPServerAddress | false;
            rcptTo: SMTPServerAddress[];
        };
    }

    export interface SMTPServerOptions {
        authOptional?: boolean;
        disabledCommands?: string[];
        hideSTARTTLS?: boolean;
        onData?: (
            stream: Readable,
            session: SMTPServerSession,
            callback: (err?: Error | null) => void,
        ) => void;
    }

    export class SMTPServer {
        constructor(options?: SMTPServerOptions);
        listen(port?: number, hostname?: string, callback?: () => void): void;
        close(callback?: () => void): void;
        on(event: "error", listener: (err: Error) => void): this;
    }
}
