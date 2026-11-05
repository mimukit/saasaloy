import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findLockfile, restartOnLockfile } from "./restart-on-lockfile.ts";

// The plugin runs against a stand-in for the Vite dev server: a watcher that records
// `add()` and emits events, a `restart()` spy, and a logger.

let root = "";

function fakeServer(configRoot: string) {
  // oxlint-disable-next-line unicorn/prefer-event-target -- Vite's watcher is a chokidar FSWatcher, which is a Node EventEmitter.
  const watcher = Object.assign(new EventEmitter(), {
    add: vi.fn<(file: string) => void>(),
  });
  return {
    config: {
      root: configRoot,
      logger: { info: vi.fn<(message: string) => void>() },
    },
    watcher,
    restart: vi.fn<() => Promise<void>>(async () => {
      // Restarted.
    }),
  };
}

function start(server: ReturnType<typeof fakeServer>): void {
  const plugin = restartOnLockfile();
  const hook = plugin.configureServer as (server: unknown) => void;
  hook(server);
}

describe(findLockfile, () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "restart-on-lockfile-"));
    mkdirSync(path.join(root, "apps", "admin"), { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("walks up to the lockfile at the repo root", () => {
    writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
    expect(findLockfile(path.join(root, "apps", "admin"))).toBe(
      path.join(root, "pnpm-lock.yaml")
    );
  });

  it("finds nothing outside a pnpm repo", () => {
    expect(findLockfile(path.join(root, "apps", "admin"))).toBeUndefined();
  });
});

describe(restartOnLockfile, () => {
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "restart-on-lockfile-"));
    mkdirSync(path.join(root, "apps", "admin"), { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(root, { recursive: true, force: true });
  });

  it("runs on the dev server only", () => {
    const plugin = restartOnLockfile();
    expect(plugin.name).toBe("saasaloy-restart-on-lockfile");
    expect(plugin.apply).toBe("serve");
  });

  it("watches the lockfile and restarts once after a burst of changes", () => {
    vi.useFakeTimers();
    const lockfile = path.join(root, "pnpm-lock.yaml");
    writeFileSync(lockfile, "");
    const server = fakeServer(path.join(root, "apps", "admin"));
    start(server);

    expect(server.watcher.add).toHaveBeenCalledWith(lockfile);
    server.watcher.emit("change", lockfile);
    server.watcher.emit("add", lockfile);
    server.watcher.emit("change", lockfile);
    vi.advanceTimersByTime(299);
    expect(server.restart).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(server.restart).toHaveBeenCalledOnce();
    expect(server.config.logger.info).toHaveBeenCalledOnce();
    expect(server.config.logger.info.mock.calls[0]?.[0]).toContain(
      "pnpm-lock.yaml"
    );
  });

  it("ignores every other file", () => {
    vi.useFakeTimers();
    writeFileSync(path.join(root, "pnpm-lock.yaml"), "");
    const server = fakeServer(path.join(root, "apps", "admin"));
    start(server);

    server.watcher.emit("change", path.join(root, "apps", "admin", "x.ts"));
    server.watcher.emit("change", path.join(root, "other", "pnpm-lock.yaml"));
    vi.advanceTimersByTime(1000);
    expect(server.restart).not.toHaveBeenCalled();
  });

  it("does nothing without a lockfile", () => {
    const server = fakeServer(path.join(root, "apps", "admin"));
    start(server);
    expect(server.watcher.add).not.toHaveBeenCalled();
  });
});
