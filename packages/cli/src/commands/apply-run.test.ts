import { execFileSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { apply, JOURNAL_FILE } from "../engine/apply.js";
import { CACHE_COMPLETE, CACHE_DIR_ENV } from "../engine/payload.js";
import { loadSide } from "../engine/project.js";
import { EXIT_OK, EXIT_REFUSED, EXIT_WORK_PENDING } from "../lib/exit.js";
import { pathExists } from "../lib/fs-utils.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import { baseTemplateDir } from "../lib/scaffold.js";
import { stripAnsi } from "../lib/tui.js";
import { readVersion } from "../version.js";
import { runAdd } from "./add.js";
import { scaffoldProject } from "./init.js";
import { runRemove } from "./remove.js";
import { runTesting } from "./testing.js";
import { demoteHeadings, runUpdate } from "./update.js";

// `init`, `add`, `remove`, `update` and `testing` on the render engine (plan 0116): the
// flags keep their meaning, the refusals exit 2, `update --merge <path>` merges one file
// written once, and `testing off` deletes nothing.

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ENV_KEYS = [REGISTRY_ENV, CACHE_DIR_ENV] as const;
const ORIGINAL_ENV = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]])
);

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "saasaloy-next-"));
  delete process.env[REGISTRY_ENV];
  delete process.env[CACHE_DIR_ENV];
  process.stdin.isTTY = false;
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  process.stdin.isTTY = ORIGINAL_STDIN_TTY;
  for (const key of ENV_KEYS) {
    const value = ORIGINAL_ENV[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  await rm(workspace, { force: true, recursive: true });
});

// --- Fixtures ----------------------------------------------------------------------------

type Files = Record<string, string>;

async function writeTree(root: string, files: Files): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    const abs = join(root, ...path.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
  }
}

function descriptor(item: Record<string, unknown>): string {
  return `${JSON.stringify(
    {
      $schema: "https://saasaloy.dev/schemas/registry-item.schema.json",
      description: `Test fixture ${String(item.name)}.`,
      type: "saasaloy:capability",
      ...item,
    },
    null,
    2
  )}\n`;
}

const INDEX_V1 = [
  "export const one = 1;",
  "export const two = 2;",
  "export const three = 3;",
  "",
].join("\n");
const INDEX_V2 = [
  "export const one = 1;",
  "export const two = 2;",
  "export const three = 33;",
  "",
].join("\n");
const SEED_V1 = [
  "// the owner rewrites this",
  "export const greeting = 'hi';",
  "",
  "// the size",
  "export const size = 1;",
  "",
].join("\n");
const SEED_V2 = [
  "// the owner rewrites this",
  "export const greeting = 'hi';",
  "",
  "// the size",
  "export const size = 2;",
  "",
].join("\n");

/** A registry: `alpha` with a merged, a once and a third file; `beta` on top; a driver choice. */
function registry(version: 1 | 2): Files {
  return {
    "alpha/files/extra.ts":
      version === 1 ? "export const extra = 1;\n" : "export const extra = 2;\n",
    "alpha/files/index.ts": version === 1 ? INDEX_V1 : INDEX_V2,
    "alpha/files/seed.ts": version === 1 ? SEED_V1 : SEED_V2,
    "alpha/registry-item.json": descriptor({
      name: "alpha",
      scaffolds: [
        {
          aliases: { "@api": "apps/api/src" },
          files: [
            { path: "files/index.ts", target: "src/index.ts" },
            { path: "files/seed.ts", seed: true, target: "src/seed.ts" },
            { path: "files/extra.ts", target: "src/extra.ts" },
          ],
          workspace: "apps/api",
        },
      ],
    }),
    ...(version === 2
      ? {
          "alpha/update-notes/0001-size.md": [
            "---",
            "title: The size doubles",
            "---",
            "",
            "## What update does",
            "",
            "It changes the size.",
            "",
            "## What update merges",
            "",
            "Nothing.",
            "",
            "## What you do",
            "",
            "Nothing.",
            "",
            "## Verify",
            "",
            "Nothing.",
            "",
          ].join("\n"),
        }
      : {}),
    "beta/files/beta.ts": "export const beta = true;\n",
    "beta/registry-item.json": descriptor({
      dependencies: ["zod@4.4.3"],
      dependsOn: ["alpha"],
      devVars: { BETA_URL: "http://localhost:4000" },
      envServices: { BETA_URL: ["api"] },
      envVars: { BETA_URL: "Where beta posts to." },
      files: [{ path: "files/beta.ts", target: "@api/beta.ts" }],
      name: "beta",
    }),
    "gamma/files/gamma.ts": "export const gamma = 1;\n",
    "gamma/files/gamma.test.ts": "it('gamma', () => {});\n",
    "gamma/registry-item.json": descriptor({
      dependsOn: ["alpha"],
      files: [
        { path: "files/gamma.ts", target: "@api/gamma.ts" },
        {
          path: "files/gamma.test.ts",
          target: "@api/gamma.test.ts",
          when: { testing: true },
        },
      ],
      name: "gamma",
    }),
    "drv-a/files/drv.ts": "export const driver = 'a';\n",
    "drv-a/registry-item.json": descriptor({
      files: [{ path: "files/drv.ts", target: "@api/drv.ts" }],
      name: "drv-a",
    }),
    "drv-b/files/drv.ts": "export const driver = 'b';\n",
    "drv-b/registry-item.json": descriptor({
      files: [{ path: "files/drv.ts", target: "@api/drv.ts" }],
      name: "drv-b",
    }),
    "needs/files/needs.ts": "export const needs = true;\n",
    "needs/registry-item.json": descriptor({
      dependsOn: ["alpha"],
      files: [{ path: "files/needs.ts", target: "@api/needs.ts" }],
      name: "needs",
      requiresOneOf: ["drv-a", "drv-b"],
    }),
  };
}

