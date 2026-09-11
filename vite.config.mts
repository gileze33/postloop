import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The server (Fastify) serves the built assets from dist/web. Dev runs `vite build --watch` alongside a
// tsx-watched server, so this is a static build config; the proxy only matters if you run `vite` directly.
export default defineConfig({
    plugins: [react()],
    build: {
        outDir: "dist/web",
        emptyOutDir: true,
    },
    server: {
        proxy: {
            "/api": "http://localhost:8025",
        },
    },
});
