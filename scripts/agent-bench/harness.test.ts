// The agent benchmark harness's options, port block, totals and report header (issue
// #347). Run with `pnpm test:scripts`, or `node --test scripts/agent-bench/harness.test.ts`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";

import {
  absolutePaths,
  blockSlots,
  defaultRuns,
  formatHeader,
  isInside,
  parseArgs,
  pickBlock,
  runIdOf,
  runnerShim,
  splitCommand,
  totals,
} from "./harness.ts";
import type { RunRecord } from "./harness.ts";

describe("parseArgs", () => {
  it("runs the Shelfnote brief in brief mode with claude by default", () => {
    const options = parseArgs([], "/home/u");
    assert.equal(options.brief, "shelfnote");
    assert.equal(options.mode, "brief");
    assert.equal(options.agent, undefined);
    assert.equal(options.runs, "/home/u/.cache/saasaloy-bench");
    assert.equal(options.build, true);
    assert.deepEqual(options.unknown, []);
  });

  it("reads the interview mode, the brief, the agent command and the runs folder", () => {
    const options = parseArgs(
      [
        "--interview",
        "--brief",
        "prepline",
        "--agent",
        "node ./fake.ts --say 'two words'",
        "--runs",
        "/tmp/runs",
        "--no-build",
        "--static",
      ],
      "/home/u"
    );
    assert.equal(options.mode, "interview");
    assert.equal(options.brief, "prepline");
    assert.deepEqual(options.agent, [
      "node",
      "./fake.ts",
      "--say",
      "two words",
    ]);
    assert.equal(options.runs, "/tmp/runs");
    assert.equal(options.build, false);
    assert.equal(options.staticOnly, true);
  });

  it("keeps --score and names what it does not take", () => {
    const options = parseArgs(["--score", "/r/1", "--agent", "--x"], "/home/u");
    assert.equal(options.scoreDir, "/r/1");
    assert.deepEqual(options.unknown, ["--agent (needs a value)", "--x"]);
  });
});

describe("splitCommand", () => {
  it("splits on spaces and keeps a quoted part whole", () => {
    assert.deepEqual(splitCommand(`claude --model "claude sonnet"  -x`), [
      "claude",
      "--model",
      "claude sonnet",
      "-x",
    ]);
  });
});

describe("absolutePaths", () => {
  it("makes a relative path that exists absolute, and leaves other words", () => {
    assert.deepEqual(
      absolutePaths(
        ["node", "scripts/fake.ts", "--model", "a/b", "/abs/x.ts"],
        "/repo",
        (path) => path === "/repo/scripts/fake.ts"
      ),
      ["node", "/repo/scripts/fake.ts", "--model", "a/b", "/abs/x.ts"]
    );
  });
});

describe("isInside", () => {
  it("is true for the folder itself and a folder below it", () => {
    assert.equal(isInside("/repo", "/repo"), true);
    assert.equal(isInside("/repo", "/repo/.dev/bench"), true);
  });

  it("is false for a sibling and for a parent", () => {
    assert.equal(isInside("/repo", "/repo-runs"), false);
    assert.equal(isInside("/repo", "/"), false);
  });

  it("puts the default runs folder outside a repo in the home folder", () => {
    assert.equal(
      isInside("/home/u/projects/saasaloy", defaultRuns("/home/u")),
      false
    );
  });
});

describe("blockSlots and pickBlock", () => {
  it("gives the ten ports of a block", () => {
    assert.deepEqual(
      blockSlots(3),
      [
        10_030, 10_031, 10_032, 10_033, 10_034, 10_035, 10_036, 10_037, 10_038,
        10_039,
      ]
    );
  });

  it("moves past a block one of whose ports listens", async () => {
    const free = await pickBlock("run-a", async () => false);
    const busy = new Set(blockSlots(free).slice(5, 6));
    const next = await pickBlock("run-a", async (port) => busy.has(port));
    assert.equal(next, (free + 1) % 1000);
  });

  it("never picks the pinned ports 3000 to 4004", async () => {
    const block = await pickBlock("run-b", async () => false);
    assert.ok(blockSlots(block).every((port) => port >= 10_000));
  });
});

