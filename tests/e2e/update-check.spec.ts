import { createServer } from "node:http";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compareSemver, notifyIfNewer, refreshCache } from "../../src/server/update-check";
import { expect, test } from "./fixtures";

const CACHE_FILE = "version-check.json";

const runWithEnv = async (overrides: Record<string, string | undefined>, fn: () => void | Promise<void>): Promise<void> => {
    const saved: Record<string, string | undefined> = {};

    for (const [key, value] of Object.entries(overrides)) {
        saved[key] = process.env[key];

        if (value === undefined) {
            delete process.env[key];
        } else {
            process.env[key] = value;
        }
    }

    try {
        await fn();
    } finally {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }
    }
};

const captureStderr = async (fn: () => void | Promise<void>): Promise<string> => {
    const original = process.stderr.write.bind(process.stderr);
    let out = "";
    process.stderr.write = ((chunk: unknown) => {
        out += String(chunk);

        return true;
    }) as typeof process.stderr.write;

    try {
        await fn();
    } finally {
        process.stderr.write = original;
    }

    return out;
};

const registryServing = async (version: unknown): Promise<{ url: string; close: () => void }> => {
    const server = createServer((_request, response) => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ version }));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;

    return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
};

test("compareSemver orders releases and bails out on pre-releases", () => {
    expect(compareSemver("0.2.0", "0.1.0")).toBe(1);
    expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    expect(compareSemver("1.2.0-rc.1", "1.1.0"), "a pre-release never triggers a nag").toBe(0);
    expect(compareSemver("not-semver", "1.0.0")).toBe(0);
});

test("notifyIfNewer prints a one-line notice only when the cache is ahead of the install", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postloop-uc-"));

    try {
        writeFileSync(join(dir, CACHE_FILE), JSON.stringify({ latest: "0.2.0", checked_at: new Date().toISOString() }));

        const behind = await captureStderr(() =>
            runWithEnv({ POSTLOOP_CACHE_DIR: dir, POSTLOOP_FORCE_UPDATE_CHECK: "1" }, () => notifyIfNewer("0.1.0")),
        );
        expect(behind).toContain("[postloop]");
        expect(behind).toContain("0.1.0 → 0.2.0");

        const current = await captureStderr(() =>
            runWithEnv({ POSTLOOP_CACHE_DIR: dir, POSTLOOP_FORCE_UPDATE_CHECK: "1" }, () => notifyIfNewer("9.9.9")),
        );
        expect(current, "an up-to-date install is silent").toBe("");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("notifyIfNewer stays silent when suppressed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "postloop-uc-"));

    try {
        writeFileSync(join(dir, CACHE_FILE), JSON.stringify({ latest: "9.9.9", checked_at: new Date().toISOString() }));

        const out = await captureStderr(() =>
            runWithEnv(
                { POSTLOOP_CACHE_DIR: dir, POSTLOOP_FORCE_UPDATE_CHECK: undefined, POSTLOOP_NO_UPDATE_CHECK: "1" },
                () => notifyIfNewer("0.1.0"),
            ),
        );
        expect(out).toBe("");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("refreshCache caches a valid registry version and rejects a malformed one", async () => {
    const good = await registryServing("9.9.9");
    const goodDir = mkdtempSync(join(tmpdir(), "postloop-uc-"));

    try {
        await runWithEnv({ POSTLOOP_CACHE_DIR: goodDir, POSTLOOP_REGISTRY_URL: good.url }, () => refreshCache());
        const cached = JSON.parse(readFileSync(join(goodDir, CACHE_FILE), "utf-8")) as { latest: string };
        expect(cached.latest).toBe("9.9.9");
    } finally {
        good.close();
        rmSync(goodDir, { recursive: true, force: true });
    }

    const bad = await registryServing("not a version; rm -rf /");
    const badDir = mkdtempSync(join(tmpdir(), "postloop-uc-"));

    try {
        await runWithEnv({ POSTLOOP_CACHE_DIR: badDir, POSTLOOP_REGISTRY_URL: bad.url }, () => refreshCache());
        expect(existsSync(join(badDir, CACHE_FILE)), "a non-semver payload never touches disk").toBe(false);
    } finally {
        bad.close();
        rmSync(badDir, { recursive: true, force: true });
    }
});
