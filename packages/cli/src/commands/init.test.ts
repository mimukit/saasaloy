import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pathExists } from "../lib/fs-utils.js";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, runInit } from "./init.js";

// `init` is the one command that copies the bundled template rather than fetching
// anything, so it is testable offline end to end. The scaffold cases below run it with
// `--no-install --no-git`: both shell out, and neither is what these tests are about.

const ORIGINAL_CWD = process.cwd();

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-init-"));
  process.chdir(dir);
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

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const captured = capture();
  try {
    return { code: await runInit(argv), out: captured.lines.join("") };
  } finally {
    captured.restore();
  }
}

describe("init — parseArgs", () => {
  it("reads the project name off the first positional", () => {
    expect(parseArgs(["my-app"])).toMatchObject({
      name: "my-app",
      unknown: [],
    });
  });

  it("defaults every flag to off", () => {
    expect(parseArgs(["my-app"])).toMatchObject({
      force: false,
      noGit: false,
      noInstall: false,
    });
  });

  it("reads every flag it knows", () => {
    expect(
      parseArgs(["my-app", "--force", "--no-install", "--no-git"])
    ).toMatchObject({
      force: true,
      name: "my-app",
      noGit: true,
      noInstall: true,
      unknown: [],
    });
  });

  it("reports a flag it does not know rather than ignoring it (#98)", () => {
    expect(parseArgs(["my-app", "--forse"]).unknown).toStrictEqual(["--forse"]);
  });

  it("reports a second positional as an extra argument", () => {
    expect(parseArgs(["my-app", "other"]).unknown).toStrictEqual(["other"]);
  });

  it("keeps --help out of the unknown list, so help can answer it", () => {
    expect(parseArgs(["--help"]).unknown).toStrictEqual([]);
    expect(parseArgs(["-h"]).unknown).toStrictEqual([]);
  });
});

describe("runInit — refusals before anything is written", () => {
  it("refuses an unknown flag and scaffolds nothing", async () => {
    const { code, out } = await run(["good-app", "--forse"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): --forse");
    await expect(pathExists(join(dir, "good-app"))).resolves.toBeFalsy();
  });

  it("refuses a name that is not a valid package name", async () => {
    const { code, out } = await run(["Bad_Name"]);

    expect(code).toBe(2);
    expect(out).toContain('Invalid project name "Bad_Name"');
    await expect(pathExists(join(dir, "Bad_Name"))).resolves.toBeFalsy();
  });

  it("validates the basename of a path, not the path", async () => {
    const { code, out } = await run(["./nested/Bad_Name"]);

    expect(code).toBe(2);
    expect(out).toContain('Invalid project name "Bad_Name"');
  });

  it("refuses a directory that is not empty", async () => {
    const target = join(dir, "occupied");
    await mkdir(target, { recursive: true });
    await writeFile(join(target, "keep.txt"), "mine\n", "utf-8");

    const { code, out } = await run(["occupied", "--no-install", "--no-git"]);

    expect(code).toBe(2);
    expect(out).toContain("is not empty");
    await expect(pathExists(join(target, "package.json"))).resolves.toBeFalsy();
  });

  it("prints help without scaffolding", async () => {
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    let code: number;
    try {
      code = await runInit(["--help"]);
    } finally {
      console.log = originalLog;
    }

    expect(code).toBe(0);
    expect(stripAnsi(logged.join("\n"))).toContain("saasaloy init [<name>]");
  });
});

describe("runInit — the template copy", () => {
  const project = "scaffolded-app";
  let target: string;

  let scaffold: { code: number; out: string };

  beforeAll(async () => {
    target = join(dir, project);
    scaffold = await run([project, "--no-install", "--no-git"]);
  });

  afterAll(async () => {
    await rm(target, { recursive: true, force: true });
  });

  it("exits 0", () => {
    expect(scaffold.code).toBe(0);
  });

  it("substitutes PROJECT_NAME into the copied files", async () => {
    const pkg = JSON.parse(
      await readFile(join(target, "package.json"), "utf-8")
    ) as { name: string };

    expect(pkg.name).toBe(project);
  });

  it("leaves no {{VAR}} token behind in the root package.json", async () => {
    const raw = await readFile(join(target, "package.json"), "utf-8");

    expect(raw).not.toContain("{{");
  });

  it("de-dots a `_name` template file back into a dotfile", async () => {
    await expect(pathExists(join(target, ".gitignore"))).resolves.toBeTruthy();
    await expect(pathExists(join(target, "_gitignore"))).resolves.toBeFalsy();
  });

  it("copies the nested workspaces", async () => {
    await expect(
      pathExists(join(target, "apps", "web", "package.json"))
    ).resolves.toBeTruthy();
    await expect(
      pathExists(join(target, "packages", "ui", "package.json"))
    ).resolves.toBeTruthy();
  });

  it("writes a saasaloy.json the project root is found by", async () => {
    const config = JSON.parse(
      await readFile(join(target, "saasaloy.json"), "utf-8")
    ) as { aliases: Record<string, string>; installed: string[] };

    expect(config.aliases).toHaveProperty("@web");
    expect(config.installed).toStrictEqual([]);
  });

  it("links each bundled skill into .claude/skills (ADR 0015)", async () => {
    const link = join(target, ".claude", "skills", "saasaloy-setup");

    await expect(pathExists(link)).resolves.toBeTruthy();
    await expect(readlink(link)).resolves.toContain(
      join(".agents", "skills", "saasaloy-setup")
    );
  });

  it("scaffolds into a non-empty directory under --force", async () => {
    const { code } = await run([
      project,
      "--force",
      "--no-install",
      "--no-git",
    ]);

    expect(code).toBe(0);
    await expect(
      pathExists(join(target, "package.json"))
    ).resolves.toBeTruthy();
  });
});

afterEach(() => {
  process.chdir(dir);
});
