import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import type { Plan, PlannedFile } from "../lib/applier.js";
import { pathExists } from "../lib/fs-utils.js";
import { emptyLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { emptyManifest } from "../lib/manifest.js";
import type { Manifest } from "../lib/manifest.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import type { RegistrySource } from "../lib/registry.js";
import type { Graph } from "../lib/resolve.js";
import { stripAnsi } from "../lib/tui.js";
import {
  applyAndPersist,
  envSteps,
  formatIncomplete,
  formatRecovery,
  parseArgs,
  persistState,
  pinToLock,
  runAdd,
} from "./add.js";

// `add` with no module opens a picker. Without a terminal that prompt can never be
// answered, so it has to fail fast instead of hanging a pipeline — and it has to do so
// before the registry is fetched, which is what keeps this test offline.

const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
const ORIGINAL_CWD = process.cwd();

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-add-tty-"));
  // A real project root, so the command reaches the picker branch rather than bailing
  // out earlier on "no saasaloy.json found".
  await writeFile(
    join(dir, "saasaloy.json"),
    JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
    "utf-8"
  );
  process.chdir(dir);
});

afterEach(() => {
  process.stdin.isTTY = ORIGINAL_STDIN_TTY;
  process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(dir, { recursive: true, force: true });
});

// clack writes its rail straight to the stream; capture it to read the cancel message.
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  return {
    lines,
    restore() {
      process.stdout.write = originalWrite;
    },
  };
}

describe("runAdd without a module name", () => {
  it("fails with the usage line instead of opening a prompt nobody can answer", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const captured = capture();
    let code: number;
    try {
      code = await runAdd([]);
    } finally {
      captured.restore();
    }
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("saasaloy add [<module>");
  });

  it("also refuses when only stdout is redirected", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const captured = capture();
    let code: number;
    try {
      code = await runAdd([]);
    } finally {
      captured.restore();
    }
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("saasaloy add [<module>");
  });
});

// #98 Phase 4. `add` used to merge npm deps into package.json *before* executePlan ran,
// so a mid-plan write failure left a project whose package.json advertised packages no
// module had actually installed. The write now trails a successful apply. The rollback
// journal for everything executePlan itself writes stays deferred in #49.
describe("runAdd — dependency write ordering (#98)", () => {
  let project: string;
  let registry: string;
  let outside: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-add-deps-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-add-reg-"));
    outside = await mkdtemp(join(tmpdir(), "saasaloy-add-out-"));

    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
      "utf-8"
    );
    await writeFile(
      join(project, "package.json"),
      `${JSON.stringify({ name: "proj", dependencies: {} }, null, 2)}\n`,
      "utf-8"
    );
    // The apply fails on the guard `remover` and `updater` already carry: the alias
    // prefix is a symlink, so following it would carry the write out of the project.
    await mkdir(join(project, "apps"), { recursive: true });
    await symlink(outside, join(project, "apps", "web"), "dir");

    const mod = join(registry, "widget");
    await mkdir(join(mod, "files"), { recursive: true });
    await writeFile(
      join(mod, "registry-item.json"),
      JSON.stringify({
        name: "widget",
        type: "saasaloy:feature",
        dependencies: ["zod@4.4.3"],
        files: [{ path: "files/widget.ts", target: "@web/widget.ts" }],
      }),
      "utf-8"
    );
    await writeFile(
      join(mod, "files", "widget.ts"),
      "export const x = 1;\n",
      "utf-8"
    );

    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("leaves package.json untouched when the apply fails", async () => {
    const before = await readFile(join(project, "package.json"), "utf-8");
    const captured = capture();
    let code: number;
    try {
      code = await runAdd(["widget", "--yes"]);
    } finally {
      captured.restore();
    }

    // The symlink guard is a refusal, not a crash — exit 2 (#98's 0/1/2 scheme).
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("symlink");
    await expect(
      readFile(join(project, "package.json"), "utf-8")
    ).resolves.toBe(before);
  });

  it("writes the dependency once the apply succeeds", async () => {
    await rm(join(project, "apps", "web"));
    await mkdir(join(project, "apps", "web"), { recursive: true });
    const captured = capture();
    let code: number;
    try {
      code = await runAdd(["widget", "--yes"]);
    } finally {
      captured.restore();
    }

    expect(code).toBe(0);
    const pkg = JSON.parse(
      await readFile(join(project, "package.json"), "utf-8")
    ) as { dependencies: Record<string, string> };
    expect(pkg.dependencies.zod).toBe("4.4.3");
  });
});

