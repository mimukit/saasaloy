import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXIT_FAILURE,
  EXIT_WORK_PENDING,
  EXIT_OK,
  EXIT_REFUSED,
} from "../lib/exit.js";
import { stripAnsi } from "../lib/tui.js";
import { COMMANDS } from "./index.js";

// ADR 0046: with no TTY, no command waits on a prompt. Each one either does its job, or
// refuses and names the flag that answers. This runs every registered command as a real
// child process with stdin on /dev/null or on a silent pipe and stdout piped, so neither
// side is a terminal, and fails any command that is still running when the timeout fires.
//
// It runs each command twice over. In an empty directory with no arguments, only `init`'s
// name prompt is reachable: every other prompt sits behind project detection or a module
// name. So it also runs each command inside one scaffolded project (and `new module`
// outside it), with the arguments that reach a prompt: `add` and `remove` a module,
// `update`, `env`, `init` with no name. A prompt that neither run reaches is guarded by
// the import allowlist in `src/lib/prompts.test.ts`, which fails any command that takes
// a prompt from `@clack/prompts` instead of the guard in lib/prompts.ts.
//
// The unit suite does not build `dist/`, so the child runs `src/index.ts` through Node's
// own TypeScript support plus a `.js` → `.ts` resolve hook (test/support/ts-source-hook.ts).

const PACKAGE_DIR = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const ENTRY = join(PACKAGE_DIR, "src", "index.ts");
const HOOK = join(PACKAGE_DIR, "test", "support", "ts-source-hook.ts");
// Every command reads its modules from this checkout, so nothing reaches the network.
const REGISTRY = join(PACKAGE_DIR, "test", "fixtures", "registry-clean");

const TIMEOUT_MS = 20_000;
const DEFINED_CODES = new Set([
  EXIT_OK,
  EXIT_FAILURE,
  EXIT_REFUSED,
  EXIT_WORK_PENDING,
]);

/**
 * How the child's stdin is wired. Neither is a terminal. `closed` is `</dev/null`: a read
 * sees end-of-file at once. `silent` is a pipe nobody writes to or closes, which is what
 * an agent's shell or a CI step often hands over, and the case where an unguarded prompt
 * waits forever rather than reading end-of-file.
 */
type Stdin = "closed" | "silent";

interface Run {
  /** `null` when the timeout killed the child: the command was waiting on something. */
  code: number | null;
  output: string;
}

function runWithoutTty(
  cwd: string,
  argv: string[],
  stdin: Stdin
): Promise<Run> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [
        "--experimental-transform-types",
        "--no-warnings",
        "--import",
        HOOK,
        ENTRY,
        ...argv,
      ],
      {
        cwd,
        env: { ...process.env, NO_COLOR: "1", SAASALOY_REGISTRY_DIR: REGISTRY },
        stdio: [stdin === "closed" ? "ignore" : "pipe", "pipe", "pipe"],
      }
    );
    let output = "";
    child.stdout?.on("data", (chunk) => {
      output += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      output += String(chunk);
    });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, TIMEOUT_MS);
    child.on("close", (code) => {
      clearTimeout(timer);
      child.stdin?.destroy();
      resolvePromise({
        code: timedOut ? null : code,
        output: stripAnsi(output),
      });
    });
  });
}

// One string to assert on, so a failure prints what the command said.
function outcomeOf(run: Run): string {
  if (run.code === null) {
    return `timed out after ${TIMEOUT_MS} ms:\n${run.output}`;
  }
  if (!DEFINED_CODES.has(run.code)) {
    return `exit ${run.code}:\n${run.output}`;
  }
  return "a defined exit code";
}

const PROJECT = "no-tty-app";
// `beta` is installed in `project` (with `alpha`, which it depends on), so `remove` has a
// module to confirm and `env` has a variable to ask for. `bare` is the same scaffold with
// nothing installed, so `add` has a plan to confirm.
const INSTALLED = "beta";

