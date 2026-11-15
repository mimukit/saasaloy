import { describe, expect, it } from "vitest";
import {
  inCheckout,
  isDevProcess,
  parseLsofCwd,
  parseLsofListeners,
  parseProcNetTcp,
  parseProcStat,
  parsePs,
  portsToStop,
  selectTargets,
} from "./dev-stop.ts";
import type { ProcInfo } from "./dev-stop.ts";

const ROOT = "/w/shop";

function proc(
  pid: number,
  ppid: number,
  name: string,
  cwd: string | undefined,
  args = name
): ProcInfo {
  return { pid, ppid, name, args, cwd };
}

describe(inCheckout, () => {
  const none = () => false;

  it("takes the root and a folder below it", () => {
    expect(inCheckout(ROOT, ROOT, none)).toBeTruthy();
    expect(inCheckout(`${ROOT}/apps/web`, ROOT, none)).toBeTruthy();
  });

  it("refuses a sibling whose name starts with the root's", () => {
    expect(inCheckout("/w/shop-2/apps/web", ROOT, none)).toBeFalsy();
    expect(inCheckout("/w", ROOT, none)).toBeFalsy();
  });

  it("refuses a folder under another checkout nested inside this one", () => {
    const foreign = (dir: string) => dir === `${ROOT}/.dev/playground`;
    expect(
      inCheckout(`${ROOT}/.dev/playground/apps/web`, ROOT, foreign)
    ).toBeFalsy();
    expect(inCheckout(`${ROOT}/.dev/playground`, ROOT, foreign)).toBeFalsy();
    expect(inCheckout(`${ROOT}/.dev`, ROOT, foreign)).toBeTruthy();
  });

  it("never asks about the root itself", () => {
    expect(
      inCheckout(`${ROOT}/apps`, ROOT, (dir) => dir === ROOT)
    ).toBeTruthy();
  });

  it("refuses an unknown cwd", () => {
    expect(inCheckout(undefined, ROOT, none)).toBeFalsy();
  });
});

describe(isDevProcess, () => {
  it("takes the dev binaries by name", () => {
    expect(isDevProcess(proc(1, 0, "turbo", ROOT))).toBeTruthy();
    expect(isDevProcess(proc(1, 0, "workerd", ROOT))).toBeTruthy();
    expect(isDevProcess(proc(1, 0, "esbuild", ROOT))).toBeTruthy();
  });

  it("takes node running a dev server", () => {
    const vite =
      "node /w/shop/node_modules/.bin/../vite/bin/vite.js dev --host";
    const astro = "node /w/shop/node_modules/astro/astro.js dev";
    const pnpm = "node /usr/lib/pnpm/bin/pnpm.cjs dev";
    expect(isDevProcess(proc(1, 0, "node", ROOT, vite))).toBeTruthy();
    expect(isDevProcess(proc(1, 0, "node", ROOT, astro))).toBeTruthy();
    expect(isDevProcess(proc(1, 0, "node", ROOT, pnpm))).toBeTruthy();
  });

  it("leaves an editor, a shell, a type server and a test watcher alone", () => {
    const tsserver = "node /w/shop/node_modules/typescript/lib/tsserver.js";
    const vitest = "node /w/shop/node_modules/vitest/vitest.mjs";
    expect(isDevProcess(proc(1, 0, "node", ROOT, tsserver))).toBeFalsy();
    expect(isDevProcess(proc(1, 0, "node", ROOT, vitest))).toBeFalsy();
    expect(isDevProcess(proc(1, 0, "zsh", ROOT, "-zsh"))).toBeFalsy();
    expect(
      isDevProcess(proc(1, 0, "nvim", ROOT, "nvim vite.config.ts"))
    ).toBeFalsy();
  });
});