describe("totals", () => {
  it("sums the turns and the cost of every call", () => {
    assert.deepEqual(
      totals([
        { turn: 1, code: 0, numTurns: 2, costUsd: 0.1 },
        { turn: 2, code: 0, numTurns: 40, costUsd: 2.345 },
      ]),
      { turns: 42, costUsd: 2.45 }
    );
  });

  it("says unknown when one call did not report a number", () => {
    assert.deepEqual(
      totals([
        { turn: 1, code: 0, numTurns: 2, costUsd: 0.1 },
        { turn: 2, code: 0 },
      ]),
      { turns: "unknown", costUsd: "unknown" }
    );
    assert.deepEqual(totals([]), { turns: "unknown", costUsd: "unknown" });
  });
});

describe("formatHeader", () => {
  const run: RunRecord = {
    runId: "2026-11-17T10-00-00-000Z",
    brief: "prepline",
    mode: "interview",
    agent: ["node", "agents/claude.ts"],
    revision: "0123456789abcdef0123456789abcdef01234567",
    tree: "clean",
    block: 7,
    minutes: 42,
    calls: [{ turn: 1, code: 0, numTurns: 3, costUsd: 0.5 }],
    turns: 3,
    costUsd: 0.5,
    answers: 9,
    end: "the build call exited 0",
  };

  it("holds the lines release-preflight reads, one per line", () => {
    const header = formatHeader(run);
    assert.match(header, /^Brief: prepline$/m);
    assert.match(header, /^Mode: interview$/m);
    assert.match(
      header,
      /^Revision: 0123456789abcdef0123456789abcdef01234567$/m
    );
  });

  it("records the turns, the time and the cost", () => {
    const header = formatHeader(run);
    assert.match(header, /^Time: 42 min$/m);
    assert.match(header, /^Turns: 3 over 1 agent calls$/m);
    assert.match(header, /^Cost: \$0\.50/m);
  });

  it("says unknown for a number the agent command did not report", () => {
    const header = formatHeader({
      ...run,
      turns: "unknown",
      costUsd: "unknown",
    });
    assert.match(header, /^Turns: unknown/m);
    assert.match(header, /^Cost: unknown/m);
  });
});

describe("runnerShim", () => {
  const dir = mkdtempSync(join(tmpdir(), "runner-shim-"));
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });
  const fake = (name: string): string => {
    const path = join(dir, name);
    writeFileSync(path, `#!/usr/bin/env sh\necho ${name} "$@"\n`);
    chmodSync(path, 0o755);
    return path;
  };
  const local = fake("local");
  const real = fake("real");
  const run = (runner: "npx" | "pnpx" | "pnpm", args: string[]): string => {
    const path = join(dir, runner);
    writeFileSync(path, runnerShim(runner, local, real));
    chmodSync(path, 0o755);
    return spawnSync(path, args, { encoding: "utf-8" }).stdout.trim();
  };

  it("sends `npx saasaloy@latest` to the local CLI with the words after it", () => {
    assert.equal(
      run("npx", ["saasaloy@latest", "init", ".", "--force", "--yes"]),
      "local init . --force --yes"
    );
  });

  it("skips npx flags before the package and takes a bare `saasaloy`", () => {
    assert.equal(run("npx", ["-y", "saasaloy", "list"]), "local list");
    assert.equal(
      run("pnpx", ["saasaloy@0.9.0", "add", "auth"]),
      "local add auth"
    );
  });

  it("passes any other package to the real runner unchanged", () => {
    assert.equal(
      run("npx", ["-y", "wrangler", "whoami"]),
      "real -y wrangler whoami"
    );
    assert.equal(run("npx", ["saasaloy-x"]), "real saasaloy-x");
  });

  it("checks only `pnpm dlx` and passes every other pnpm command", () => {
    assert.equal(
      run("pnpm", ["dlx", "saasaloy@latest", "init", "."]),
      "local init ."
    );
    assert.equal(run("pnpm", ["install"]), "real install");
    assert.equal(run("pnpm", ["dlx", "create-astro"]), "real dlx create-astro");
    assert.equal(run("pnpm", ["exec", "saasaloy"]), "real exec saasaloy");
  });
});

describe("runIdOf", () => {
  it("is a name `saasaloy init .` accepts for the folder", () => {
    const id = runIdOf(new Date("2026-11-20T08:42:18.047Z"));
    assert.equal(id, "2026-11-20t08-42-18-047z");
    // The project name rule in packages/cli/src/commands/init.ts.
    assert.match(id, /^[a-z0-9][a-z0-9-]*$/);
  });
});
