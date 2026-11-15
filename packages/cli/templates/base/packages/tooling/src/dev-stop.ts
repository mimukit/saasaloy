// `pnpm dev:stop`: stop the `pnpm dev` servers of this checkout, and only this one.
//
// Several worktrees of one repo can run `pnpm dev` side by side. A plain `pkill node`
// stops all of them, and a Ctrl-C that never reached turbo leaves vite, astro or workerd
// holding a port. This command finds this checkout's processes two ways:
//
// 1. a process listening on one of this checkout's ports: the `services` in
//    `.devports.json`, which `pnpm dev:ports` writes, or the pinned ports without one;
// 2. a dev process (turbo, workerd, esbuild, or node running vite, astro, wrangler,
//    email or `pnpm dev`) whose working directory is inside the checkout.
//
// Each match must have its cwd inside the checkout, and not inside another worktree or
// repo nested under it (`.dev/`, `.claude/worktrees/`). An editor, a shell or a type
// server sitting in the folder is not a dev process and is never matched. Then every
// descendant of a match goes too, whatever its cwd: workerd runs from a temp folder.
// This process and its ancestors are never stopped, which keeps `pnpm dev:stop` itself
// and the shell or agent that started it alive.
//
// The stop is SIGTERM, a wait of up to 5 s, then SIGKILL for what is left.
//
// Everything above the runner at the bottom is pure, and `dev-stop.test.ts` covers it.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  parseRecord,
  parseWorktreeList,
  RECORD_FILE,
} from "@repo/env/dev-ports";
import { SERVICES } from "@repo/env/services";

/** One process, as `/proc` or `ps` reports it. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  /** The executable's base name: `node`, `turbo`, `workerd`. */
  name: string;
  /** The whole command line, joined with spaces. */
  args: string;
  /** The working directory, or undefined when it cannot be read. */
  cwd: string | undefined;
}

const DEV_BINARIES = new Set(["turbo", "workerd", "esbuild"]);

// A node command line that runs a dev server. `\bvite\b` does not match `vitest`.
const DEV_ARGS =
  /(?:^|[\s/])(?:vite|astro|wrangler|turbo|email)(?:\.[cm]?js)?(?:\s|$)|\bpnpm(?:\.c?js)?\s+(?:run\s+)?dev(?:\s|$)/;

/** True for a process that `pnpm dev` starts. */
export function isDevProcess(proc: ProcInfo): boolean {
  return DEV_BINARIES.has(proc.name) || DEV_ARGS.test(proc.args);
}

function isWithin(file: string, dir: string): boolean {
  return (
    file === dir ||
    file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)
  );
}

/**
 * True when `cwd` is the checkout root or below it, and no folder between them is
 * another checkout (`isForeign`: a linked worktree, or a folder holding its own `.git`).
 */
export function inCheckout(
  cwd: string | undefined,
  root: string,
  isForeign: (dir: string) => boolean
): boolean {
  if (cwd === undefined || !isWithin(cwd, root)) {
    return false;
  }
  for (let dir = cwd; dir !== root; dir = path.dirname(dir)) {
    if (isForeign(dir)) {
      return false;
    }
  }
  return true;
}

/** The ports to look at: the record's services, or the pinned ones with no usable record. */
export function portsToStop(
  recordText: string | undefined,
  pinned: number[]
): number[] {
  const record = parseRecord(recordText);
  return record === undefined ? pinned : Object.values(record.services);
}