// #62. A module's UI is a block in the ui package, and nothing places it: `add` writes
// the file and points at the module's skill, whose Wire-up section carries the import and
// the tag. The `@ui/blocks/` target is the only signal, so a module that ships such a file
// without a skill has nowhere to put those steps — say so rather than apply in silence.
describe("runAdd — ui block wire-up pointer (#62)", () => {
  let project: string;
  let registry: string;

  async function writeModule(withSkill: boolean): Promise<void> {
    const mod = join(registry, "widget");
    await mkdir(join(mod, "files", "blocks"), { recursive: true });
    await writeFile(
      join(mod, "registry-item.json"),
      JSON.stringify({
        name: "widget",
        type: "saasaloy:feature",
        files: [
          { path: "files/blocks/widget.tsx", target: "@ui/blocks/widget.tsx" },
          { path: "files/blocks/widget.tsx", target: "@ui/types/widget.d.ts" },
        ],
        ...(withSkill ? { agent: { skills: ["skills/saasaloy-widget"] } } : {}),
      }),
      "utf-8"
    );
    await writeFile(
      join(mod, "files", "blocks", "widget.tsx"),
      "export const Widget = () => null;\n",
      "utf-8"
    );
    if (withSkill) {
      await mkdir(join(mod, "skills", "saasaloy-widget"), { recursive: true });
      await writeFile(
        join(mod, "skills", "saasaloy-widget", "SKILL.md"),
        "# widget\n\n## Wire-up\n\nImport it.\n",
        "utf-8"
      );
    }
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-add-block-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-add-block-reg-"));
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({
        aliases: { "@ui": "packages/ui/src" },
        installed: [],
      }),
      "utf-8"
    );
    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string }> {
    const captured = capture();
    try {
      return { code: await runAdd(args), out: captured.lines.join("") };
    } finally {
      captured.restore();
    }
  }

  it("names the block and points at the module's skill", async () => {
    await writeModule(true);
    const { code, out } = await run(["widget", "--yes"]);

    expect(code).toBe(0);
    expect(out).toContain("/saasaloy-widget");
    // The wire-up line names the block and only the block — the non-block file of the
    // same module is not a wire-up step.
    const wireUpTargets = out
      .split("Manual wire-up needed — ")[1]
      ?.split(" on disk")[0];
    expect(wireUpTargets).toContain("packages/ui/src/blocks/widget.tsx");
    expect(wireUpTargets).not.toContain("widget.d.ts");
  });

  it("warns when a block arrives from a module that ships no skill", async () => {
    await writeModule(false);
    const { code, out } = await run(["widget", "--yes"]);

    // The file still applies — the convention is missing its instructions, which is the
    // module author's bug, not a reason to refuse the user's install.
    expect(code).toBe(0);
    expect(out).toContain("widget");
    expect(out).toContain("no skill");
    await expect(
      pathExists(join(project, "packages", "ui", "src", "blocks", "widget.tsx"))
    ).resolves.toBeTruthy();
  });

  it("says nothing about wire-up when no block is written", async () => {
    const mod = join(registry, "plain");
    await mkdir(join(mod, "files"), { recursive: true });
    await writeFile(
      join(mod, "registry-item.json"),
      JSON.stringify({
        name: "plain",
        type: "saasaloy:feature",
        files: [{ path: "files/x.ts", target: "@ui/lib/x.ts" }],
      }),
      "utf-8"
    );
    await writeFile(
      join(mod, "files", "x.ts"),
      "export const x = 1;\n",
      "utf-8"
    );

    const { code, out } = await run(["plain", "--yes"]);

    expect(code).toBe(0);
    expect(out).not.toContain("Manual wire-up");
  });
});