/** One setup step. A failure stops the suite with what the command said. */
async function setUp(cwd: string, argv: string[]): Promise<void> {
  const run = await runWithoutTty(cwd, argv, "closed");
  if (run.code !== EXIT_OK) {
    throw new Error(
      `\`saasaloy ${argv.join(" ")}\` exited ${String(run.code)}:\n${run.output}`
    );
  }
}

let dir: string;
let project: string;
let bare: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-no-tty-"));
  project = join(dir, PROJECT);
  bare = join(dir, "bare");
  await setUp(dir, ["init", PROJECT, "--no-install", "--no-git"]);
  await cp(project, bare, { recursive: true });
  // `env` refuses to write into a folder no repository holds. An empty `.git` is enough
  // for its gitignore check, and needs no git binary.
  await mkdir(join(project, ".git"));
  await setUp(project, ["add", INSTALLED, "--yes"]);
}, 2 * TIMEOUT_MS);

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("every command with no terminal", () => {
  const names = Object.keys(COMMANDS);
  const cases = names.flatMap((name) =>
    (["closed", "silent"] as const).map((stdin) => [name, stdin] as const)
  );

  it("covers the whole registry", () => {
    expect(names.length).toBeGreaterThan(0);
  });

  it.each(cases)(
    "`saasaloy %s` with stdin %s exits in time with a code from lib/exit.ts",
    async (name, stdin) => {
      // One empty directory per run, so `init`'s refusal (or a future command that
      // writes) cannot change what the next one sees.
      const cwd = await mkdtemp(join(dir, `${name}-${stdin}-`));
      const run = await runWithoutTty(cwd, [name], stdin);
      expect(outcomeOf(run)).toBe("a defined exit code");
    },
    TIMEOUT_MS + 10_000
  );

  it(
    "`saasaloy init` with no name exits 2, names `<name>`, and writes nothing",
    async () => {
      const cwd = await mkdtemp(join(dir, "init-name-"));
      const run = await runWithoutTty(cwd, ["init"], "closed");
      expect(run.code).toBe(EXIT_REFUSED);
      expect(run.output).toContain("`<name>`");
      await expect(readdir(cwd)).resolves.toStrictEqual([]);
    },
    TIMEOUT_MS + 10_000
  );
});

describe("every command with no terminal, inside a project", () => {
  // The arguments that reach each command's prompt, where it has one. `list`, `outdated`
  // and `doctor` have none, and run here so a prompt added to them later is reached.
  const inProject: string[][] = [
    ["remove", INSTALLED],
    ["update"],
    ["env"],
    ["init"],
    ["list"],
    ["outdated"],
    ["doctor"],
  ];
  const cases = inProject.flatMap((argv) =>
    (["closed", "silent"] as const).map(
      (stdin) => [argv.join(" "), stdin, argv] as const
    )
  );

  it.each(cases)(
    "`saasaloy %s` with stdin %s exits in time with a code from lib/exit.ts",
    async (_line, stdin, argv) => {
      const run = await runWithoutTty(project, argv, stdin);
      expect(outcomeOf(run)).toBe("a defined exit code");
    },
    TIMEOUT_MS + 10_000
  );

  it.each(["closed", "silent"] as const)(
    "`saasaloy add beta` in a project without it, with stdin %s, exits in time with a code from lib/exit.ts",
    async (stdin) => {
      const run = await runWithoutTty(bare, ["add", INSTALLED], stdin);
      expect(outcomeOf(run)).toBe("a defined exit code");
    },
    TIMEOUT_MS + 10_000
  );

  // `new` refuses inside a project, so its tier and dependency prompts are reached only
  // outside one. `--type` without `--depends-on` reaches the dependency question.
  it.each(["closed", "silent"] as const)(
    "`saasaloy new module x --type saasaloy:feature` with stdin %s exits in time with a code from lib/exit.ts",
    async (stdin) => {
      const cwd = await mkdtemp(join(dir, `new-${stdin}-`));
      const run = await runWithoutTty(
        cwd,
        ["new", "module", "x", "--type", "saasaloy:feature"],
        stdin
      );
      expect(outcomeOf(run)).toBe("a defined exit code");
    },
    TIMEOUT_MS + 10_000
  );
});
