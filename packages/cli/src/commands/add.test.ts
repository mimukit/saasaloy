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
import { REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import { runAdd } from "./add.js";

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
    expect(code).toBe(1);
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
    expect(code).toBe(1);
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

    expect(code).toBe(1);
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
