import { existsSync } from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

// Restart the dev server when `pnpm-lock.yaml` changes, which is every install.
//
// Vite 8's dev resolver caches a bare import it failed to resolve, and only a watcher
// event clears that cache. The watcher ignores `node_modules`, so installing the missing
// package never clears it: every reload still shows "Failed to resolve import" until the
// server restarts. In vite 8.3.1 the cache is on whenever the watcher is
// (`disableCache: command === "serve" && server.watch === null` in `oxcResolvePlugin`).
// `server.watch: null` turns it off, and HMR with it, so the fix is a restart instead.
// The lockfile changes on every `pnpm add`, `remove` and `install` in any workspace.
//
// Not for `astro dev`: Astro keeps its own handlers on the Vite watcher, and a bare
// `server.restart()` swaps the watcher out from under them.

const LOCKFILE = "pnpm-lock.yaml";
const DEBOUNCE_MS = 300;

/** The nearest `pnpm-lock.yaml` at or above `dir`, or undefined. */
export function findLockfile(dir: string): string | undefined {
  for (let current = path.resolve(dir); ; current = path.dirname(current)) {
    const file = path.join(current, LOCKFILE);
    if (existsSync(file)) {
      return file;
    }
    if (path.dirname(current) === current) {
      return undefined;
    }
  }
}

/** Restart the dev server after an install. Dev only. */
export function restartOnLockfile(): Plugin {
  return {
    name: "saasaloy-restart-on-lockfile",
    apply: "serve",
    configureServer(server) {
      const lockfile = findLockfile(server.config.root);
      if (lockfile === undefined) {
        return;
      }
      server.watcher.add(lockfile);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onEvent = (file: string) => {
        if (path.resolve(file) !== lockfile) {
          return;
        }
        // An install writes the lockfile more than once. One restart covers them all.
        clearTimeout(timer);
        timer = setTimeout(() => {
          server.config.logger.info(
            `${LOCKFILE} changed, restarting so new packages resolve.`,
            { timestamp: true }
          );
          server.restart().catch((error: unknown) => {
            server.config.logger.error(`restart failed: ${String(error)}`, {
              timestamp: true,
            });
          });
        }, DEBOUNCE_MS);
      };
      server.watcher.on("change", onEvent);
      server.watcher.on("add", onEvent);
    },
  };
}
