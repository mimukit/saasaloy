import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAdd } from "../commands/add.js";
import { runInit } from "../commands/init.js";
import { listFilesRelative } from "../lib/fs-utils.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import { loadPayload } from "./payload.js";
import type { Payload } from "./payload.js";
import { render } from "./render.js";
import type { RenderResult } from "./render.js";

// Phase 2's gate (plan 0116): the render of a preset equals the project the old engine
// makes with `init` and one `add` of the same set, in the fixed order. After Prettier on
// both sides, the trees hold the same paths and the same bytes. The state files are left
// out on purpose: `apply` writes manifest version 2 and the lock with `requested` in
// Phase 3, and the render never returns them.

/** `execFile` as a promise, rejecting with the child's output on a non-zero exit. */
function execFileAsync(
  command: string,
  args: readonly string[],
  options: { cwd: string }
): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    execFile(
      command,
      args,
      { ...options, maxBuffer: 16 * 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`${command} failed: ${stderr || stdout}`, {
              cause: error,
            })
          );
        } else {
          resolvePromise();
        }
      }
    );
  });
}

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const MODULES_DIR = join(REPO_ROOT, "modules");
const PRETTIER = join(REPO_ROOT, "node_modules", ".bin", "prettier");
const PROJECT = "parity-app";

/** State files `apply` owns from Phase 3; their format changes there (plan 0116). */
const STATE_FILES = new Set([".saasaloy/manifest.json", "saasaloy-lock.json"]);

interface Preset {
  modules: string[];
}

async function readPresets(): Promise<Record<string, Preset>> {
  const raw = await readFile(
    join(REPO_ROOT, "scripts/play-presets.json"),
    "utf-8"
  );
  return JSON.parse(raw) as Record<string, Preset>;
}

/** Every regular file under `root`, as POSIX paths; links and state files left out. */
async function readTree(root: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of await listFilesRelative(root)) {
    if (STATE_FILES.has(rel) || rel.startsWith(".git/")) {
      continue;
    }
    if ((await lstat(join(root, rel))).isSymbolicLink()) {
      continue;
    }
    out.set(rel, await readFile(join(root, rel), "utf-8"));
  }
  return out;
}

/**
 * Scaffold with the old engine: `init`, then one `add` of the whole set in `order`. Each
 * name's prerequisites come earlier in the list, so the add's install order is `order`.
 */
async function scaffoldOld(
  parent: string,
  order: string[],
  withModules: readonly string[] = []
): Promise<string> {
  const cwd = process.cwd();
  const previous = process.env[REGISTRY_ENV];
  process.env[REGISTRY_ENV] = MODULES_DIR;
  try {
    process.chdir(parent);
    await expect(
      runInit([PROJECT, "--no-install", "--no-git", "--testing=off"])
    ).resolves.toBe(0);
    const root = join(parent, PROJECT);
    if (order.length > 0) {
      process.chdir(root);
      const names = order.filter((name) => !withModules.includes(name));
      const picks = withModules.flatMap((name) => ["--with", name]);
      await expect(runAdd([...names, ...picks, "--yes"])).resolves.toBe(0);
    }
    return root;
  } finally {
    process.chdir(cwd);
    if (previous === undefined) {
      delete process.env[REGISTRY_ENV];
    } else {
      process.env[REGISTRY_ENV] = previous;
    }
  }
}

/**
 * Format each pair whose raw bytes differ with the repo's Prettier, on both sides, and
 * return the two trees after it. Prettier is deterministic, so formatting only the pairs
 * that differ gives the same verdict as formatting every file, in a fraction of the time.
 * `--no-config`, because the project's config imports a package a temp folder lacks.
 */