/** The processes to stop, sorted by pid. */
export function selectTargets(options: {
  procs: ProcInfo[];
  root: string;
  self: number;
  /** Pids listening on one of this checkout's ports. */
  listeners: number[];
  isForeign: (dir: string) => boolean;
}): ProcInfo[] {
  const { procs, root, self, isForeign } = options;
  const byPid = new Map(procs.map((proc) => [proc.pid, proc]));
  const children = new Map<number, number[]>();
  for (const proc of procs) {
    children.set(proc.ppid, [...(children.get(proc.ppid) ?? []), proc.pid]);
  }

  // This process, its ancestors and its own children are off limits.
  const protectedPids = new Set<number>();
  for (let pid: number | undefined = self; pid !== undefined && pid > 0;) {
    if (protectedPids.has(pid)) {
      break;
    }
    protectedPids.add(pid);
    pid = byPid.get(pid)?.ppid;
  }
  const selfTree = [self];
  while (selfTree.length > 0) {
    const pid = selfTree.pop() as number;
    for (const child of children.get(pid) ?? []) {
      if (!protectedPids.has(child)) {
        protectedPids.add(child);
        selfTree.push(child);
      }
    }
  }

  const listeners = new Set(options.listeners);
  const matched = procs.filter(
    (proc) =>
      !protectedPids.has(proc.pid) &&
      (listeners.has(proc.pid) || isDevProcess(proc)) &&
      inCheckout(proc.cwd, root, isForeign)
  );

  const chosen = new Set<number>();
  const queue = matched.map((proc) => proc.pid);
  while (queue.length > 0) {
    const pid = queue.pop() as number;
    if (chosen.has(pid) || protectedPids.has(pid)) {
      continue;
    }
    chosen.add(pid);
    queue.push(...(children.get(pid) ?? []));
  }
  return [...chosen]
    .toSorted((a, b) => a - b)
    .map((pid) => byPid.get(pid) as ProcInfo);
}

/** The name and ppid in a `/proc/<pid>/stat` line. The name may hold spaces. */
export function parseProcStat(
  text: string
): { name: string; ppid: number } | undefined {
  const open = text.indexOf("(");
  const close = text.lastIndexOf(")");
  if (open === -1 || close < open) {
    return undefined;
  }
  const ppid = Number(
    text
      .slice(close + 1)
      .trim()
      .split(/\s+/)[1]
  );
  if (!Number.isInteger(ppid)) {
    return undefined;
  }
  return { name: text.slice(open + 1, close), ppid };
}

/** The listening sockets in `/proc/net/tcp` or `/proc/net/tcp6`: port and inode. */
export function parseProcNetTcp(
  text: string
): { port: number; inode: string }[] {
  const sockets: { port: number; inode: string }[] = [];
  for (const line of text.split("\n").slice(1)) {
    const fields = line.trim().split(/\s+/);
    // Field 3 is the state, and 0A is LISTEN. Field 9 is the inode.
    if (fields.length < 10 || fields[3] !== "0A") {
      continue;
    }
    const port = Number.parseInt(fields[1]?.split(":")[1] ?? "", 16);
    if (Number.isInteger(port)) {
      sockets.push({ port, inode: fields[9] as string });
    }
  }
  return sockets;
}

/** `ps -A -o pid=,ppid=,args=` output, without cwds. */
export function parsePs(text: string): Omit<ProcInfo, "cwd">[] {
  const procs: Omit<ProcInfo, "cwd">[] = [];
  for (const line of text.split("\n")) {
    const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const args = (match[3] as string).trim();
    procs.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      name: path.basename(args.split(/\s+/)[0] ?? ""),
      args,
    });
  }
  return procs;
}

/** `lsof -d cwd -Fn` output: each pid's cwd. */
export function parseLsofCwd(text: string): Map<number, string> {
  const cwds = new Map<number, string>();
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid > 0) {
      cwds.set(pid, line.slice(1));
    }
  }
  return cwds;
}

/** `lsof -iTCP -sTCP:LISTEN -Fn` output: each pid and the port it listens on. */
export function parseLsofListeners(
  text: string
): { pid: number; port: number }[] {
  const found: { pid: number; port: number }[] = [];
  let pid = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("p")) {
      pid = Number(line.slice(1));
    } else if (line.startsWith("n") && pid > 0) {
      const port = Number(line.slice(line.lastIndexOf(":") + 1));
      if (Number.isInteger(port)) {
        found.push({ pid, port });
      }
    }
  }
  return found;
}

// The runner. Everything below reads the system or signals a process.

function readOrUndefined(read: () => string): string | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function run(command: string, args: string[]): string {
  return (
    readOrUndefined(() =>
      execFileSync(command, args, {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      })
    ) ?? ""
  );
}

