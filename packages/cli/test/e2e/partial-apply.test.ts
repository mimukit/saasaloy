import { createHash } from "node:crypto";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertCliBuilt, fixture, runCli } from "../support/cli.js";
import type { CliRun } from "../support/cli.js";

// `add` has no rollback by design (ADR 0031): whatever landed before a failure stays, and
// the manifest, config and lock are written to describe it. These cases drive the two
// ways a run can end short — a write the kernel refuses, and a file that appears between
// the plan and the write — then re-run to complete the module.
//
// Both faults are real filesystem state, never a hook in `packages/cli/src`: a test hook
// would prove the hook works, not the engine. The failing write is denied by a read-only
// parent directory. The mid-apply drift comes from a symlink that dangles while the plan
// is built and resolves once an earlier file in the same plan lands.

const REGISTRY = fixture("registry-clean");
// Both convergence projects carry this name: `init` writes it into the root package.json,
// so a different name would be the one difference the comparison found.
const PROJECT = "e2e-partial";
// beta's skill file — the last of the three writes `add beta` plans. Taking the write bit
// off its parent lets the two ahead of it land, so the failure is genuinely mid-apply.
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

/**
 * Whether a file symlink can be created here. Windows needs developer mode or an
 * elevated shell for one, so the drift fault would throw in `beforeAll` and fail the
 * file rather than skip it.
 */
function symlinksWork(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "saasaloy-link-probe-"));
  try {
    writeFileSync(join(probe, "target.txt"), "probe", "utf-8");
    symlinkSync("target.txt", join(probe, "link.txt"));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { force: true, recursive: true });
  }
}

const SYMLINKS_WORK = symlinksWork();

interface Config {
  aliases: Record<string, string>;
  installed: string[];
}
interface Manifest {
  links: Record<string, string>;
  managed: Record<string, { from?: string; hash: string; module: string }>;
}
interface Lock {
  lockfileVersion: number;
  modules: Record<string, { resolved: string; source: string }>;
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf-8")) as T;
}

function config(project: string): Promise<Config> {
  return json<Config>(join(project, "saasaloy.json"));
}

function manifest(project: string): Promise<Manifest> {
  return json<Manifest>(join(project, ".saasaloy", "manifest.json"));
}

function lock(project: string): Promise<Lock> {
  return json<Lock>(join(project, "saasaloy-lock.json"));
}

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
let packageJsonBefore: string;
let failed: CliRun;

beforeAll(async () => {
  await assertCliBuilt();
  // Outside the pnpm workspace, for the reason `apply.test.ts` gives.
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-partial-"));
  partialProject = await initProject(join(workspace, "partial"));

  lockedDir = join(partialProject, SKILL_DIR);
  await mkdir(lockedDir, { recursive: true });
  packageJsonBefore = await readFile(
    join(partialProject, "package.json"),
    "utf-8"
  );
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
  "e2e — a refused write leaves bookkeeping that describes disk",
  () => {
    it("fails the run rather than reporting a success it did not have", () => {
      expect(failed.code).not.toBe(0);
      expect(failed.code).toBe(1);
    });

    it("states that the apply was partial and names the re-run that completes it", () => {
      expect(failed.output).toContain("Partial apply");
      expect(failed.output).toContain("saasaloy add beta");
    });

    it("really did write the files ahead of the failure", async () => {
      // Without this the case would pass on a run that never started applying, and the
      // assertions below would all be about an untouched project.
      await expect(
        readFile(join(partialProject, "apps", "api", "src", "beta.ts"), "utf-8")
      ).resolves.toContain("beta");
    });

    it("tracks exactly the files that landed, and no file that did not", async () => {
      const tracked = Object.keys((await manifest(partialProject)).managed);

      expect(tracked.toSorted()).toStrictEqual([
        "apps/api/src/beta.ts",
        "apps/api/src/index.ts",
      ]);
    });

    it("omits the module from saasaloy.json", async () => {
      const state = await config(partialProject);

      expect(state.installed).toStrictEqual([]);
    });

    it("pins nothing the config does not also claim", async () => {
      const state = await config(partialProject);

      expect(Object.keys((await lock(partialProject)).modules)).toStrictEqual(
        state.installed
      );
    });

    it("leaves the root package.json byte-identical", async () => {
      // The dependency merge trails the apply (#98), so a throw must never reach it.
      await expect(
        readFile(join(partialProject, "package.json"), "utf-8")
      ).resolves.toBe(packageJsonBefore);
    });
  }
);

describe.skipIf(!DENIES_WRITES)(
  "e2e — the re-run converges on the clean result",
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

    it("ends with the same saasaloy.json", async () => {
      await expect(config(partialProject)).resolves.toStrictEqual(
        await config(cleanProject)
      );
    });

    it("ends with the same manifest", async () => {
      await expect(manifest(partialProject)).resolves.toStrictEqual(
        await manifest(cleanProject)
      );
    });

    it("ends with the same lockfile", async () => {
      await expect(lock(partialProject)).resolves.toStrictEqual(
        await lock(cleanProject)
      );
    });

    it("ends with the same tree, file for file", async () => {
      await expect(snapshot(partialProject)).resolves.toStrictEqual(
        await snapshot(cleanProject)
      );
    });
  }
);

