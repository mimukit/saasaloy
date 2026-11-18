#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  BLOCK_ENV,
  blockPorts,
  checkHost,
  checkoutHash,
  chooseBlock,
  cookiePrefixFor,
  forcedBlock,
  homeBlock,
  isPortListening,
  LOCAL_FILE,
  parseRecord,
  parseWorktreeList,
  portServices,
  RECORD_FILE,
  renderBlock,
  rewriteBlock,
  serviceBlocks,
} from "../src/dev-ports.ts";
import type { DevPortsRecord, PortService } from "../src/dev-ports.ts";
import { readEnvFile } from "../src/env-file.ts";
import { projectRoot } from "../src/project-root.ts";
import { LOCAL_VALUES, SERVICES } from "../src/services.ts";

// `pnpm dev:ports [--host <name>] [--clean]`: give this checkout its own dev ports, and
// write them with the origins that follow from them into each service's `.env.local`.
//
// The main checkout keeps the pinned ports and never probes. A linked worktree takes a
// block hashed from its root, moved past any block another worktree records or a port of
// which listens. `.devports.json` at the root records the result. `--clean` removes every
// block and the record. `pnpm env:setup` runs this at the end. `DEV_PORTS_BLOCK` in the
// environment sets the block in any checkout, the main one included.

function readOptions(args: string[]): { host?: string; clean: boolean } {
  let host: string | undefined;
  let clean = false;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--host") {
      host = args[index + 1];
      if (host === undefined || host.startsWith("--")) {
        throw new Error("--host takes a host name, such as devaloy.");
      }
      index += 1;
    } else if (arg === "--clean") {
      clean = true;
    } else {
      throw new Error(
        `Unknown option ${arg}. This command takes --host <name> and --clean.`
      );
    }
  }
  return { host, clean };
}

/**
 * Runs git and returns its output. Its stderr is captured, not printed: a project with no
 * repository makes `isLinkedWorktree` fail on purpose, and a real failure still reaches
 * the caller in the thrown error's message.
 */
function git(args: string[], cwd?: string): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/**
 * Whether `root` is a linked git worktree. A project with no repository (`saasaloy init
 * --no-git`) is not one, and takes the pinned ports like a main checkout.
 */
function isLinkedWorktree(root: string): boolean {
  let dirs: string;
  try {
    dirs = git(
      ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"],
      root
    );
  } catch {
    return false;
  }
  const [gitDir, commonDir] = dirs.split("\n");
  return path.resolve(gitDir ?? "") !== path.resolve(commonDir ?? "");
}

function readText(file: string): string | undefined {
  return existsSync(file) ? readFileSync(file, "utf-8") : undefined;
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** Write `text` to `file`, or delete `file` when `text` is empty. True when it changed. */
function writeIfChanged(file: string, text: string): boolean {
  const before = readText(file);
  if (text === "") {
    if (before === undefined) {
      return false;
    }
    rmSync(file);
    return true;
  }
  if (before === text) {
    return false;
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, text);
  return true;
}

function localFile(root: string, service: PortService): string {
  return path.join(root, path.dirname(service.file), LOCAL_FILE);
}

/** The blocks every other worktree of this repository records. */
function claimedBlocks(root: string): Set<number> {
  const claimed = new Set<number>();
  for (const worktree of parseWorktreeList(
    git(["worktree", "list", "--porcelain"], root)
  )) {
    if (path.resolve(worktree) === path.resolve(root)) {
      continue;
    }
    const block = parseRecord(
      readText(path.join(worktree, RECORD_FILE))
    )?.block;
    if (block !== null && block !== undefined) {
      claimed.add(block);
    }
  }
  return claimed;
}

function removeBlocks(root: string, services: PortService[]): void {
  let changed = false;
  for (const service of services) {
    const file = localFile(root, service);
    const before = readText(file);
    if (before !== undefined && writeIfChanged(file, rewriteBlock(before))) {
      changed = true;
      say(`Removed the dev:ports block from ${path.relative(root, file)}.`);
    }
  }
  if (existsSync(path.join(root, RECORD_FILE))) {
    rmSync(path.join(root, RECORD_FILE));
    say(`Removed ${RECORD_FILE}.`);
  }
  if (changed) {
    say("restart pnpm dev to load the pinned ports");
  }
}

async function assign(
  root: string,
  services: PortService[],
  hostOption: string | undefined
): Promise<void> {
  const host = checkHost(
    hostOption ??
      (readEnvFile(path.join(root, LOCAL_VALUES)).values.get("DEV_HOST") ||
        "localhost")
  );
  const forced = forcedBlock(process.env[BLOCK_ENV]);
  const linked = forced === undefined && isLinkedWorktree(root);

  // Fail on a devPort outside the two ranges before anything is probed or written.
  blockPorts(0, services);

  const recordFile = path.join(root, RECORD_FILE);
  let block: number | null = null;
  let cookiePrefix: string | null = null;
  if (forced !== undefined) {
    block = forced;
    cookiePrefix = cookiePrefixFor(checkoutHash(root));
  } else if (linked) {
    const hash = checkoutHash(root);
    cookiePrefix = cookiePrefixFor(hash);
    block = await chooseBlock({
      home: homeBlock(hash),
      recorded: parseRecord(readText(recordFile))?.block,
      claimed: claimedBlocks(root),
      isListening: async (candidate) => {
        const ports = Object.values(blockPorts(candidate, services));
        const open = await Promise.all(ports.map(isPortListening));
        return open.includes(true);
      },
    });
  }

  const ports = blockPorts(block, services);
  const blocks = serviceBlocks({ services, ports, host, cookiePrefix });
  let changed = false;
  for (const service of services) {
    const file = localFile(root, service);
    const text = rewriteBlock(
      readText(file) ?? "",
      renderBlock(blocks.get(service.name) ?? [])
    );
    if (writeIfChanged(file, text)) {
      changed = true;
      say(`Wrote the dev:ports block in ${path.relative(root, file)}.`);
    }
  }
  const record: DevPortsRecord = {
    block,
    host,
    cookiePrefix,
    services: ports,
  };
  writeIfChanged(recordFile, `${JSON.stringify(record, null, 2)}\n`);

  if (forced === undefined) {
    say(
      linked
        ? `Linked worktree: block ${block}, cookie prefix ${cookiePrefix}.`
        : "Main checkout: the pinned ports."
    );
  } else {
    say(`${BLOCK_ENV}: block ${block}, cookie prefix ${cookiePrefix}.`);
  }
  const width = Math.max(...services.map((service) => service.name.length));
  for (const service of services) {
    const port = ports[service.name];
    say(`  ${service.name.padEnd(width)}  ${port}  http://${host}:${port}`);
  }
  if (changed) {
    say("restart pnpm dev to load the new ports");
  }
}

try {
  const options = readOptions(process.argv.slice(2));
  const root = projectRoot(import.meta.dirname);
  const services = portServices(SERVICES);
  if (options.clean) {
    removeBlocks(root, services);
  } else {
    await assign(root, services, options.host);
  }
} catch (error) {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`
  );
  process.exitCode = 1;
}