// #99 Phase 1, from the outside: the plan a user reads has to say which variant it
// picked, because two descriptor entries share one target and the target alone no longer
// identifies the file. And a project no variant matches is refused, not half-applied.
describe("runAdd — onlyWith variants (#99)", () => {
  let project: string;
  let registry: string;

  async function writeProject(installed: string[]): Promise<void> {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed }),
      "utf-8"
    );
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-add-cond-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-add-cond-reg-"));
    await writeProject(["database-d1"]);

    const mod = join(registry, "waitlist");
    await mkdir(join(mod, "files"), { recursive: true });
    await writeFile(
      join(mod, "registry-item.json"),
      JSON.stringify({
        name: "waitlist",
        type: "saasaloy:feature",
        files: [
          {
            path: "files/schema.sqlite.ts",
            target: "@web/schema.ts",
            onlyWith: "database-d1",
          },
          {
            path: "files/schema.pg.ts",
            target: "@web/schema.ts",
            onlyWith: "database-postgres",
          },
          { path: "files/route.ts", target: "@web/route.ts" },
        ],
      }),
      "utf-8"
    );
    await writeFile(
      join(mod, "files", "schema.sqlite.ts"),
      "sqlite\n",
      "utf-8"
    );
    await writeFile(join(mod, "files", "schema.pg.ts"), "pg\n", "utf-8");
    await writeFile(join(mod, "files", "route.ts"), "route\n", "utf-8");

    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string }> {
    const captured = capture();
    try {
      return { code: await runAdd(args), out: captured.lines.join("") };
    } finally {
      captured.restore();
    }
  }

  it("names the chosen variant on the plan line and leaves the rest alone", async () => {
    const { code, out } = await run(["waitlist", "--dry-run", "--yes"]);

    expect(code).toBe(0);
    expect(out).toContain("apps/web/schema.ts (files/schema.sqlite.ts)");
    // An unconditional file's line is what it always was: the target, and nothing after
    // it but the box's own padding.
    expect(out).toMatch(/create {2}apps\/web\/route\.ts +│/);
    expect(out).not.toContain("route.ts (files/route.ts)");
  });

  it("names the chosen variant on the --diff heading too", async () => {
    const { out } = await run(["waitlist", "--diff", "--yes"]);

    expect(out).toContain("apps/web/schema.ts (files/schema.sqlite.ts)");
  });

  it("refuses a project no variant matches, and writes nothing", async () => {
    await writeProject([]);
    const { code, out } = await run(["waitlist", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("apps/web/schema.ts");
    expect(out).toContain("files/schema.sqlite.ts");
    expect(out).toContain("database-postgres");
    // The unconditional file of the same module: the refusal lands before `executePlan`,
    // so not even the entries that did match are on disk.
    await expect(
      pathExists(join(project, "apps", "web", "route.ts"))
    ).resolves.toBeFalsy();
  });
});

// Argument parsing, on its own. Every rejection below is the difference between a typo
// running as though it were nothing and a typo being reported, and reaching them through
// a whole apply would need a registry these cases never get to.
describe("add — parseArgs", () => {
  it("reads the module name off the first positional", () => {
    expect(parseArgs(["waitlist"])).toMatchObject({
      name: "waitlist",
      unknown: [],
    });
  });

  it("defaults every flag to off", () => {
    expect(parseArgs(["waitlist"])).toMatchObject({
      diff: false,
      dryRun: false,
      force: false,
      yes: false,
    });
  });

  it("reads every flag it knows, in any position", () => {
    expect(
      parseArgs(["--diff", "waitlist", "--force", "--dry-run", "-y"])
    ).toMatchObject({
      diff: true,
      dryRun: true,
      force: true,
      name: "waitlist",
      unknown: [],
      yes: true,
    });
  });

  it("takes --yes and -y as the same flag", () => {
    expect(parseArgs(["waitlist", "--yes"]).yes).toBeTruthy();
    expect(parseArgs(["waitlist", "-y"]).yes).toBeTruthy();
  });

  it("reports a flag it does not know rather than ignoring it", () => {
    expect(parseArgs(["waitlist", "--forse"]).unknown).toStrictEqual([
      "--forse",
    ]);
  });

  it("reports a second positional as an extra argument", () => {
    expect(parseArgs(["waitlist", "email"]).unknown).toStrictEqual(["email"]);
    expect(parseArgs(["waitlist", "email"]).name).toBe("waitlist");
  });

  it("reports every unknown flag and every extra positional together", () => {
    expect(
      parseArgs(["waitlist", "--forse", "email", "--dr-run"]).unknown
    ).toStrictEqual(["--forse", "--dr-run", "email"]);
  });

  it("keeps --help out of the unknown list, so help can answer it", () => {
    expect(parseArgs(["--help"]).unknown).toStrictEqual([]);
    expect(parseArgs(["-h"]).unknown).toStrictEqual([]);
  });

  it("carries every coordinate form through as the name, unparsed", () => {
    for (const coord of [
      "waitlist",
      "owner/repo/waitlist",
      "owner/repo@v2/waitlist",
      "owner/repo",
    ]) {
      expect(parseArgs([coord]).name).toBe(coord);
    }
  });

  it("leaves the name undefined when nothing is named", () => {
    expect(parseArgs([]).name).toBeUndefined();
    expect(parseArgs(["--dry-run"]).name).toBeUndefined();
  });
});

