import { existsSync } from "fs";
import { join } from "path";
import fastifyMultipart from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { getConfig } from "./config";
import { registerMcpRoute } from "./mcp";
import { registerApiRoutes } from "./routes";
import { startSmtpServer } from "./smtp";
import { checkForUpdates } from "./update-check";

const resolveWebDir = (): string | null => {
    const candidates = [
        process.env.POSTLOOP_WEB_DIR,
        join(__dirname, "../web"), // dist/server/index.js -> dist/web (packaged/prod)
        join(process.cwd(), "dist/web"), // dev, where `vite build --watch` writes
    ].filter((candidate): candidate is string => Boolean(candidate));

    // Require a built index.html so we skip the source src/web dir, which exists under tsx-run dev
    // (__dirname is src/server there) but holds no build output.
    return candidates.find(dir => existsSync(join(dir, "index.html"))) ?? null;
};

const start = async (): Promise<void> => {
    const config = getConfig();
    const app = Fastify({ logger: true });

    await app.register(fastifyMultipart, { limits: { fileSize: 26214400, files: 20 } });
    registerApiRoutes(app);
    registerMcpRoute(app);

    const webDir = resolveWebDir();

    if (webDir) {
        await app.register(fastifyStatic, { root: webDir });
        app.setNotFoundHandler((request, reply) => {
            if (request.method === "GET" && !request.url.startsWith("/api")) {
                return reply.sendFile("index.html");
            }

            return reply.code(404).send({ message: "not found" });
        });
    } else {
        app.log.warn("No built UI found (run `npm run build:web`); serving the API only.");
    }

    await app.listen({ port: config.port, host: "127.0.0.1" });
    startSmtpServer(config.smtpPort, () => app.log.info(`SMTP sink listening on 127.0.0.1:${config.smtpPort}`));
    if (config.outboundUrl) {
        app.log.info(`Replies POST to ${config.outboundUrl}`);
    } else {
        app.log.warn("Replies disabled: set OUTBOUND_URL to your app's inbound endpoint to enable them.");
    }

    app.log.info(`Storing mail under ${config.dataDir}`);
    app.log.info(`MCP endpoint for AI agents at http://127.0.0.1:${config.port}/mcp`);

    checkForUpdates();
};

start().catch(err => {
    console.error(err);
    process.exit(1);
});
