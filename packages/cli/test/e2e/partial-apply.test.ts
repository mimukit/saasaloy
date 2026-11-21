import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, fixture, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// A run that stops short leaves a journal, and the next run refuses until `--abort`
// restores the files it changed (ADR 0066, which replaced the re-run recovery of ADR
// 0031). The fault is real filesystem state, never a hook in `packages/cli/src`: a
// read-only directory refuses the write of beta's skill file.

const REGISTRY = fixture("registry-clean");
// Both projects carry this name: `init` writes it into the root package.json, so a
// different name would be the one difference the comparison found.
const PROJECT = "e2e-partial";
const SKILL_DIR = join(".agents", "skills", "saasaloy-beta");

/**
 * Whether a read-only directory actually refuses a write here. Root ignores the mode
 * bit, Windows has no equivalent, and some mounts drop permissions entirely; in all
 * three the injected fault would silently succeed and the case would assert nothing.
 */
function readOnlyDirsBite(): boolean {
  if (process.platform === "win32") {
    return false;
  }
  const probe = mkdtempSync(join(tmpdir(), "saasaloy-probe-"));
  try {
    chmodSync(probe, 0o555);
    writeFileSync(join(probe, "probe.txt"), "probe", "utf-8");
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(probe, 0o755);
    rmSync(probe, { force: true, recursive: true });
  }
}

const DENIES_WRITES = readOnlyDirsBite();

function add(project: string, args: string[]): Promise<CliRun> {
  return runCli(["add", ...args], {
    cwd: project,
    env: { SAASALOY_REGISTRY_DIR: REGISTRY },
  });
}

/** Scaffold a project under `parent` and return its path. */
async function initProject(parent: string): Promise<string> {
  await mkdir(parent, { recursive: true });
  const run = await runCli(["init", PROJECT, "--no-install", "--no-git"], {
    cwd: parent,
  });
  if (run.code !== 0) {
    throw new Error(`init failed (${run.code}):\n${run.output}`);
  }
  return join(parent, PROJECT);
}

/**
 * Every path under `root`, mapped to a content hash — or, for a symlink, to what it
 * points at, since following it would hide whether the link itself is the same. This is
 * the whole-project equality the convergence case rests on.
 */
async function snapshot(
  root: string,
  dir: string = root,
  out: Record<string, string> = {}
): Promise<Record<string, string>> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    const rel = relative(root, abs).split(sep).join(posix.sep);
    // A backup folder is named by the time of its run, so two projects never share it.
    if (rel === ".saasaloy/backups") {
      continue;
    }
    if (entry.isSymbolicLink()) {
      out[rel] = `-> ${(await readlink(abs)).split(sep).join(posix.sep)}`;
    } else if (entry.isDirectory()) {
      await snapshot(root, abs, out);
    } else {
      out[rel] = createHash("sha256")
        .update(await readFile(abs))
        .digest("hex");
    }
  }
  return out;
}

let workspace: string;
let partialProject: string;
let lockedDir: string;
let before: Record<string, string>;
let failed: CliRun;

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  await assertCliBuilt();
  // Outside the pnpm workspace, for the reason `apply.test.ts` gives.
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-partial-"));
  partialProject = await initProject(join(workspace, "partial"));

  lockedDir = join(partialProject, SKILL_DIR);
  await mkdir(lockedDir, { recursive: true });
  before = await snapshot(partialProject);
  if (DENIES_WRITES) {
    await chmod(lockedDir, 0o555);
  }
  failed = await add(partialProject, ["beta", "--yes"]);
}, 120_000);

afterAll(async () => {
  // Restore the mode before the sweep, or `rm` cannot empty the directory it made.
  if (lockedDir) {
    try {
      await chmod(lockedDir, 0o755);
    } catch {
      // Already restored, or the setup never got as far as creating it.
    }
  }
  if (workspace) {
    await rm(workspace, { force: true, recursive: true });
  }
});

describe.skipIf(!DENIES_WRITES)(
  "e2e — a refused write leaves a journal, and --abort restores the tree",
  () => {
    it("fails the run rather than reporting a success it did not have", () => {
      expect(failed.code).toBe(1);
      expect(failed.output).toContain("EACCES");
    });

    it("leaves the journal that marks the unfinished run", async () => {
      await expect(
        exists(join(partialProject, ".saasaloy", "journal.json"))
      ).resolves.toBeTruthy();
    });

    it("refuses the next run until --abort, and names the flag", async () => {
      const run = await add(partialProject, ["beta", "--yes"]);

      expect(run.code).toBe(2);
      expect(run.output).toContain("--abort");
    });

    it("restores every file byte for byte with --abort", async () => {
      const run = await add(partialProject, ["--abort"]);

      expect(run.code).toBe(0);
      await expect(
        exists(join(partialProject, ".saasaloy", "journal.json"))
      ).resolves.toBeFalsy();
      await expect(snapshot(partialProject)).resolves.toStrictEqual(before);
    });
  }
);

describe.skipIf(!DENIES_WRITES)(
  "e2e — the run after --abort converges on the clean result",
  () => {
    let cleanProject: string;
    let repaired: CliRun;
    let cleanRun: CliRun;

    beforeAll(async () => {
      await chmod(lockedDir, 0o755);
      repaired = await add(partialProject, ["beta", "--yes"]);

      cleanProject = await initProject(join(workspace, "clean"));
      cleanRun = await add(cleanProject, ["beta", "--yes"]);
    }, 120_000);

    it("completes the module on the second attempt", () => {
      expect(repaired.code).toBe(0);
      expect(cleanRun.code).toBe(0);
    });

    it("ends with the same tree, file for file", async () => {
      await expect(snapshot(partialProject)).resolves.toStrictEqual(
        await snapshot(cleanProject)
      );
    });
  }
);