describe.skipIf(!SYMLINKS_WORK)(
  "e2e — a file that appears mid-apply holds its module back",
  () => {
    let driftProject: string;
    let blocked: CliRun;

    beforeAll(async () => {
      driftProject = await initProject(join(workspace, "drift"));

      // The window between the plan and the write, opened with filesystem state alone:
      // `apps/api/src/beta.ts` is a symlink to a sibling that does not exist yet, so the
      // plan reads the target as empty and classifies a `create`. alpha's `index.ts` is
      // written earlier in the same plan, which makes the link resolve — by beta's turn
      // the target holds bytes the user never approved a write over.
      const src = join(driftProject, "apps", "api", "src");
      await mkdir(src, { recursive: true });
      await symlink("index.ts", join(src, "beta.ts"));

      blocked = await add(driftProject, ["beta", "--yes"]);
    }, 120_000);

    it("exits 0 — nothing failed, an edit simply outranked the plan", () => {
      expect(blocked.code).toBe(0);
    });

    it("names the module it did not install and the re-run that completes it", () => {
      expect(blocked.output).toContain("is not installed");
      expect(blocked.output).toContain("saasaloy add beta");
    });

    it("keeps the bytes that were there", async () => {
      const target = join(driftProject, "apps", "api", "src", "beta.ts");

      await expect(readlink(target)).resolves.toBe("index.ts");
      await expect(readFile(target, "utf-8")).resolves.toContain("alpha");
    });

    it("leaves the module out of saasaloy.json", async () => {
      expect((await config(driftProject)).installed).toStrictEqual(["alpha"]);
    });

    it("claims no manifest entry for the file it did not write", async () => {
      const tracked = await manifest(driftProject);

      expect(tracked.managed["apps/api/src/beta.ts"]).toBeUndefined();
    });

    describe("and the re-run installs it on informed approval", () => {
      let repair: CliRun;

      beforeAll(async () => {
        repair = await add(driftProject, ["beta", "--yes"]);
      }, 120_000);

      it("re-plans the module, because it never reached saasaloy.json", () => {
        expect(repair.code).toBe(0);
        expect(repair.output).toContain("will install: beta");
      });

      it("shows the drift in the preview this time", () => {
        expect(repair.output).toContain("apps/api/src/beta.ts");
        expect(repair.output).toContain("merge");
      });

      it("installs the module once the plan is approved with the drift on it", async () => {
        expect((await config(driftProject)).installed.toSorted()).toStrictEqual(
          ["alpha", "beta"]
        );
      });

      it("still keeps the user's bytes, held back for a merge", async () => {
        const target = join(driftProject, "apps", "api", "src", "beta.ts");

        expect(repair.output).toContain("Needs merge");
        await expect(readFile(target, "utf-8")).resolves.toContain("alpha");
      });
    });
  }
);