function git(root: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_AUTHOR_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
    },
  });
}

function commit(root: string, message = "work"): void {
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", message);
}

/** Capture stdout while `run` runs. */
async function captured(
  run: () => Promise<number>
): Promise<{ code: number; stdout: string }> {
  const chunks: string[] = [];
  const write = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    chunks.push(String(chunk));
    return true;
  };
  try {
    const code = await run();
    return { code, stdout: stripAnsi(chunks.join("")) };
  } finally {
    process.stdout.write = write;
  }
}

async function read(root: string, path: string): Promise<string> {
  return readFile(join(root, path), "utf-8");
}

async function lockOf(root: string): Promise<{
  requested?: string[];
  modules: Record<string, unknown>;
  base?: { cliVersion: string };
}> {
  return JSON.parse(await read(root, "saasaloy-lock.json")) as never;
}

// --- A local registry: add and remove ----------------------------------------------------

describe("add and remove on the render engine (local registry)", () => {
  let project: string;

  beforeEach(async () => {
    const modules = join(workspace, "modules");
    await writeTree(modules, registry(1));
    process.env[REGISTRY_ENV] = modules;
    project = join(workspace, "demo");
    await scaffoldProject({
      projectName: "demo",
      target: project,
      testingMode: "off",
    });
    git(project, "init", "-q");
    commit(project, "init");
    process.chdir(project);
  });

  it("init writes manifest version 2 and a lock with an empty requested list", async () => {
    const manifest = JSON.parse(
      await read(project, ".saasaloy/manifest.json")
    ) as {
      version: number;
      files: Record<string, { class: string }>;
    };
    expect(manifest.version).toBe(2);
    expect(manifest.files["saasaloy.json"]?.class).toBe("merged");
    expect(manifest.files["README.md"]?.class).toBe("once");
    expect((await lockOf(project)).requested).toStrictEqual([]);
  });

  it("--dry-run writes nothing", async () => {
    const before = await read(project, ".saasaloy/manifest.json");
    await expect(runAdd(["alpha", "--dry-run"])).resolves.toBe(EXIT_OK);
    await expect(
      pathExists(join(project, "apps/api/src/index.ts"))
    ).resolves.toBeFalsy();
    await expect(read(project, ".saasaloy/manifest.json")).resolves.toBe(
      before
    );
  });

  it("--dry-run --json prints the plan as one document", async () => {
    const { code, stdout } = await captured(() =>
      runAdd(["beta", "--dry-run", "--json"])
    );
    expect(code).toBe(EXIT_OK);
    const doc = JSON.parse(stdout) as {
      schemaVersion: number;
      requested: string[];
      install: string[];
      prerequisites: string[];
      files: { target: string; action: string; class: string }[];
    };
    expect(doc.schemaVersion).toBe(3);
    expect(doc.requested).toStrictEqual(["beta"]);
    expect(doc.install).toStrictEqual(["alpha", "beta"]);
    expect(doc.prerequisites).toStrictEqual(["alpha"]);
    expect(doc.files).toContainEqual({
      action: "new",
      class: "once",
      module: "alpha",
      target: "apps/api/src/seed.ts",
    });
    await expect(
      pathExists(join(project, "apps/api/src/beta.ts"))
    ).resolves.toBeFalsy();
  });

  it("--with answers a requiresOneOf choice, and its absence refuses", async () => {
    await expect(runAdd(["needs", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runAdd(["needs", "--with", "drv-b", "--yes"])).resolves.toBe(
      EXIT_OK
    );
    await expect(read(project, "apps/api/src/drv.ts")).resolves.toContain(
      "'b'"
    );
    expect((await lockOf(project)).requested).toStrictEqual(["drv-b", "needs"]);
    // `saasaloy.json` is written once; the lock is the installed set.
    expect((await loadConfig(project)).installed.toSorted()).toStrictEqual([
      "alpha",
      "drv-b",
      "needs",
    ]);
  });

  it("--abort puts back the files the last add wrote", async () => {
    const before = await read(project, "package.json");
    await expect(runAdd(["beta", "--yes"])).resolves.toBe(EXIT_OK);
    await expect(read(project, "package.json")).resolves.toContain("zod");
    await expect(runAdd(["--abort"])).resolves.toBe(EXIT_OK);
    await expect(
      pathExists(join(project, "apps/api/src/beta.ts"))
    ).resolves.toBeFalsy();
    await expect(pathExists(join(project, "apps/api"))).resolves.toBeFalsy();
    await expect(read(project, "package.json")).resolves.toBe(before);
    expect((await lockOf(project)).requested).toStrictEqual([]);
  });

  it("passes over an uncommitted new file, refuses a merge over uncommitted changes, and --force overrides", async () => {
    await writeFile(join(project, "notes.txt"), "mine\n", "utf-8");
    await expect(runAdd(["alpha", "--yes"])).resolves.toBe(EXIT_OK);
    commit(project);
    // `beta` adds a dependency to the root package.json, which the project changed.
    const pkg = JSON.parse(await read(project, "package.json")) as {
      scripts: Record<string, string>;
    };
    pkg.scripts.mine = "echo mine";
    await writeFile(
      join(project, "package.json"),
      `${JSON.stringify(pkg, null, 2)}\n`
    );
    await expect(runAdd(["beta", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(
      pathExists(join(project, "apps/api/src/beta.ts"))
    ).resolves.toBeFalsy();
    await expect(runAdd(["beta", "--yes", "--force"])).resolves.toBe(EXIT_OK);
    const merged = await read(project, "package.json");
    expect(merged).toContain("echo mine");
    expect(merged).toContain("zod");
  });

  it("--force on an installed module writes its deleted files again", async () => {
    await expect(runAdd(["alpha", "--yes"])).resolves.toBe(EXIT_OK);
    await unlink(join(project, "apps/api/src/extra.ts"));
    await expect(runAdd(["alpha", "--yes"])).resolves.toBe(EXIT_OK);
    await expect(
      pathExists(join(project, "apps/api/src/extra.ts"))
    ).resolves.toBeFalsy();
    await expect(runAdd(["alpha", "--yes", "--force"])).resolves.toBe(EXIT_OK);
    await expect(read(project, "apps/api/src/extra.ts")).resolves.toBe(
      "export const extra = 1;\n"
    );
  });

  it("merges saasaloy.json and the key list on add and on remove (re-grill Q2, Q3)", async () => {
    // An owner's own alias and an owner's key value survive both runs.
    const configPath = join(project, "saasaloy.json");
    const config = JSON.parse(await readFile(configPath, "utf-8")) as {
      aliases: Record<string, string>;
    };
    config.aliases["@mine"] = "packages/mine";
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`);
    commit(project, "owner alias");

    await expect(runAdd(["beta", "--yes"])).resolves.toBe(EXIT_OK);
    const added = await loadConfig(project);
    expect(added.installed).toStrictEqual(["alpha", "beta"]);
    expect(added.aliases["@api"]).toBe("apps/api/src");
    expect(added.aliases["@mine"]).toBe("packages/mine");
    await expect(read(project, "packages/env/.env.example")).resolves.toContain(
      "BETA_URL"
    );
    commit(project, "add beta");

    await expect(runRemove(["beta", "--yes"])).resolves.toBe(EXIT_OK);
    const removed = await loadConfig(project);
    expect(removed.installed).toStrictEqual([]);
    expect(removed.aliases["@api"]).toBeUndefined();
    expect(removed.aliases["@mine"]).toBe("packages/mine");
    await expect(
      read(project, "packages/env/.env.example")
    ).resolves.not.toContain("BETA_URL");
  });

  it("remove refuses a module another one needs, and removes it once alone", async () => {
    await expect(runAdd(["beta", "--yes"])).resolves.toBe(EXIT_OK);
    commit(project);
    await expect(runRemove(["alpha", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runRemove(["beta", "--dry-run"])).resolves.toBe(EXIT_OK);
    await expect(
      pathExists(join(project, "apps/api/src/beta.ts"))
    ).resolves.toBeTruthy();
    await expect(runRemove(["beta", "--yes"])).resolves.toBe(EXIT_OK);
    await expect(
      pathExists(join(project, "apps/api/src/beta.ts"))
    ).resolves.toBeFalsy();
    await expect(
      pathExists(join(project, "apps/api/src/index.ts"))
    ).resolves.toBeFalsy();
    expect((await lockOf(project)).requested).toStrictEqual([]);
  });

  it("add, remove and update refuse with exit 2 while a journal is left", async () => {
    await writeTree(project, { [JOURNAL_FILE]: "{}\n" });
    commit(project);
    await expect(runAdd(["alpha", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runRemove(["alpha", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runUpdate(["--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(
      pathExists(join(project, "apps/api/src/index.ts"))
    ).resolves.toBeFalsy();
  });

  it("add, remove and update refuse with exit 2 while a merge is pending", async () => {
    await expect(runAdd(["alpha", "--yes"])).resolves.toBe(EXIT_OK);
    const manifestPath = join(project, ".saasaloy/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
      pendingMerges: string[];
    };
    manifest.pendingMerges = ["apps/api/src/index.ts"];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await writeFile(
      join(project, "apps/api/src/index.ts"),
      "<<<<<<< mine\na\n=======\nb\n>>>>>>> saasaloy 0.9.0\n"
    );
    commit(project);
    await expect(runAdd(["beta", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runRemove(["alpha", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runUpdate(["--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(
      pathExists(join(project, "apps/api/src/beta.ts"))
    ).resolves.toBeFalsy();
  });

  it("refuses with exit 2, not a parse error, while saasaloy.json holds markers", async () => {
    await expect(runAdd(["alpha", "--yes"])).resolves.toBe(EXIT_OK);
    const manifestPath = join(project, ".saasaloy/manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf-8")) as {
      pendingMerges: string[];
    };
    manifest.pendingMerges = ["saasaloy.json"];
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    const config = await read(project, "saasaloy.json");
    await writeFile(
      join(project, "saasaloy.json"),
      `<<<<<<< mine\n${config}=======\n${config}>>>>>>> saasaloy 0.9.0\n`
    );
    commit(project);
    await expect(runAdd(["beta", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runRemove(["alpha", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runUpdate(["--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runTesting(["tdd"])).resolves.toBe(EXIT_REFUSED);
  });

  it("testing writes a gated test file, and off keeps it on disk, untracked (ADR 0053)", async () => {
    await expect(runAdd(["gamma", "--yes"])).resolves.toBe(EXIT_OK);
    commit(project);
    const test = join(project, "apps/api/src/gamma.test.ts");
    await expect(pathExists(test)).resolves.toBeFalsy();

    await expect(runTesting(["tests-after"])).resolves.toBe(EXIT_OK);
    await expect(read(project, "apps/api/src/gamma.test.ts")).resolves.toBe(
      "it('gamma', () => {});\n"
    );
    expect((await loadConfig(project)).testing?.mode).toBe("tests-after");
    await expect(read(project, "AGENTS.md")).resolves.toContain(
      "saasaloy:testing"
    );
    const tracked = async (): Promise<string[]> =>
      Object.keys(
        (
          JSON.parse(await read(project, ".saasaloy/manifest.json")) as {
            files: Record<string, unknown>;
          }
        ).files
      );
    await expect(tracked()).resolves.toContain("apps/api/src/gamma.test.ts");
    commit(project);

    await expect(runTesting(["off"])).resolves.toBe(EXIT_OK);
    await expect(pathExists(test)).resolves.toBeTruthy();
    await expect(tracked()).resolves.not.toContain(
      "apps/api/src/gamma.test.ts"
    );
    expect((await loadConfig(project)).testing?.mode).toBe("off");
    commit(project);

    // Back on: the file on disk equals the render, so it is tracked again.
    await expect(runTesting(["tdd"])).resolves.toBe(EXIT_OK);
    await expect(tracked()).resolves.toContain("apps/api/src/gamma.test.ts");
  });

  it("testing refuses an unknown mode and a mode beside --abort", async () => {
    await expect(runTesting(["sometimes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runTesting(["off", "--abort"])).resolves.toBe(EXIT_REFUSED);
  });

  it("update takes no module name and refuses the old engine's flags", async () => {
    await expect(runUpdate(["alpha", "--yes"])).resolves.toBe(EXIT_REFUSED);
    await expect(runUpdate(["--resolved", "x", "--yes"])).resolves.toBe(
      EXIT_REFUSED
    );
    await expect(runUpdate(["--from", "0.7.0", "--yes"])).resolves.toBe(
      EXIT_REFUSED
    );
  });
});

// --- Two releases in the user cache: update -----------------------------------------------

describe("update on the render engine (two releases in the user cache)", () => {
  const OLD = "0.8.0";
  let project: string;
  let cliVersion: string;

  beforeAll(async () => {
    cliVersion = await readVersion();
  });

  async function fillCache(
    cache: string,
    version: string,
    files: Files
  ): Promise<void> {
    const entry = join(cache, "mimukit", `saasaloy@v${version}`);
    await writeTree(join(entry, "modules"), files);
    await cp(await baseTemplateDir(), join(entry, "base"), { recursive: true });
    await writeFile(join(entry, CACHE_COMPLETE), `v${version}\n`);
  }

  beforeEach(async () => {
    const cache = join(workspace, "cache");
    process.env[CACHE_DIR_ENV] = cache;
    await fillCache(cache, OLD, registry(1));
    await fillCache(cache, cliVersion, registry(2));

    // The project as saasaloy 0.8.0 left it: `alpha` at v0.8.0.
    project = join(workspace, "demo");
    await mkdir(project, { recursive: true });
    const options = { projectName: "demo", testingMode: "off" } as const;
    const old = await loadSide(
      { coordinates: new Map(), options, requested: ["alpha"], version: OLD },
      { cliVersion }
    );
    await apply({
      next: old.side,
      provenance: old.provenance,
      root: project,
      version: OLD,
    });
    git(project, "init", "-q");
    commit(project, "init at 0.8.0");
    process.chdir(project);
  });

  it("refuses a dirty tree, and a CLI older than the lock", async () => {
    await writeFile(join(project, "apps/api/src/index.ts"), "// mine\n");
    await expect(runUpdate(["--yes"])).resolves.toBe(EXIT_REFUSED);
    git(project, "checkout", "--", ".");
    const lock = await lockOf(project);
    await writeFile(
      join(project, "saasaloy-lock.json"),
      `${JSON.stringify({ ...lock, base: { ...lock.base, cliVersion: "99.0.0" } }, null, 2)}\n`
    );
    commit(project);
    await expect(runUpdate(["--dry-run"])).resolves.toBe(EXIT_REFUSED);
  });

  it("merges, reports the once file and the deleted file, then --merge, --restore and --done finish the work", async () => {
    // The owner edits the merged file and the once file, and deletes the third file.
    const index = await read(project, "apps/api/src/index.ts");
    await writeFile(
      join(project, "apps/api/src/index.ts"),
      index.replace("export const one = 1;", "export const one = 100;")
    );
    const seed = await read(project, "apps/api/src/seed.ts");
    await writeFile(
      join(project, "apps/api/src/seed.ts"),
      seed.replace("'hi'", "'hello'")
    );
    await unlink(join(project, "apps/api/src/extra.ts"));
    commit(project, "owner edits");

    // A preview writes nothing and prints the report.
    const preview = await captured(() => runUpdate(["--dry-run"]));
    expect(preview.code).toBe(EXIT_OK);
    expect(preview.stdout).toContain("apps/api/src/seed.ts");
    expect((await lockOf(project)).base?.cliVersion).toBe(OLD);

    const first = await captured(() => runUpdate(["--yes"]));
    expect(first.code).toBe(EXIT_WORK_PENDING);
    expect(first.stdout).toContain(`# saasaloy update ${OLD} → ${cliVersion}`);
    expect(first.stdout).toContain("## Written once, changed upstream");
    expect(first.stdout).toContain(
      "saasaloy update --merge apps/api/src/seed.ts"
    );
    expect(first.stdout).toContain("## Left deleted");
    expect(first.stdout).toContain(
      "saasaloy update --restore apps/api/src/extra.ts"
    );
    expect(first.stdout).toContain("### alpha/0001-size: The size doubles");
    expect(first.stdout.trimEnd().split("\n").at(-1)).toContain("pnpm check");
    // The merged file holds both changes; the once file is the owner's.
    const merged = await read(project, "apps/api/src/index.ts");
    expect(merged).toContain("one = 100");
    expect(merged).toContain("three = 33");
    await expect(read(project, "apps/api/src/seed.ts")).resolves.toContain(
      "'hello'"
    );
    await expect(read(project, "apps/api/src/seed.ts")).resolves.toContain(
      "size = 1"
    );
    await expect(
      pathExists(join(project, "apps/api/src/extra.ts"))
    ).resolves.toBeFalsy();
    expect((await lockOf(project)).base?.cliVersion).toBe(cliVersion);
    const manifest = JSON.parse(
      await read(project, ".saasaloy/manifest.json")
    ) as {
      files: Record<string, { version: string }>;
      pendingNotes: { id: string }[];
    };
    expect(manifest.files["apps/api/src/seed.ts"]?.version).toBe(OLD);
    const pending = manifest.pendingNotes.map((note) => note.id);
    expect(pending).toContain("alpha/0001-size");
    commit(project, "update");

    // An unknown note id refuses.
    await expect(
      runUpdate(["--done", "alpha/9999-nope", "--yes"])
    ).resolves.toBe(EXIT_REFUSED);
    // `--merge` takes the base at 0.8.0, the release that wrote the once file.
    const second = await captured(() =>
      runUpdate([
        "--merge",
        "apps/api/src/seed.ts",
        "--restore",
        "apps/api/src/extra.ts",
        ...pending.flatMap((id) => ["--done", id]),
        "--yes",
      ])
    );
    expect(second.code).toBe(EXIT_OK);
    const seedAfter = await read(project, "apps/api/src/seed.ts");
    expect(seedAfter).toContain("'hello'");
    expect(seedAfter).toContain("size = 2");
    expect(seedAfter).not.toContain("<<<<<<<");
    await expect(read(project, "apps/api/src/extra.ts")).resolves.toBe(
      "export const extra = 2;\n"
    );
    const after = JSON.parse(
      await read(project, ".saasaloy/manifest.json")
    ) as {
      files: Record<string, { version: string }>;
      pendingNotes: unknown[];
      doneNotes: string[];
    };
    expect(after.files["apps/api/src/seed.ts"]?.version).toBe(cliVersion);
    expect(after.pendingNotes).toStrictEqual([]);
    expect(after.doneNotes).toContain("alpha/0001-size");
  });

  it("--merge refuses a path that is not a file written once", async () => {
    await expect(
      runUpdate(["--merge", "apps/api/src/index.ts", "--yes"])
    ).resolves.toBe(EXIT_REFUSED);
  });

  it("--abort puts back the files the last update changed", async () => {
    const before = await read(project, "apps/api/src/index.ts");
    await expect(runUpdate(["--yes"])).resolves.toBe(EXIT_WORK_PENDING);
    await expect(read(project, "apps/api/src/index.ts")).resolves.not.toBe(
      before
    );
    await expect(runUpdate(["--abort"])).resolves.toBe(EXIT_OK);
    await expect(read(project, "apps/api/src/index.ts")).resolves.toBe(before);
    expect((await lockOf(project)).base?.cliVersion).toBe(OLD);
  });

  it("converts a version 1 project, then updates it, and --abort restores version 1 (plan 0116, Phase 5)", async () => {
    // Every other old-engine release is a cache entry that cannot load, so the conversion
    // searches 0.8.0 and the running release and reads no network.
    const cache = process.env[CACHE_DIR_ENV] ?? "";
    const { OLD_ENGINE_RELEASES } = await import("../engine/convert.js");
    for (const release of OLD_ENGINE_RELEASES) {
      const entry = join(cache, "mimukit", `saasaloy@v${release}`);
      if (release !== OLD && release !== cliVersion) {
        await mkdir(entry, { recursive: true });
        await writeFile(join(entry, CACHE_COMPLETE), `v${release}\n`);
      }
    }

    // The state the old engine left: a version 1 manifest, and a lock with no
    // `requested` list. Each file is recorded by the hash of the bytes it copied.
    const v2 = JSON.parse(await read(project, ".saasaloy/manifest.json")) as {
      files: Record<
        string,
        { module: string; from: string; hash: string; class: string }
      >;
    };
    const managed = Object.fromEntries(
      Object.entries(v2.files).map(([path, record]) => [
        path,
        {
          from: record.from,
          hash: record.hash,
          module: record.module,
          ...(record.module !== "base" && record.class === "once"
            ? { seed: true }
            : {}),
        },
      ])
    );
    await writeFile(
      join(project, ".saasaloy/manifest.json"),
      `${JSON.stringify({ links: {}, managed, patches: [], removeWarnings: {} }, null, 2)}\n`
    );
    const { requested: _requested, ...oldLock } = await lockOf(project);
    await writeFile(
      join(project, "saasaloy-lock.json"),
      `${JSON.stringify(oldLock, null, 2)}\n`
    );
    const index = await read(project, "apps/api/src/index.ts");
    await writeFile(
      join(project, "apps/api/src/index.ts"),
      index.replace("export const one = 1;", "export const one = 100;")
    );
    commit(project, "the old engine's state");
    const v1Manifest = await read(project, ".saasaloy/manifest.json");
    const v1Lock = await read(project, "saasaloy-lock.json");

    // A preview converts in memory and writes nothing.
    const preview = await captured(() => runUpdate(["--dry-run"]));
    expect(preview.code).toBe(EXIT_OK);
    await expect(read(project, ".saasaloy/manifest.json")).resolves.toBe(
      v1Manifest
    );

    const run = await captured(() => runUpdate(["--yes"]));
    expect(run.code).toBe(EXIT_WORK_PENDING);
    const merged = await read(project, "apps/api/src/index.ts");
    expect(merged).toContain("one = 100");
    expect(merged).toContain("three = 33");
    expect(merged).not.toContain("<<<<<<<");
    const after = JSON.parse(
      await read(project, ".saasaloy/manifest.json")
    ) as {
      version: number;
      files: Record<string, { version: string; class: string }>;
    };
    expect(after.version).toBe(2);
    expect(after.files["apps/api/src/index.ts"]?.version).toBe(cliVersion);
    expect(after.files["apps/api/src/seed.ts"]).toMatchObject({
      class: "once",
      version: OLD,
    });
    const lock = await lockOf(project);
    expect(lock.requested).toStrictEqual(["alpha"]);
    expect(lock.base?.cliVersion).toBe(cliVersion);

    // The run's backup holds the version 1 files, so --abort returns to them.
    await expect(runUpdate(["--abort"])).resolves.toBe(EXIT_OK);
    await expect(read(project, ".saasaloy/manifest.json")).resolves.toBe(
      v1Manifest
    );
    await expect(read(project, "saasaloy-lock.json")).resolves.toBe(v1Lock);
  });

  it("add and remove refuse a version 1 project and name update", async () => {
    await writeFile(
      join(project, ".saasaloy/manifest.json"),
      `${JSON.stringify({ links: {}, managed: {}, patches: [], removeWarnings: {} }, null, 2)}\n`
    );
    commit(project, "the old engine's state");
    const add = await captured(() => runAdd(["alpha", "--yes"]));
    expect(add.code).toBe(EXIT_REFUSED);
  });
});

afterAll(() => {
  process.chdir(ORIGINAL_CWD);
});

describe(demoteHeadings, () => {
  it("nests a note's headings under its own and leaves a fenced block alone", () => {
    const body = "## What you do\n\n```md\n## not a heading\n```\n\n### Step\n";

    expect(demoteHeadings(body, 4)).toBe(
      "#### What you do\n\n```md\n## not a heading\n```\n\n##### Step\n"
    );
  });

  it("caps a heading at level 6 and leaves a body with no heading as it is", () => {
    expect(demoteHeadings("## A\n###### B\n", 5)).toBe("##### A\n###### B\n");
    expect(demoteHeadings("plain text\n", 4)).toBe("plain text\n");
  });
});
