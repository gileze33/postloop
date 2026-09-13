// Notify-only version check, modelled on multree's. The current run never blocks on the network: it
// prints a one-line notice from a small cache file (written by a previous run), then refreshes that cache
// in the background for next time. Postloop's server is long-lived, so the refresh runs in-process rather
// than in a detached child (multree needs the child because its CLI exits before a fetch would finish).
//
// Source of truth: the npm registry (`registry.npmjs.org/postloop/latest`).
//
// Suppression: `CI`, no stderr TTY, or `POSTLOOP_NO_UPDATE_CHECK=1`. Tests force it on with
// `POSTLOOP_FORCE_UPDATE_CHECK=1`, override the cache dir with `POSTLOOP_CACHE_DIR`, and point the fetch
// at a local server with `POSTLOOP_REGISTRY_URL`.

import { mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export const PACKAGE_NAME = "postloop";
const DEFAULT_REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const CACHE_FILENAME = "version-check.json";

// Strict semver shape: digit-only major/minor/patch with optional pre-release / build-metadata tags.
// Anything else (whitespace, control chars, path separators, ANSI escapes) is refused at the network
// boundary so it can never reach the cache file, the user's terminal, or disk.
const SEMVER_RE = /^\d{1,9}\.\d{1,9}\.\d{1,9}(?:-[A-Za-z0-9.-]+)?(?:\+[A-Za-z0-9.-]+)?$/;

interface VersionCache {
    latest: string;
    checked_at: string;
}

const registryUrl = (): string => process.env.POSTLOOP_REGISTRY_URL ?? DEFAULT_REGISTRY_URL;

const cacheDir = (): string => {
    if (process.env.POSTLOOP_CACHE_DIR) {
        return process.env.POSTLOOP_CACHE_DIR;
    }

    const base = process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache");

    return join(base, PACKAGE_NAME);
};

const cacheFile = (): string => join(cacheDir(), CACHE_FILENAME);

const readCache = (): VersionCache | null => {
    try {
        const parsed = JSON.parse(readFileSync(cacheFile(), "utf-8")) as Partial<VersionCache>;

        if (typeof parsed.latest !== "string" || typeof parsed.checked_at !== "string") {
            return null;
        }

        return { latest: parsed.latest, checked_at: parsed.checked_at };
    } catch {
        return null;
    }
};

const writeCache = (cache: VersionCache): void => {
    try {
        mkdirSync(cacheDir(), { recursive: true });
        writeFileSync(cacheFile(), JSON.stringify(cache, null, 2));
    } catch {
        // Best effort; never let cache failures break the server.
    }
};

const envTruthy = (name: string): boolean => {
    const value = process.env[name];

    return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
};

const checkSuppressed = (): boolean => {
    if (envTruthy("POSTLOOP_FORCE_UPDATE_CHECK")) {
        return false;
    }

    return envTruthy("POSTLOOP_NO_UPDATE_CHECK") || envTruthy("CI") || !process.stderr.isTTY;
};

// Compare two semver-ish strings. Returns 1 if a>b, -1 if a<b, 0 otherwise. Pre-release tags bail out
// (return 0): don't nag a stable install about an `-rc` on latest, nor a pre-release install about a
// stable "downgrade".
export const compareSemver = (a: string, b: string): number => {
    const pa = a.replace(/^v/, "");
    const pb = b.replace(/^v/, "");

    if (pa.includes("-") || pb.includes("-")) {
        return 0;
    }

    const sa = pa.split(".");
    const sb = pb.split(".");

    if (sa.length !== 3 || sb.length !== 3) {
        return 0;
    }

    for (let i = 0; i < 3; i++) {
        const av = Number(sa[i]);
        const bv = Number(sb[i]);

        if (!Number.isInteger(av) || !Number.isInteger(bv) || av < 0 || bv < 0) {
            return 0;
        }

        if (av > bv) {
            return 1;
        }

        if (av < bv) {
            return -1;
        }
    }

    return 0;
};

export type InstallKind = "npx" | "npm" | "pnpm" | "yarn" | "bun";

const UPGRADE_COMMAND: Record<InstallKind, string> = {
    npx: `npx ${PACKAGE_NAME}@latest`,
    npm: `npm i -g ${PACKAGE_NAME}@latest`,
    pnpm: `pnpm add -g ${PACKAGE_NAME}@latest`,
    yarn: `yarn global add ${PACKAGE_NAME}@latest`,
    bun: `bun add -g ${PACKAGE_NAME}@latest`,
};

// Infer how this copy was launched from the path it resolves to, so the hint matches how the user runs
// it. npx unpacks into an `_npx/` cache; global installs each carry a distinctive store segment. Anything
// else falls back to npm. Only ever used to tailor the hint, so a wrong guess is cosmetic.
export const detectInstall = (modulePath: string): InstallKind => {
    const path = modulePath.replace(/\\/g, "/");

    if (/\/_npx\//.test(path)) {
        return "npx";
    }

    if (/\/\.?pnpm\//.test(path)) {
        return "pnpm";
    }

    if (/\/\.bun\//.test(path)) {
        return "bun";
    }

    if (/\/\.?yarn\//.test(path)) {
        return "yarn";
    }

    return "npm";
};

const upgradeCommand = (): string => UPGRADE_COMMAND[detectInstall(__dirname)];

const readInstalledVersion = (): string | null => {
    try {
        const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8")) as {
            version?: unknown;
        };

        return typeof pkg.version === "string" ? pkg.version : null;
    } catch {
        return null;
    }
};