// ADR 0012: a named remote add re-installs the bytes the lock recorded, so the same
// coordinate keeps resolving to the same SHA. Three conditions hold the pin back, and
// each one is the user asking for something else.
describe("add — pinToLock", () => {
  const SHA = "a".repeat(40);

  function lockWith(entry: Partial<Lockfile["modules"][string]>): Lockfile {
    const lock = emptyLock();
    lock.modules.waitlist = {
      ref: "main",
      resolved: SHA,
      source: "mimukit/saasaloy",
      ...entry,
    };
    return lock;
  }

  afterEach(() => {
    delete process.env[REGISTRY_ENV];
  });

  it("pins a bare name to the SHA the lock recorded for the default repo", () => {
    expect(pinToLock({ module: "waitlist" }, lockWith({}))).toStrictEqual({
      module: "waitlist",
      ref: SHA,
    });
  });

  it("pins an explicit owner/repo when the lock's source matches it", () => {
    const coord = { module: "waitlist", owner: "acme", repo: "kit" };
    expect(pinToLock(coord, lockWith({ source: "acme/kit" })).ref).toBe(SHA);
  });

  it("does not pin when the lock recorded a different source", () => {
    const coord = { module: "waitlist", owner: "acme", repo: "kit" };
    expect(pinToLock(coord, lockWith({})).ref).toBeUndefined();
  });

  it("does not pin when SAASALOY_REGISTRY_DIR points at a working copy", () => {
    process.env[REGISTRY_ENV] = "/tmp/modules";
    expect(pinToLock({ module: "waitlist" }, lockWith({})).ref).toBeUndefined();
  });

  it("does not pin over an explicit @ref — that is how a user moves off the lock", () => {
    expect(pinToLock({ module: "waitlist", ref: "v2" }, lockWith({})).ref).toBe(
      "v2"
    );
  });

  it("does not pin an entry installed from a local checkout, which has no SHA", () => {
    expect(
      pinToLock({ module: "waitlist" }, lockWith({ resolved: "local" })).ref
    ).toBeUndefined();
  });

  it("does not pin a module the lock has never seen", () => {
    expect(pinToLock({ module: "email" }, lockWith({})).ref).toBeUndefined();
  });

  it("leaves a picker coordinate alone — there is no module to pin", () => {
    expect(
      pinToLock({ owner: "acme", repo: "kit" }, lockWith({}))
    ).toStrictEqual({ owner: "acme", repo: "kit" });
  });
});