function linuxProcs(): ProcInfo[] {
  const procs: ProcInfo[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const stat = parseProcStat(
      readOrUndefined(() => readFileSync(`/proc/${entry}/stat`, "utf-8")) ?? ""
    );
    if (stat === undefined) {
      continue;
    }
    const cmdline =
      readOrUndefined(() => readFileSync(`/proc/${entry}/cmdline`, "utf-8")) ??
      "";
    const argv = cmdline.split("\0").filter((arg) => arg !== "");
    procs.push({
      pid: Number(entry),
      ppid: stat.ppid,
      // The stat name is the thread name, which node sets to `MainThread`. argv[0] is the
      // executable; a kernel thread has none.
      name: argv[0] === undefined ? stat.name : path.basename(argv[0]),
      args: argv.join(" "),
      cwd: readOrUndefined(() => readlinkSync(`/proc/${entry}/cwd`)),
    });
  }
  return procs;
}

function linuxListeners(ports: Set<number>): number[] {
  const inodes = new Set<string>();
  for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    const text = readOrUndefined(() => readFileSync(file, "utf-8")) ?? "";
    for (const socket of parseProcNetTcp(text)) {
      if (ports.has(socket.port)) {
        inodes.add(`socket:[${socket.inode}]`);
      }
    }
  }
  if (inodes.size === 0) {
    return [];
  }
  const pids: number[] = [];
  for (const entry of readdirSync("/proc")) {
    if (!/^\d+$/.test(entry)) {
      continue;
    }
    const fds = readOrUndefined(() =>
      readdirSync(`/proc/${entry}/fd`).join("\n")
    );
    const holds = (fds ?? "")
      .split("\n")
      .some((fd) =>
        inodes.has(
          readOrUndefined(() => readlinkSync(`/proc/${entry}/fd/${fd}`)) ?? ""
        )
      );
    if (holds) {
      pids.push(Number(entry));
    }
  }
  return pids;
}

function otherProcs(): ProcInfo[] {
  const cwds = parseLsofCwd(run("lsof", ["-d", "cwd", "-Fn"]));
  return parsePs(run("ps", ["-A", "-o", "pid=,ppid=,args="])).map((proc) => ({
    ...proc,
    cwd: cwds.get(proc.pid),
  }));
}

function otherListeners(ports: Set<number>): number[] {
  return parseLsofListeners(
    run("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-Fn"])
  )
    .filter((socket) => ports.has(socket.port))
    .map((socket) => socket.pid);
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signal(pid: number, name: NodeJS.Signals): void {
  try {
    process.kill(pid, name);
  } catch {
    // Gone already.
  }
}

function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function main(): Promise<void> {
  const root = path.resolve(import.meta.dirname, "..", "..", "..");
  const pinned = SERVICES.flatMap((service) =>
    service.devPort === undefined ? [] : [service.devPort]
  );
  const ports = new Set(
    portsToStop(
      readOrUndefined(() =>
        readFileSync(path.join(root, RECORD_FILE), "utf-8")
      ),
      pinned
    )
  );
  const worktrees = new Set(
    parseWorktreeList(
      run("git", ["-C", root, "worktree", "list", "--porcelain"])
    ).map((dir) => path.resolve(dir))
  );
  const isForeign = (dir: string) =>
    worktrees.has(dir) || existsSync(path.join(dir, ".git"));

  const linux = process.platform === "linux";
  const targets = selectTargets({
    procs: linux ? linuxProcs() : otherProcs(),
    root,
    self: process.pid,
    listeners: linux ? linuxListeners(ports) : otherListeners(ports),
    isForeign,
  });
  if (targets.length === 0) {
    say("dev:stop: nothing runs in this checkout.");
    return;
  }

  for (const target of targets) {
    signal(target.pid, "SIGTERM");
  }
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline && targets.some((target) => alive(target.pid))) {
    await delay(100);
  }
  const killed = new Set<number>();
  for (const target of targets) {
    if (alive(target.pid)) {
      signal(target.pid, "SIGKILL");
      killed.add(target.pid);
    }
  }
  for (const target of targets) {
    const how = killed.has(target.pid) ? "SIGKILL" : "SIGTERM";
    const where = target.cwd === undefined ? "" : ` in ${target.cwd}`;
    say(
      `dev:stop: ${how} ${target.pid} ${target.name}${where}: ${target.args.slice(0, 120)}`
    );
  }
  say(`dev:stop: stopped ${targets.length} process(es).`);
}

if (import.meta.main) {
  await main();
}