// Read the cache and print a one-line notice if a newer version is available. Never throws.
export const notifyIfNewer = (installed: string): void => {
    if (checkSuppressed()) {
        return;
    }

    const cache = readCache();

    if (!cache || compareSemver(cache.latest, installed) <= 0) {
        return;
    }

    const useColor = process.stderr.isTTY && !envTruthy("NO_COLOR");
    const tag = useColor ? "\x1b[33m[postloop]\x1b[0m" : "[postloop]";
    process.stderr.write(
        `${tag} new version available: ${installed} → ${cache.latest} (run: ${upgradeCommand()})\n`,
    );
};

// Fetch the registry with a short timeout and update the cache. Never throws.
export const refreshCache = async (): Promise<void> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(registryUrl(), { signal: controller.signal, headers: { accept: "application/json" } });

        if (!res.ok) {
            return;
        }

        const data = (await res.json()) as { version?: unknown };

        // Validate against a strict semver shape before the value touches the filesystem or the terminal.
        // The registry is trusted in practice, but treating its payload as untrusted network data is cheap
        // insurance against a compromised mirror, a MITM, or a typosquatted POSTLOOP_REGISTRY_URL.
        if (typeof data.version === "string" && SEMVER_RE.test(data.version)) {
            writeCache({ latest: data.version, checked_at: new Date().toISOString() });
        }
    } catch {
        // Offline, registry down, abort — all benign. Try again next run.
    } finally {
        clearTimeout(timer);
    }
};

// Refresh the cache in the background when it is missing or stale, without blocking the caller.
const kickBackgroundRefresh = (): void => {
    if (checkSuppressed()) {
        return;
    }

    const cache = readCache();

    if (cache) {
        const age = Date.now() - new Date(cache.checked_at).getTime();

        if (Number.isFinite(age) && age >= 0 && age < CHECK_INTERVAL_MS) {
            return;
        }
    }

    void refreshCache();
};

// Startup entry point: notice from cache now, refresh for next time. Never throws, never blocks.
export const checkForUpdates = (): void => {
    const installed = readInstalledVersion();

    if (!installed) {
        return;
    }

    notifyIfNewer(installed);
    kickBackgroundRefresh();
};