// `--force` means "re-apply this module", not "re-apply everything it depends on". The
// distinction is invisible in the log and visible on disk, so the test deletes both
// modules' files and reads back which one returned.
describe("runAdd — --force and the already-installed early return", () => {
  let project: string;
  let registry: string;

  const widgetFile = () => join(project, "apps", "web", "widget.ts");
  const baseFile = () => join(project, "apps", "web", "base.ts");

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-add-force-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-add-force-reg-"));
    await mkdir(join(project, "apps", "web"), { recursive: true });

    for (const [name, dependsOn] of [
      ["base", []],
      ["widget", ["base"]],
    ] as const) {
      const mod = join(registry, name);
      await mkdir(join(mod, "files"), { recursive: true });
      await writeFile(
        join(mod, "registry-item.json"),
        JSON.stringify({
          name,
          type: "saasaloy:feature",
          dependsOn: [...dependsOn],
          files: [{ path: `files/${name}.ts`, target: `@web/${name}.ts` }],
        }),
        "utf-8"
      );
      await writeFile(join(mod, "files", `${name}.ts`), `${name}\n`, "utf-8");
    }

    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
      "utf-8"
    );
    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string }> {
    const captured = capture();
    try {
      return { code: await runAdd(args), out: captured.lines.join("") };
    } finally {
      captured.restore();
    }
  }

  it("installs the prerequisite ahead of the module that needs it", async () => {
    const { code, out } = await run(["widget", "--yes"]);

    expect(code).toBe(0);
    expect(out).toContain("will install: base");
    await expect(pathExists(baseFile())).resolves.toBeTruthy();
    await expect(pathExists(widgetFile())).resolves.toBeTruthy();
  });

  it("says there is nothing to do when everything is already installed", async () => {
    await run(["widget", "--yes"]);
    await rm(widgetFile());

    const { code, out } = await run(["widget", "--yes"]);

    expect(code).toBe(0);
    expect(out).toContain("Nothing to do");
    expect(out).toContain("use --force to re-apply");
    // The early return is before the plan, so the deleted file stays deleted.
    await expect(pathExists(widgetFile())).resolves.toBeFalsy();
  });

  it("re-applies only the requested module under --force", async () => {
    await run(["widget", "--yes"]);
    await rm(widgetFile());
    await rm(baseFile());

    const { code, out } = await run(["widget", "--force", "--yes"]);

    expect(code).toBe(0);
    expect(out).toContain("already installed (skipped): base");
    await expect(pathExists(widgetFile())).resolves.toBeTruthy();
    // The dependency is installed and not requested, so `--force` leaves it alone.
    await expect(pathExists(baseFile())).resolves.toBeFalsy();
  });

  it("re-applies the dependency when the dependency is the one requested", async () => {
    await run(["widget", "--yes"]);
    await rm(baseFile());

    const { code } = await run(["base", "--force", "--yes"]);

    expect(code).toBe(0);
    await expect(pathExists(baseFile())).resolves.toBeTruthy();
  });

  it("refuses an unknown flag before it reaches the registry", async () => {
    const { code, out } = await run(["widget", "--forse", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): --forse");
    await expect(pathExists(widgetFile())).resolves.toBeFalsy();
  });

  it("refuses an extra positional", async () => {
    const { code, out } = await run(["widget", "base", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): base");
  });

  it("refuses a malformed coordinate", async () => {
    const { code, out } = await run(["a/b/c/d", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("Malformed coordinate");
  });

  it("warns that the registry override ignores an explicit owner/repo", async () => {
    const { code, out } = await run(["acme/kit/widget", "--yes"]);

    expect(code).toBe(0);
    expect(out).toContain("Ignoring source");
  });

  it("writes nothing under --dry-run", async () => {
    const { code, out } = await run(["widget", "--dry-run"]);

    expect(code).toBe(0);
    expect(out).toContain("dry run — nothing applied");
    await expect(pathExists(widgetFile())).resolves.toBeFalsy();
    await expect(
      pathExists(join(project, ".saasaloy", "manifest.json"))
    ).resolves.toBeFalsy();
  });

  it("writes nothing under --diff", async () => {
    const { code, out } = await run(["widget", "--diff"]);

    expect(code).toBe(0);
    expect(out).toContain("diff only — nothing applied");
    await expect(pathExists(widgetFile())).resolves.toBeFalsy();
  });
});

// `requires.saasaloy` at the command level (#50): the range is checked against the
// running CLI before a plan is built, so a refusal leaves the project byte-identical.
// The CLI's own version is 0.0.0, which is why `>=0.3` is the unsatisfiable case here
// and `>=0.0.0` is the satisfiable one.
describe("runAdd — a descriptor's requires.saasaloy", () => {
  let project: string;
  let registry: string;

  async function writeModule(
    name: string,
    extra: Record<string, unknown> = {}
  ): Promise<void> {
    const mod = join(registry, name);
    await mkdir(join(mod, "files"), { recursive: true });
    await writeFile(
      join(mod, "registry-item.json"),
      JSON.stringify({
        name,
        type: "saasaloy:feature",
        files: [{ path: "files/a.ts", target: `@web/${name}.ts` }],
        ...extra,
      }),
      "utf-8"
    );
    await writeFile(
      join(mod, "files", "a.ts"),
      `export const ${name} = 1;\n`,
      "utf-8"
    );
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-add-requires-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-add-requires-reg-"));
    await mkdir(join(project, "apps", "web"), { recursive: true });
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
      "utf-8"
    );
    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string }> {
    const captured = capture();
    try {
      return { code: await runAdd(args), out: captured.lines.join("") };
    } finally {
      captured.restore();
    }
  }

  it("applies a module whose range this CLI satisfies", async () => {
    await writeModule("widget", { requires: { saasaloy: ">=0.0.0" } });
    const { code } = await run(["widget", "--yes"]);

    expect(code).toBe(0);
    await expect(
      pathExists(join(project, "apps", "web", "widget.ts"))
    ).resolves.toBeTruthy();
  });

  it("refuses a module whose range this CLI fails, and writes nothing", async () => {
    await writeModule("widget", { requires: { saasaloy: ">=0.3" } });
    const { code, out } = await run(["widget", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("widget");
    expect(out).toContain(">=0.3");
    expect(out).toContain("0.0.0 is installed");
    expect(out).toContain("pnpm add --global saasaloy@latest");
    await expect(
      pathExists(join(project, "apps", "web", "widget.ts"))
    ).resolves.toBeFalsy();
  });

  it("is fatal for a transitive dependency, naming the module in the chain", async () => {
    await writeModule("b", { requires: { saasaloy: ">=0.3" } });
    await writeModule("a", { dependsOn: ["b"] });
    const { code, out } = await run(["a", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("b (required by a)");
    // Neither the prerequisite nor the requested module landed.
    await expect(
      pathExists(join(project, "apps", "web", "b.ts"))
    ).resolves.toBeFalsy();
    await expect(
      pathExists(join(project, "apps", "web", "a.ts"))
    ).resolves.toBeFalsy();
  });

  it.each([">=0.0.0", ">=0.0.0 <2", "^0.0.0", "0.x", "*"])(
    "accepts the range %j, upper bounds included",
    async (range) => {
      await writeModule("widget", { requires: { saasaloy: range } });
      const { code } = await run(["widget", "--yes"]);
      expect(code).toBe(0);
    }
  );

  it("refuses a range it cannot parse rather than applying the module", async () => {
    await writeModule("widget", { requires: { saasaloy: ">=nope" } });
    const { code, out } = await run(["widget", "--yes"]);

    expect(code).toBe(2);
    expect(out).toContain("isn't a semver range");
    await expect(
      pathExists(join(project, "apps", "web", "widget.ts"))
    ).resolves.toBeFalsy();
  });
});

// #50: the next-steps note used to end at "copy .dev.vars.example and fill it in", which
// was the only instruction and was wrong for a `PUBLIC_*` value. It now names the command
// that does the work.
describe(envSteps, () => {
  it("points at `saasaloy env` rather than a hand copy", () => {
    const out = stripAnsi(
      envSteps(
        ["PUBLIC_API_URL", "BETA_URL"],
        "apps/api/.dev.vars.example"
      ).join("\n")
    );

    expect(out).toContain("saasaloy env");
    expect(out).not.toContain("copy it to");
  });

  it("still lists the variable names, sorted", () => {
    const out = stripAnsi(envSteps(["PUBLIC_API_URL", "BETA_URL"], "")[0]!);

    expect(out).toBe("Set BETA_URL, PUBLIC_API_URL.");
  });

  it("keeps the example file as the record of what each one means", () => {
    const out = stripAnsi(
      envSteps(["BETA_URL"], "apps/api/.dev.vars.example")[1]!
    );

    expect(out).toContain("apps/api/.dev.vars.example");
    expect(out).toContain("description");
  });

  it("says nothing when the plan declares no variable", () => {
    expect(envSteps([], "apps/api/.dev.vars.example")).toStrictEqual([]);
  });
});

// #49. A run that leaves a module uninstalled has to say so. Nothing failed and the run
// exits 0, so the only signal the user gets is this line: which module missed out, and
// the command that finishes it.
describe("add — formatIncomplete", () => {
  it("names the module and the re-run that completes it", () => {
    const line = stripAnsi(formatIncomplete(["widget"], "widget"));

    expect(line).toContain("widget is not installed");
    expect(line).toContain("saasaloy add widget");
  });

  it("points an incomplete dependency at the module the user asked for", () => {
    const line = stripAnsi(formatIncomplete(["api", "database"], "waitlist"));

    expect(line).toContain("api, database are not installed");
    expect(line).toContain("saasaloy add waitlist");
    expect(line).toContain("complete them");
  });
});

// #49. The state files leave `add` through one path on the way out of an apply, failed or
// not. That path used to be a bare sequence: `upsertLock` first, then three unguarded
// saves. `source.provenance()` throws when the source resolved no commit SHA, so an
// unresolvable remote cost the user the manifest and the config too, and reported itself
// in place of whatever really went wrong. Each step now stands or falls alone.
const PERSIST_SHA = "b".repeat(40);

/** A source that never resolved a commit SHA — `provenance()` is a throw, not a value. */
function unresolvedSource(): Pick<RegistrySource, "provenance"> {
  return {
    provenance: () => {
      throw new Error(
        "provenance() called before the source resolved a commit SHA."
      );
    },
  };
}

function resolvedSource(): Pick<RegistrySource, "provenance"> {
  return {
    provenance: () => ({
      ref: "main",
      resolved: PERSIST_SHA,
      source: "acme/kit",
    }),
  };
}

/** A one-module plan carrying nothing but the files under test. */
function planOf(files: PlannedFile[]): Plan {
  return {
    aliasConflicts: [],
    aliases: {},
    alreadyInstalled: [],
    dependencies: [],
    devDependencies: [],
    devVars: {},
    envVars: {},
    files,
    install: ["widget"],
    links: [],
    patches: [],
    removeWarnings: {},
    staleOwners: [],
  };
}

describe("persistState — the finally path (#49)", () => {
  let root: string;

  const GRAPH: Graph = { modules: new Map(), order: [] };

  function input(
    source: Pick<RegistrySource, "provenance">
  ): Parameters<typeof persistState>[0] {
    const manifest = emptyManifest();
    manifest.managed["apps/web/widget.ts"] = {
      from: "files/widget.ts",
      hash: "h",
      module: "widget",
    };
    return {
      completed: ["widget"],
      config: { aliases: { "@web": "apps/web" }, installed: ["widget"] },
      graph: GRAPH,
      lock: emptyLock(),
      manifest,
      root,
      source,
    };
  }

  async function readJson<T>(name: string): Promise<T> {
    return JSON.parse(await readFile(join(root, name), "utf-8")) as T;
  }

  /** The manifest's keys carry dots, which `toHaveProperty` reads as a path. */
  async function managedModule(): Promise<string | undefined> {
    const manifest = await readJson<Manifest>(
      join(".saasaloy", "manifest.json")
    );
    return manifest.managed["apps/web/widget.ts"]?.module;
  }

  async function persist(
    args: Parameters<typeof persistState>[0]
  ): Promise<{ failures: unknown[]; out: string }> {
    const captured = capture();
    try {
      return {
        failures: await persistState(args),
        out: captured.lines.join(""),
      };
    } finally {
      captured.restore();
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-add-persist-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes all three files when nothing is wrong", async () => {
    const { failures } = await persist(input(resolvedSource()));

    expect(failures).toStrictEqual([]);
    await expect(managedModule()).resolves.toBe("widget");
    await expect(
      readJson<Lockfile>("saasaloy-lock.json")
    ).resolves.toHaveProperty("modules.widget.resolved", PERSIST_SHA);
  });

  it("skips the lock entry when the source resolved no commit SHA", async () => {
    const { failures, out } = await persist(input(unresolvedSource()));

    // The manifest and the config still describe what landed — that is the whole point of
    // the pass. A lock entry is a pin, not a record of disk, so having none is correct.
    await expect(managedModule()).resolves.toBe("widget");
    await expect(
      readJson<{ installed: string[] }>("saasaloy.json")
    ).resolves.toHaveProperty("installed", ["widget"]);
    await expect(
      readJson<Lockfile>("saasaloy-lock.json")
    ).resolves.toHaveProperty("modules", {});
    expect(failures).toHaveLength(1);
    expect(stripAnsi(out)).toContain("saasaloy-lock.json");
  });

  it("writes the config and the lock when the manifest cannot be written", async () => {
    // A regular file where the manifest's directory belongs: `mkdir` refuses it.
    await writeFile(join(root, ".saasaloy"), "not a directory\n", "utf-8");

    const { failures, out } = await persist(input(resolvedSource()));

    expect(failures).toHaveLength(1);
    expect(stripAnsi(out)).toContain("manifest.json");
    await expect(
      readJson<{ installed: string[] }>("saasaloy.json")
    ).resolves.toHaveProperty("installed", ["widget"]);
    await expect(
      readJson<Lockfile>("saasaloy-lock.json")
    ).resolves.toHaveProperty("modules.widget.resolved", PERSIST_SHA);
  });

  it("reports every failure and still throws none", async () => {
    await writeFile(join(root, ".saasaloy"), "not a directory\n", "utf-8");
    await mkdir(join(root, "saasaloy.json"));
    await mkdir(join(root, "saasaloy-lock.json"));

    const { failures } = await persist(input(unresolvedSource()));

    expect(failures).toHaveLength(4);
  });
});

// #49. `applyAndPersist` is the seam the apply and the bookkeeping share: whatever the
// plan managed to do is recorded, and the error the user hears about is the one that
// actually stopped the run.
describe("applyAndPersist (#49)", () => {
  let root: string;
  let outside: string;

  function file(target: string): PlannedFile {
    return {
      action: "create",
      content: "export const x = 1;\n",
      from: "files/widget.ts",
      isSkill: false,
      module: "widget",
      newHash: "h",
      source: join(outside, "widget.ts"),
      target,
      targetAbs: join(root, target),
    };
  }

  async function run(
    p: Plan,
    source: Pick<RegistrySource, "provenance"> = unresolvedSource()
  ): Promise<{ error: unknown; out: string }> {
    const captured = capture();
    try {
      await applyAndPersist({
        config: { aliases: { "@web": "apps/web" }, installed: [] },
        graph: { modules: new Map(), order: [] },
        lock: emptyLock(),
        manifest: emptyManifest(),
        plan: p,
        root,
        source,
      });
      return { error: undefined, out: captured.lines.join("") };
    } catch (error) {
      return { error, out: captured.lines.join("") };
    } finally {
      captured.restore();
    }
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-add-apply-"));
    outside = await mkdtemp(join(tmpdir(), "saasaloy-add-apply-out-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  it("reports the apply error, not the unresolved provenance behind it", async () => {
    // The apply fails on the guard the alias symlink trips; the source carries no SHA
    // either, so both steps have something to throw. Only the first one is the answer.
    await mkdir(join(root, "apps"), { recursive: true });
    await symlink(outside, join(root, "apps", "web"), "dir");

    const { error } = await run(planOf([file("apps/web/widget.ts")]));

    expect(stripAnsi(String(error))).toContain("symlink");
    expect(String(error)).not.toContain("provenance()");
  });

  it("records what landed before the throw", async () => {
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await mkdir(join(root, "apps", "api"), { recursive: true });
    await symlink(outside, join(root, "apps", "api", "src"), "dir");

    const { error } = await run(
      planOf([file("apps/web/widget.ts"), file("apps/api/src/widget.ts")])
    );

    expect(error).toBeDefined();
    const manifest = JSON.parse(
      await readFile(join(root, ".saasaloy", "manifest.json"), "utf-8")
    ) as Manifest;
    // The file that landed is tracked; the one that never got written is not. An untracked
    // written file would plan as a conflict next run.
    expect(Object.keys(manifest.managed)).toStrictEqual(["apps/web/widget.ts"]);
    // A run that threw installs nothing, so it pins nothing either.
    expect(
      (
        JSON.parse(await readFile(join(root, "saasaloy.json"), "utf-8")) as {
          installed: string[];
        }
      ).installed
    ).toStrictEqual([]);
  });

  it("fails the run when a save fails on an otherwise clean apply", async () => {
    await mkdir(join(root, "apps", "web"), { recursive: true });
    await writeFile(join(root, ".saasaloy"), "not a directory\n", "utf-8");

    const { error } = await run(planOf([file("apps/web/widget.ts")]), {
      provenance: () => ({
        ref: "main",
        resolved: "c".repeat(40),
        source: "acme/kit",
      }),
    });

    expect(stripAnsi(String(error))).toContain(".saasaloy");
    // The file itself did land — there is no rollback, and the manifest is what's missing.
    await expect(
      pathExists(join(root, "apps", "web", "widget.ts"))
    ).resolves.toBeTruthy();
  });
});

// #49. `add` has no rollback: a mid-apply failure leaves whatever landed on disk, and the
// state files are written to describe it. The run used to close on the bare error, so the
// user was left to guess whether the project was half-installed and what to do about it.
describe("runAdd — recovery instruction (#49)", () => {
  let project: string;
  let registry: string;
  let outside: string;

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-add-recover-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-add-recover-reg-"));
    outside = await mkdtemp(join(tmpdir(), "saasaloy-add-recover-out-"));

    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
      "utf-8"
    );
    // The apply throws on the symlink guard, part-way through the plan.
    await mkdir(join(project, "apps"), { recursive: true });
    await symlink(outside, join(project, "apps", "web"), "dir");

    const mod = join(registry, "widget");
    await mkdir(join(mod, "files"), { recursive: true });
    await writeFile(
      join(mod, "registry-item.json"),
      JSON.stringify({
        name: "widget",
        type: "saasaloy:feature",
        files: [{ path: "files/widget.ts", target: "@web/widget.ts" }],
      }),
      "utf-8"
    );
    await writeFile(
      join(mod, "files", "widget.ts"),
      "export const x = 1;\n",
      "utf-8"
    );

    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  });

  async function run(args: string[]): Promise<{ code: number; out: string }> {
    const captured = capture();
    try {
      return { code: await runAdd(args), out: captured.lines.join("") };
    } finally {
      captured.restore();
    }
  }

  it("names the re-run that completes a failed apply, and exits non-zero", async () => {
    const { code, out } = await run(["widget", "--yes"]);

    expect(code).not.toBe(0);
    expect(out).toContain("Partial apply");
    expect(out).toContain("saasaloy add widget");
    // The error that stopped the run is still the one reported.
    expect(out).toContain("symlink");
  });

  it("stays quiet about recovery when the failure came before the apply", async () => {
    const { code, out } = await run(["nosuch", "--yes"]);

    expect(code).not.toBe(0);
    expect(out).not.toContain("Partial apply");
  });
});

describe("add — formatRecovery (#49)", () => {
  it("states the model and the command that finishes the job", () => {
    const line = stripAnsi(formatRecovery("waitlist"));

    expect(line).toContain("Partial apply");
    expect(line).toContain("saasaloy add waitlist");
  });
});
