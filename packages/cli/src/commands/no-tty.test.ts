import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  EXIT_FAILURE,
  EXIT_MERGE_PENDING,
  EXIT_OK,
  EXIT_REFUSED,
} from "../lib/exit.js";
import { stripAnsi } from "../lib/tui.js";
import { COMMANDS } from "./index.js";

// ADR 0046: with no TTY, no command waits on a prompt. Each one either does its job, or
// refuses and names the flag that answers. This runs every registered command as a real
// child process with stdin on /dev/null and stdout piped, so neither side is a terminal,
// and fails any command that is still running when the timeout fires. A new prompt with
// no guard (lib/prompts.ts) hangs here rather than in somebody's CI.
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
  EXIT_MERGE_PENDING,
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

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-no-tty-"));
});

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
      // One string to assert on, so a failure prints what the command said.
      let outcome = "a defined exit code";
      if (run.code === null) {
        outcome = `timed out after ${TIMEOUT_MS} ms:\n${run.output}`;
      } else if (!DEFINED_CODES.has(run.code)) {
        outcome = `exit ${run.code}:\n${run.output}`;
      }
      expect(outcome).toBe("a defined exit code");
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
