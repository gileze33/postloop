import { rmSync } from "node:fs";

// Remove the throwaway DATA_DIR the run stored its caught mail under (path handed over by the config).
export default function globalTeardown(): void {
    const dataDir = process.env.POSTLOOP_E2E_DATA_DIR;

    if (dataDir) {
        rmSync(dataDir, { recursive: true, force: true });
    }
}
