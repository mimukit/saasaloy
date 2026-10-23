import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { BASE_MODULE, baseEntries, templateHash } from "../lib/base.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { loadLock } from "../lib/lock.js";
import { loadManifest } from "../lib/manifest.js";
import { baseTemplateDir } from "../lib/scaffold.js";
import { readVersion } from "../version.js";
import { stripAnsi } from "../lib/tui.js";
import { TESTING_BLOCKS } from "../lib/testing.js";
import type { TestingMode } from "../lib/testing.js";
import {
  initGitRepo,
  parseArgs,
  resolveInitTestingMode,
  runInit,
} from "./init.js";

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
      yes: false,
    });
  });

  it("reads --yes and its -y short form (#223)", () => {
    expect(parseArgs(["my-app", "--yes"])).toMatchObject({
      unknown: [],
      yes: true,
    });
    expect(parseArgs(["my-app", "-y"])).toMatchObject({
      unknown: [],
      yes: true,
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

  it("reads --testing=<mode> raw, leaving the check to runInit (#242)", () => {
    expect(parseArgs(["my-app", "--testing=tdd"])).toMatchObject({
      testing: "tdd",
      unknown: [],
    });
    expect(parseArgs(["my-app", "--testing=bogus"]).testing).toBe("bogus");
  });

  it("leaves testing unset when the flag is absent (#242)", () => {
    expect(parseArgs(["my-app"]).testing).toBeUndefined();
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

  it("refuses a bad --testing value and scaffolds nothing (#242)", async () => {
    const { code, out } = await run([
      "testing-bogus",
      "--testing=bogus",
      "--no-install",
      "--no-git",
    ]);

    expect(code).toBe(2);
    expect(out).toContain('Unknown testing mode "bogus"');
    await expect(pathExists(join(dir, "testing-bogus"))).resolves.toBeFalsy();
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

  it("records every base file in the manifest under the reserved `base` module (#120)", async () => {
    const manifest = await loadManifest(target);
    const entries = baseEntries(manifest);

    expect(Object.keys(entries).length).toBeGreaterThan(10);
    expect(entries["AGENTS.md"]).toMatchObject({
      module: BASE_MODULE,
      from: "AGENTS.md",
    });
    expect(entries[".gitignore"]).toMatchObject({ from: "_gitignore" });
    for (const [rel, entry] of Object.entries(entries)) {
      const onDisk = await readFile(join(target, ...rel.split("/")), "utf-8");
      expect(entry.hash, `${rel} hash`).toBe(hashContent(onDisk));
    }
  });

  it("records the base in the lock at the running CLI and the shipped template's hash (#120)", async () => {
    const lock = await loadLock(target);

    expect(lock.base).toStrictEqual({
      name: "web",
      cliVersion: await readVersion(),
      templateHash: await templateHash(await baseTemplateDir()),
    });
    expect(lock.modules).toStrictEqual({});
  });

  it("never copies the base declaration into the project (#120)", async () => {
    await expect(
      pathExists(join(target, ".saasaloy-base.json"))
    ).resolves.toBeFalsy();
    await expect(
      pathExists(join(target, "_saasaloy-base.json"))
    ).resolves.toBeFalsy();
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

// #242: `init` writes `testing.mode` into saasaloy.json and fills the AGENTS.md block for
// it. The hash test above covers the default run; this one covers a non-default mode, where
// both rewritten files must still be recorded at their bytes on disk.
describe("runInit — the testing mode (#242)", () => {
  const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
  const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

  afterEach(() => {
    process.stdin.isTTY = ORIGINAL_STDIN_TTY;
    process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
  });

  async function scaffold(
    project: string,
    flags: string[]
  ): Promise<{ code: number; target: string; mode: unknown; agents: string }> {
    const target = join(dir, project);
    const { code } = await run([project, "--no-install", "--no-git", ...flags]);
    const config = JSON.parse(
      await readFile(join(target, "saasaloy.json"), "utf-8")
    ) as { testing?: { mode: string } };
    const agents = await readFile(join(target, "AGENTS.md"), "utf-8");
    return { code, target, mode: config.testing?.mode, agents };
  }

  it("writes --testing=tdd into saasaloy.json and the tdd text into AGENTS.md", async () => {
    const result = await scaffold("testing-tdd", ["--testing=tdd"]);
    try {
      expect(result.code).toBe(0);
      expect(result.mode).toBe("tdd");
      expect(result.agents).toContain(TESTING_BLOCKS.tdd);
      expect(result.agents).not.toContain(TESTING_BLOCKS.off);
      const entries = baseEntries(await loadManifest(result.target));
      for (const rel of ["saasaloy.json", "AGENTS.md"]) {
        const onDisk = await readFile(join(result.target, rel), "utf-8");
        expect(entries[rel]?.hash, `${rel} hash`).toBe(hashContent(onDisk));
      }
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });

  it("writes off when no terminal can answer and no flag was given", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const result = await scaffold("testing-unattended", []);
    try {
      expect(result.code).toBe(0);
      expect(result.mode).toBe("off");
      expect(result.agents).toContain(TESTING_BLOCKS.off);
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });
});

describe("resolveInitTestingMode — the attended prompt (#242)", () => {
  function asker(answer: TestingMode | symbol) {
    const calls: number[] = [];
    return {
      calls,
      ask: () => {
        calls.push(1);
        return Promise.resolve(answer);
      },
    };
  }

  it("asks once on a terminal with no flag, and takes the answer", async () => {
    const prompt = asker("tests-after");

    await expect(
      resolveInitTestingMode(undefined, {
        interactive: true,
        ask: prompt.ask,
      })
    ).resolves.toBe("tests-after");
    expect(prompt.calls).toHaveLength(1);
  });

  it("never asks when the flag names the mode", async () => {
    const prompt = asker("off");

    await expect(
      resolveInitTestingMode("tdd", { interactive: true, ask: prompt.ask })
    ).resolves.toBe("tdd");
    expect(prompt.calls).toHaveLength(0);
  });

  it("never asks without a terminal, and reads off", async () => {
    const prompt = asker("tdd");

    await expect(
      resolveInitTestingMode(undefined, {
        interactive: false,
        ask: prompt.ask,
      })
    ).resolves.toBe("off");
    expect(prompt.calls).toHaveLength(0);
  });

  it("passes a cancelled prompt back to the caller", async () => {
    const cancelled = Symbol("cancel");
    const prompt = asker(cancelled);

    await expect(
      resolveInitTestingMode(undefined, {
        interactive: true,
        ask: prompt.ask,
      })
    ).resolves.toBe(cancelled);
  });
});

describe("runInit — base state persistence", () => {
  it("fails when it cannot record the base manifest", async () => {
    const project = "unrecordable-base";
    const target = join(dir, project);
    await mkdir(target, { recursive: true });
    await writeFile(join(target, ".saasaloy"), "blocks the state directory\n");

    try {
      const result = await run([
        project,
        "--force",
        "--no-install",
        "--no-git",
      ]);

      expect(result.code).toBe(1);
      expect(result.out).toContain("Couldn't record the base template");
      expect(result.out).not.toContain(
        "Created unrecordable-base successfully"
      );
      await expect(
        pathExists(join(target, "package.json"))
      ).resolves.toBeTruthy();
    } finally {
      await rm(target, { recursive: true, force: true });
    }
  });
});

describe("initGitRepo — the nesting guard (ADR 0024)", () => {
  let outer: string;

  beforeAll(async () => {
    outer = join(dir, "outer");
    await mkdir(join(outer, "ignored", "app"), { recursive: true });
    await mkdir(join(outer, "tracked", "app"), { recursive: true });
    await writeFile(join(outer, ".gitignore"), "/ignored/\n");
    execFileSync("git", ["init", "--quiet"], { cwd: outer });
  });

  it("initialises a directory outside any repository", async () => {
    const target = join(dir, "standalone");
    await mkdir(target, { recursive: true });
    await expect(initGitRepo(target)).resolves.toStrictEqual({ created: true });
    await expect(pathExists(join(target, ".git"))).resolves.toBeTruthy();
  });

  // The deploy's branch gate allows `main`, so the first branch must be `main` whatever
  // `init.defaultBranch` the machine sets.
  it("starts the repository on main", async () => {
    const target = join(dir, "on-main");
    await mkdir(target, { recursive: true });
    await initGitRepo(target);
    const head = execFileSync("git", ["symbolic-ref", "HEAD"], {
      cwd: target,
      encoding: "utf-8",
    });
    expect(head.trim()).toBe("refs/heads/main");
  });

  it("does not nest a repository where the outer one tracks the target", async () => {
    const target = join(outer, "tracked", "app");
    await expect(initGitRepo(target)).resolves.toStrictEqual({
      created: false,
    });
    await expect(pathExists(join(target, ".git"))).resolves.toBeFalsy();
  });

  // `.dev/playground` inside this repository is the case this guard exists for.
  it("initialises a directory the outer repository ignores", async () => {
    const target = join(outer, "ignored", "app");
    await expect(initGitRepo(target)).resolves.toStrictEqual({ created: true });
    await expect(pathExists(join(target, ".git"))).resolves.toBeTruthy();
  });
});

afterEach(() => {
  process.chdir(dir);
});

// #223, ADR 0046: with no terminal, init refuses and names the flag before it writes a
// file, and `--yes` answers the install prompt. The install itself runs a fake `pnpm` put
// first on PATH, so these stay offline and never touch the real store.
describe("runInit — no terminal (#223)", () => {
  const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
  const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
  const ORIGINAL_PATH = process.env.PATH;
  let bin: string;

  beforeAll(async () => {
    bin = await mkdtemp(join(tmpdir(), "saasaloy-init-bin-"));
  });

  afterEach(() => {
    process.stdin.isTTY = ORIGINAL_STDIN_TTY;
    process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
    process.env.PATH = ORIGINAL_PATH;
  });

  afterAll(async () => {
    await rm(bin, { recursive: true, force: true });
  });

  function noTerminal(): void {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
  }

  // A `pnpm` that records it ran, prints what a real failure would, and exits `code`.
  async function fakePnpm(code: number): Promise<void> {
    await writeFile(
      join(bin, "pnpm"),
      `#!/bin/sh\necho ran > "$PWD/.fake-pnpm-ran"\necho "ERR_PNPM_FAKE the registry said no"\nexit ${code}\n`,
      "utf-8"
    );
    await chmod(join(bin, "pnpm"), 0o755);
    process.env.PATH = `${bin}${delimiter}${ORIGINAL_PATH ?? ""}`;
  }

  it("refuses with no name, names `<name>`, and writes nothing", async () => {
    noTerminal();
    const before = await readdir(dir);
    const { code, out } = await run(["--no-install"]);
    expect(code).toBe(2);
    expect(out).toContain("`<name>`");
    await expect(readdir(dir)).resolves.toStrictEqual(before);
  });

  it("refuses with neither --yes nor --no-install, naming both, before it writes", async () => {
    noTerminal();
    const { code, out } = await run(["undecided", "--no-git"]);
    expect(code).toBe(2);
    expect(out).toContain("`--yes`");
    expect(out).toContain("`--no-install`");
    await expect(pathExists(join(dir, "undecided"))).resolves.toBeFalsy();
  });

  it("refuses --yes with --no-install as contradictory", async () => {
    const { code, out } = await run(["both", "--yes", "--no-install"]);
    expect(code).toBe(2);
    expect(out).toContain("not both");
    await expect(pathExists(join(dir, "both"))).resolves.toBeFalsy();
  });

  it("installs under --yes with no prompt", async () => {
    noTerminal();
    await fakePnpm(0);
    const { code, out } = await run(["installs", "--yes", "--no-git"]);
    expect(code).toBe(0);
    expect(out).toContain("Installed dependencies");
    await expect(
      pathExists(join(dir, "installs", ".fake-pnpm-ran"))
    ).resolves.toBeTruthy();
  });

  it("exits 1 when pnpm install fails, prints its output, and keeps the scaffold", async () => {
    noTerminal();
    await fakePnpm(1);
    const { code, out } = await run(["install-fails", "--yes", "--no-git"]);
    expect(code).toBe(1);
    expect(out).toContain("ERR_PNPM_FAKE the registry said no");
    expect(out).toContain("pnpm install failed");
    await expect(
      pathExists(join(dir, "install-fails", "package.json"))
    ).resolves.toBeTruthy();
  });
});
