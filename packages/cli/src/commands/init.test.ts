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
import { readManifestState } from "../engine/manifest.js";
import { BASE_MODULE } from "../lib/base.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { loadLock } from "../lib/lock.js";
import { readVersion } from "../version.js";
import { stripAnsi } from "../lib/tui.js";
import { TESTING_BLOCKS } from "../lib/testing.js";
import type { TestingMode } from "../lib/testing.js";
import { THEMES, tokenFingerprint } from "../lib/theme.js";
import type { ThemeName } from "../lib/theme.js";
import {
  initGitRepo,
  parseArgs,
  resolveInitTestingMode,
  resolveInitTheme,
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

/** The body of the "Next steps" note in `init`'s output, up to the closing line. */
function nextSteps(out: string): string {
  const start = out.lastIndexOf("Next steps");
  return start === -1 ? "" : out.slice(start, out.indexOf("Created", start));
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

  it("reads --theme=<name> raw, leaving the check to runInit (plan 0121)", () => {
    expect(parseArgs(["my-app", "--theme=ember"])).toMatchObject({
      theme: "ember",
      unknown: [],
    });
    expect(parseArgs(["my-app", "--theme=bogus"]).theme).toBe("bogus");
    expect(parseArgs(["my-app"]).theme).toBeUndefined();
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

  it("refuses a bad --theme value, lists the themes, and scaffolds nothing (plan 0121)", async () => {
    const { code, out } = await run([
      "theme-bogus",
      "--theme=bogus",
      "--no-install",
      "--no-git",
    ]);

    expect(code).toBe(2);
    expect(out).toContain(
      'Unknown theme "bogus". Use one of: neutral, cobalt, ember, moss.'
    );
    await expect(pathExists(join(dir, "theme-bogus"))).resolves.toBeFalsy();
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
    const state = await readManifestState(target);
    const entries = state.kind === "v2" ? state.manifest.files : {};

    expect(state.kind).toBe("v2");
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

    expect(lock.base).toMatchObject({
      name: "web",
      cliVersion: await readVersion(),
    });
    expect(lock.base?.templateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(lock.modules).toStrictEqual({});
    expect(lock.requested).toStrictEqual([]);
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
      const state = await readManifestState(result.target);
      const entries = state.kind === "v2" ? state.manifest.files : {};
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

describe("runInit — the theme (plan 0121)", () => {
  const BRAND = "packages/ui/src/styles/brand.css";
  const DESIGN = "apps/web/DESIGN.md";

  async function scaffold(project: string, flags: string[]) {
    const target = join(dir, project);
    const { code } = await run([project, "--no-install", "--no-git", ...flags]);
    const read = (rel: string) => readFile(join(target, rel), "utf-8");
    return {
      code,
      target,
      brand: await read(BRAND),
      design: await read(DESIGN),
      config: JSON.parse(await read("saasaloy.json")) as { theme?: string },
    };
  }

  it("writes --theme=ember into brand.css, DESIGN.md and saasaloy.json", async () => {
    const result = await scaffold("theme-ember", ["--theme=ember"]);
    try {
      expect(result.code).toBe(0);
      expect(result.brand).toContain(
        `--primary: ${THEMES.ember.light.primary};`
      );
      expect(result.brand).toContain(`--radius: ${THEMES.ember.radius};`);
      expect(result.design).toContain("Its theme is `ember`");
      expect(result.design).toContain(
        `tokens sha256:${tokenFingerprint(result.brand)} of packages/ui/src/styles/brand.css`
      );
      expect(result.config.theme).toBe("ember");
      // The manifest records the themed bytes, so `doctor` and `outdated` see no drift.
      const state = await readManifestState(result.target);
      const entries = state.kind === "v2" ? state.manifest.files : {};
      expect(entries[BRAND]?.hash).toBe(hashContent(result.brand));
      expect(entries[DESIGN]?.hash).toBe(hashContent(result.design));
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });

  it("writes the template's own tokens and no theme key with no flag and no terminal", async () => {
    const template = await readFile(
      join(
        import.meta.dirname,
        "../../templates/base/packages/ui/src/styles/brand.css"
      ),
      "utf-8"
    );
    const result = await scaffold("theme-default", []);
    try {
      expect(result.code).toBe(0);
      expect(result.brand).toBe(template);
      expect(result.design).toContain("Its theme is `neutral`");
      expect(result.design).toContain(
        `tokens sha256:${tokenFingerprint(template)}`
      );
      expect(result.config.theme).toBeUndefined();
    } finally {
      await rm(result.target, { recursive: true, force: true });
    }
  });
});

describe("resolveInitTheme — the attended prompt (plan 0121)", () => {
  function asker(answer: ThemeName | symbol) {
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
    const prompt = asker("moss");
    await expect(
      resolveInitTheme(undefined, {
        interactive: true,
        yes: false,
        ask: prompt.ask,
      })
    ).resolves.toBe("moss");
    expect(prompt.calls).toHaveLength(1);
  });

  it("never asks when the flag names the theme", async () => {
    const prompt = asker("moss");
    await expect(
      resolveInitTheme("cobalt", {
        interactive: true,
        yes: false,
        ask: prompt.ask,
      })
    ).resolves.toBe("cobalt");
    expect(prompt.calls).toHaveLength(0);
  });

  it("reads neutral under --yes or without a terminal, and never asks", async () => {
    const prompt = asker("moss");
    await expect(
      resolveInitTheme(undefined, {
        interactive: true,
        yes: true,
        ask: prompt.ask,
      })
    ).resolves.toBe("neutral");
    await expect(
      resolveInitTheme(undefined, {
        interactive: false,
        yes: false,
        ask: prompt.ask,
      })
    ).resolves.toBe("neutral");
    expect(prompt.calls).toHaveLength(0);
  });

  it("passes a cancelled prompt back to the caller", async () => {
    const cancelled = Symbol("cancel");
    const prompt = asker(cancelled);
    await expect(
      resolveInitTheme(undefined, {
        interactive: true,
        yes: false,
        ask: prompt.ask,
      })
    ).resolves.toBe(cancelled);
  });
});

describe("runInit — base state persistence", () => {
  it("fails, and writes no project file, when it cannot write its state", async () => {
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
      expect(result.out).toContain("Couldn't scaffold unrecordable-base");
      expect(result.out).not.toContain(
        "Created unrecordable-base successfully"
      );
      // The engine writes its journal before any project file, so nothing landed.
      await expect(
        pathExists(join(target, "package.json"))
      ).resolves.toBeFalsy();
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

// Plan 0109: `init` commits the scaffold on `main`, so a build branch has a base. Each test
// points git at its own global config, so the machine's identity never leaks in.
describe("runInit — the first commit", () => {
  const ORIGINAL_ENV = { ...process.env };
  const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
  const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
  let home: string;
  let bin: string;

  beforeAll(async () => {
    home = await mkdtemp(join(tmpdir(), "saasaloy-init-home-"));
    bin = await mkdtemp(join(tmpdir(), "saasaloy-init-commit-bin-"));
    await writeFile(
      join(home, "with-identity"),
      "[user]\n\tname = Init Test\n\temail = init@example.test\n",
      "utf-8"
    );
    await writeFile(join(home, "no-identity"), "", "utf-8");
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    process.stdin.isTTY = ORIGINAL_STDIN_TTY;
    process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
  });

  afterAll(async () => {
    await rm(home, { recursive: true, force: true });
    await rm(bin, { recursive: true, force: true });
  });

  function useGitConfig(file: "with-identity" | "no-identity"): void {
    for (const key of [
      "GIT_AUTHOR_NAME",
      "GIT_AUTHOR_EMAIL",
      "GIT_COMMITTER_NAME",
      "GIT_COMMITTER_EMAIL",
    ]) {
      delete process.env[key];
    }
    process.env.GIT_CONFIG_GLOBAL = join(home, file);
    process.env.GIT_CONFIG_NOSYSTEM = "1";
  }

  function git(cwd: string, args: string[]): string {
    return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
  }

  // A `pnpm` that logs each call's arguments and fails the one named in `failOn`.
  async function fakePnpm(failOn?: string): Promise<string> {
    const log = join(bin, "calls.log");
    await rm(log, { force: true });
    await writeFile(
      join(bin, "pnpm"),
      `#!/bin/sh\necho "$*" >> "${log}"\nif [ "$1" = "${failOn ?? "-"}" ]; then echo "ERR_FAKE $1 said no"; exit 1; fi\nexit 0\n`,
      "utf-8"
    );
    await chmod(join(bin, "pnpm"), 0o755);
    process.env.PATH = `${bin}${delimiter}${ORIGINAL_ENV.PATH ?? ""}`;
    return log;
  }

  it("commits the scaffold on main as chore(repo): initial commit", async () => {
    useGitConfig("with-identity");
    const { code } = await run(["first-commit", "--no-install"]);
    const target = join(dir, "first-commit");

    expect(code).toBe(0);
    expect(git(target, ["log", "--format=%s", "main"])).toBe(
      "chore(repo): initial commit"
    );
    expect(git(target, ["symbolic-ref", "--short", "HEAD"])).toBe("main");
    expect(git(target, ["status", "--porcelain"])).toBe("");
  });

  it("makes no commit under --no-git", async () => {
    useGitConfig("with-identity");
    const { code } = await run(["no-git-commit", "--no-install", "--no-git"]);

    expect(code).toBe(0);
    await expect(
      pathExists(join(dir, "no-git-commit", ".git"))
    ).resolves.toBeFalsy();
  });

  it("warns and skips the commit with no git identity", async () => {
    useGitConfig("no-identity");
    const { code, out } = await run(["no-identity", "--no-install"]);
    const target = join(dir, "no-identity");

    expect(code).toBe(0);
    expect(out).toContain("no git identity");
    expect(out).toContain("chore(repo): initial commit");
    await expect(pathExists(join(target, ".git"))).resolves.toBeTruthy();
    expect(() => git(target, ["rev-parse", "--verify", "HEAD"])).toThrow(
      /Command failed/
    );
  });

  it("runs pnpm env:setup after the install, then commits", async () => {
    useGitConfig("with-identity");
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const log = await fakePnpm();
    const { code, out } = await run(["env-after-install", "--yes"]);
    const target = join(dir, "env-after-install");

    expect(code).toBe(0);
    expect(out).toContain("pnpm env:setup");
    await expect(readFile(log, "utf-8")).resolves.toBe("install\nenv:setup\n");
    expect(git(target, ["log", "--format=%s", "main"])).toBe(
      "chore(repo): initial commit"
    );
  });

  it("warns, and still exits 0 and commits, when pnpm env:setup fails", async () => {
    useGitConfig("with-identity");
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    await fakePnpm("env:setup");
    const { code, out } = await run(["env-fails", "--yes"]);
    const target = join(dir, "env-fails");

    expect(code).toBe(0);
    expect(out).toContain("ERR_FAKE env:setup said no");
    expect(git(target, ["log", "--format=%s", "main"])).toBe(
      "chore(repo): initial commit"
    );
    expect(nextSteps(out)).toContain("pnpm env:setup");
  });

  it("lists only the interview once the install and env:setup ran", async () => {
    useGitConfig("with-identity");
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    await fakePnpm();
    const { code, out } = await run(["steps-after-install", "--yes"]);
    const steps = nextSteps(out);

    expect(code).toBe(0);
    expect(steps).toContain("/saasaloy-setup");
    expect(steps).not.toContain("pnpm install");
    expect(steps).not.toContain("pnpm env:setup");
  });
});

// Plan 0109: the next steps give one path, `init`, the interview, the build, so a person
// who follows them never starts a dev server with no env files.
describe("runInit — the next steps (plan 0109)", () => {
  let out: string;

  beforeAll(async () => {
    ({ out } = await run(["next-steps-app", "--no-install", "--no-git"]));
  });

  afterAll(async () => {
    await rm(join(dir, "next-steps-app"), { recursive: true, force: true });
  });

  it("installs, writes the env files, then runs the interview, in that order", () => {
    const steps = nextSteps(out);
    const install = steps.indexOf("pnpm install");
    const env = steps.indexOf("pnpm env:setup");
    const setup = steps.indexOf("/saasaloy-setup");

    expect(install).toBeGreaterThan(-1);
    expect(env).toBeGreaterThan(install);
    expect(setup).toBeGreaterThan(env);
  });

  it("names the build as what the interview starts", () => {
    expect(nextSteps(out)).toMatch(/\/saasaloy-setup[^\n]*starts the build/);
  });

  it("offers no second path", () => {
    const steps = nextSteps(out);

    expect(steps).not.toContain("pnpm dev");
    expect(steps).not.toContain("/saasaloy-landing-copy");
    expect(steps).not.toContain("/saasaloy-build ");
  });
});
