import { SMTPServer } from "smtp-server";
import { saveMessage } from "./store";

/**
 * The mail sink: an SMTP server the app under test points its outbound transport at. Each received
 * message is stored under every envelope recipient it was sent to.
 */
export const startSmtpServer = (port: number, onReady?: () => void): SMTPServer => {
    const server = new SMTPServer({
        authOptional: true,
        disabledCommands: ["AUTH", "STARTTLS"],
        onData(stream, session, callback) {
            const chunks: Buffer[] = [];

            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
                const recipients = session.envelope.rcptTo.map(recipient => recipient.address);

                saveMessage(Buffer.concat(chunks), recipients)
                    .then(() => callback())
                    .catch((err: Error) => callback(err));
            });
            stream.on("error", (err: Error) => callback(err));
        },
    });

    server.on("error", err => console.error("[postloop] SMTP error:", err.message));
    server.listen(port, "127.0.0.1", onReady);

    return server;
};