async function formatDiffering(
  scratch: string,
  oldTree: Map<string, string>,
  newTree: Map<string, string>
): Promise<{ old: Map<string, string>; next: Map<string, string> }> {
  const differing = [...oldTree.keys()].filter(
    (path) => newTree.has(path) && newTree.get(path) !== oldTree.get(path)
  );
  const old = new Map(oldTree);
  const next = new Map(newTree);
  if (differing.length === 0) {
    return { next, old };
  }
  const sides = { new: next, old };
  const written: string[] = [];
  for (const [side, tree] of Object.entries(sides)) {
    for (const path of differing) {
      const abs = join(scratch, side, path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, tree.get(path) ?? "", "utf-8");
      written.push(posix.join(side, path));
    }
  }
  await execFileAsync(
    PRETTIER,
    [
      "--write",
      "--no-config",
      "--no-editorconfig",
      "--ignore-unknown",
      "--log-level",
      "warn",
      "--",
      ...written,
    ],
    { cwd: scratch }
  );
  for (const [side, tree] of Object.entries(sides)) {
    for (const path of differing) {
      tree.set(path, await readFile(join(scratch, side, path), "utf-8"));
    }
  }
  return { next, old };
}

function renderedTree(result: RenderResult): Map<string, string> {
  return new Map(
    [...result.files.values()].map((file) => [file.path, file.content])
  );
}

let workdir: string;
let presets: Record<string, Preset>;

beforeAll(async () => {
  workdir = await mkdtemp(join(tmpdir(), "saasaloy-render-parity-"));
  presets = await readPresets();
});

afterAll(async () => {
  await rm(workdir, { force: true, recursive: true });
});

/**
 * Render `modules` plus `withModules`, scaffold the same set with the old engine, check
 * the path sets are equal, and return the paths whose bytes still differ after Prettier.
 * A `withModules` name goes to the old `add` as `--with`, as the playground passes the
 * driver; every other name goes in the fixed order.
 */
async function compareWithOld(
  name: string,
  modules: string[],
  withModules: string[] = []
): Promise<string[]> {
  const requested = [...modules, ...withModules];
  const payload: Payload = await loadPayload({
    env: { [REGISTRY_ENV]: MODULES_DIR },
    ref: "local",
    requested,
  });
  const result = render({
    options: { projectName: PROJECT, testingMode: "off" },
    payload,
    requested,
  });
  const parent = join(workdir, name);
  await mkdir(parent, { recursive: true });
  const oldRoot = await scaffoldOld(parent, result.order, withModules);
  const oldTree = await readTree(oldRoot);
  // The old engine installed exactly the rendered set.
  const installed = (
    JSON.parse(oldTree.get("saasaloy.json") ?? "{}") as { installed?: string[] }
  ).installed;
  expect([...(installed ?? [])].toSorted()).toStrictEqual(
    [...result.order].toSorted()
  );
  const newTree = renderedTree(result);

  expect([...newTree.keys()].toSorted()).toStrictEqual(
    [...oldTree.keys()].toSorted()
  );
  const { old, next } = await formatDiffering(
    join(workdir, `${name}-fmt`),
    oldTree,
    newTree
  );
  return [...old.keys()]
    .filter((path) => old.get(path) !== next.get(path))
    .toSorted();
}

describe("render parity with init + add (plan 0116, Phase 2)", () => {
  it("renders the minimal preset as init writes it", async () => {
    const preset = presets.minimal;
    expect(preset).toBeDefined();
    await expect(
      compareWithOld("minimal", preset?.modules ?? [])
    ).resolves.toStrictEqual([]);
  }, 60_000);

  // The playground's driver, `--with database-postgres`, named in its fixed place.
  it("renders the full preset with database-postgres as init + add write it", async () => {
    const preset = presets.full;
    expect(preset).toBeDefined();
    await expect(
      compareWithOld("full", [...(preset?.modules ?? []), "database-postgres"])
    ).resolves.toStrictEqual([]);
  }, 60_000);

  // `--with` appends the driver to the old install order, after every other module, and
  // three files record install order. The fixed order cannot reproduce that, by design:
  // the render depends on the set alone. These three files are the whole difference.
  it("differs from an old `--with` run only in the files that record install order", async () => {
    const preset = presets.full;
    await expect(
      compareWithOld("full-with", preset?.modules ?? [], ["database-postgres"])
    ).resolves.toStrictEqual([
      "apps/api/src/env.ts",
      "package.json",
      "saasaloy.json",
    ]);
  }, 60_000);
});
