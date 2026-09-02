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
import { pathExists } from "../lib/fs-utils.js";
import { emptyLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, pinToLock, runAdd } from "./add.js";

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
