import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// The version comes off the package's own package.json rather than a build-time
// constant, so a bug report names the build that is actually installed. At runtime
// import.meta.url is <pkg>/dist/index.js and under vitest it is <pkg>/src/version.ts, so
// `../package.json` resolves to <pkg>/package.json either way. That depth is load-bearing:
// this file cannot move under `src/lib/` without breaking the source-mode path, because
// tsup bundles the whole CLI into the single flat `dist/index.js`.
//
// It lives here rather than in `cli.ts` because `commands/add.ts` needs it for the
// `requires.saasaloy` check (#50), and `cli.ts` already imports `commands/index.ts` —
// reading it from there would close an import cycle.

/** What this returns when the CLI's own package.json is missing, unreadable, or version-less. */
export const UNKNOWN_VERSION = "unknown";

/** The running CLI's version, or `"unknown"` when its package.json will not parse. */
export async function readVersion(): Promise<string> {
  try {
    const file = fileURLToPath(new URL("../package.json", import.meta.url));
    const parsed = JSON.parse(await readFile(file, "utf-8")) as {
      version?: unknown;
    };
    return typeof parsed.version === "string"
      ? parsed.version
      : UNKNOWN_VERSION;
  } catch {
    // A missing or unreadable package.json is not worth failing `--version` over.
    return UNKNOWN_VERSION;
  }
}