describe(selectTargets, () => {
  // 1 init, 10 a shell in the checkout, 11 `pnpm dev`, 12 turbo, 13 the web pnpm,
  // 14 astro, 15 workerd whose cwd is outside, 20 the shell running dev:stop, 21 its pnpm,
  // 22 dev:stop itself, 30 another worktree's turbo, 31 its vite.
  const procs: ProcInfo[] = [
    proc(1, 0, "init", "/"),
    proc(10, 1, "zsh", ROOT, "-zsh"),
    proc(11, 10, "node", ROOT, "node /usr/bin/pnpm dev"),
    proc(12, 11, "turbo", ROOT, "turbo run dev"),
    proc(13, 12, "node", `${ROOT}/apps/web`, "node /usr/bin/pnpm run dev"),
    proc(14, 13, "node", `${ROOT}/apps/web`, "node astro.js dev"),
    proc(15, 14, "workerd", "/tmp/miniflare", "workerd serve"),
    proc(20, 1, "zsh", ROOT, "-zsh"),
    proc(21, 20, "node", ROOT, "node /usr/bin/pnpm dev:stop"),
    proc(22, 21, "node", ROOT, "node packages/tooling/src/dev-stop.ts"),
    proc(30, 1, "turbo", "/w/shop-2", "turbo run dev"),
    proc(31, 30, "node", "/w/shop-2/apps/web", "node vite.js dev"),
  ];

  function pids(targets: ProcInfo[]): number[] {
    return targets.map((target) => target.pid);
  }

  it("takes this checkout's dev tree and its children outside the checkout", () => {
    const targets = selectTargets({
      procs,
      root: ROOT,
      self: 22,
      listeners: [],
      isForeign: () => false,
    });
    expect(pids(targets)).toStrictEqual([11, 12, 13, 14, 15]);
  });

  it("never takes itself or an ancestor, even one that looks like a dev process", () => {
    const targets = selectTargets({
      procs: [...procs, proc(23, 22, "node", ROOT, "node vite.js dev")],
      root: ROOT,
      self: 22,
      listeners: [],
      isForeign: () => false,
    });
    expect(pids(targets)).not.toContain(20);
    expect(pids(targets)).not.toContain(21);
    expect(pids(targets)).not.toContain(22);
    expect(pids(targets)).not.toContain(23);
  });

  it("leaves a worktree nested inside the checkout alone", () => {
    const nested = `${ROOT}/.claude/worktrees/fix`;
    const targets = selectTargets({
      procs: [
        ...procs,
        proc(40, 1, "turbo", nested, "turbo run dev"),
        proc(41, 40, "node", `${nested}/apps/web`, "node vite.js dev"),
      ],
      root: ROOT,
      self: 22,
      listeners: [],
      isForeign: (dir) => dir === nested,
    });
    expect(pids(targets)).toStrictEqual([11, 12, 13, 14, 15]);
  });

  it("takes a port listener of any name when its cwd is inside", () => {
    const targets = selectTargets({
      procs: [
        proc(1, 0, "init", "/"),
        proc(50, 1, "bun", `${ROOT}/apps/api`, "bun x"),
      ],
      root: ROOT,
      self: 99,
      listeners: [50],
      isForeign: () => false,
    });
    expect(pids(targets)).toStrictEqual([50]);
  });

  it("leaves a port listener whose cwd is outside the checkout", () => {
    const targets = selectTargets({
      procs,
      root: ROOT,
      self: 22,
      listeners: [31],
      isForeign: () => false,
    });
    expect(pids(targets)).not.toContain(31);
  });

  it("finds nothing when nothing runs", () => {
    const targets = selectTargets({
      procs: [proc(1, 0, "init", "/"), proc(22, 1, "node", ROOT)],
      root: ROOT,
      self: 22,
      listeners: [],
      isForeign: () => false,
    });
    expect(targets).toStrictEqual([]);
  });
});

describe(portsToStop, () => {
  it("reads the record's services", () => {
    const record = JSON.stringify({
      block: 367,
      host: "localhost",
      cookiePrefix: "wt5ddad8",
      services: { web: 13_670, api: 13_675 },
    });
    expect(portsToStop(record, [3000, 4000])).toStrictEqual([13_670, 13_675]);
  });

  it("falls back to the pinned ports with no record or a bad one", () => {
    expect(portsToStop(undefined, [3000, 4000])).toStrictEqual([3000, 4000]);
    expect(portsToStop("{", [3000])).toStrictEqual([3000]);
  });
});

describe("parsers", () => {
  it("reads the ppid and name from /proc/<pid>/stat, a name with spaces included", () => {
    expect(parseProcStat("123 (node) S 45 123 45 0 -1")).toStrictEqual({
      name: "node",
      ppid: 45,
    });
    expect(parseProcStat("9 (Web Content) R 2 9 9")).toStrictEqual({
      name: "Web Content",
      ppid: 2,
    });
    expect(parseProcStat("garbage")).toBeUndefined();
  });

  it("reads the listening ports and inodes from /proc/net/tcp", () => {
    const text = [
      "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
      "   0: 00000000:0BB8 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 4242 1 0000000000000000 100 0 0 10 0",
      "   1: 0100007F:0FA0 0100007F:A1B2 01 00000000:00000000 00:00000000 00000000  1000        0 4343 1 0000000000000000 100 0 0 10 0",
    ].join("\n");
    expect(parseProcNetTcp(text)).toStrictEqual([
      { port: 3000, inode: "4242" },
    ]);
  });

  it("reads ps output", () => {
    const text = "  1     0 /sbin/launchd\n 77     1 node /x/vite.js dev\n";
    expect(parsePs(text)).toStrictEqual([
      { pid: 1, ppid: 0, name: "launchd", args: "/sbin/launchd" },
      { pid: 77, ppid: 1, name: "node", args: "node /x/vite.js dev" },
    ]);
  });

  it("reads lsof cwd output", () => {
    const text = "p77\nfcwd\nn/w/shop/apps/web\np78\nfcwd\nn/\n";
    expect(parseLsofCwd(text)).toStrictEqual(
      new Map([
        [77, "/w/shop/apps/web"],
        [78, "/"],
      ])
    );
  });

  it("reads lsof listener output", () => {
    const text =
      "p77\nf21\nn*:3000\nf22\nn[::1]:3001\np78\nf5\nn127.0.0.1:4000\n";
    expect(parseLsofListeners(text)).toStrictEqual([
      { pid: 77, port: 3000 },
      { pid: 77, port: 3001 },
      { pid: 78, port: 4000 },
    ]);
  });
});
