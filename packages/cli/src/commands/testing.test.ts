import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { stripAnsi } from "../lib/tui.js";
import { scaffoldProject } from "./init.js";
import { parseArgs, runTesting } from "./testing.js";

// `saasaloy testing [mode]` (#242): print the mode, and refuse a bad argument before it
// writes. Each case runs against a project `init --testing=tdd` scaffolded. The change of
// mode is one apply, tested with the other commands in `apply-run.test.ts`.

const ORIGINAL_CWD = process.cwd();

let project: string;

async function readConfig(): Promise<{ testing?: { mode: string } }> {
  return JSON.parse(
    await readFile(join(project, "saasaloy.json"), "utf-8")
  ) as { testing?: { mode: string } };
}

async function readAgents(): Promise<string> {
  return readFile(join(project, "AGENTS.md"), "utf-8");
}

/** stdout (the clack rail and the bare mode word) and the exit code. */
async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  try {
    return { code: await runTesting(argv), out: lines.join("") };
  } finally {
    process.stdout.write = originalWrite;
  }
}

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), "saasaloy-testing-"));
  await scaffoldProject({
    projectName: "demo",
    target: project,
    testingMode: "tdd",
  });
  process.chdir(project);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(project, { recursive: true, force: true });
});

describe("testing — parseArgs", () => {
  it("reads the mode off the first positional", () => {
    expect(parseArgs(["tdd"])).toStrictEqual({
      abort: false,
      mode: "tdd",
      unknown: [],
    });
  });

  it("reports an unknown flag and a second positional", () => {
    expect(parseArgs(["tdd", "off", "--force"]).unknown).toStrictEqual([
      "--force",
      "off",
    ]);
  });
});

describe("runTesting — print", () => {
  it("prints the bare mode word on stdout", async () => {
    const { code, out } = await run([]);

    expect(code).toBe(0);
    expect(out).toBe("tdd\n");
  });

  it("prints off for a project with no testing key", async () => {
    const { testing: _dropped, ...config } = await readConfig();
    await writeFile(join(project, "saasaloy.json"), JSON.stringify(config));

    const { out } = await run([]);

    expect(out).toBe("off\n");
  });
});

describe("runTesting — refusals", () => {
  it("refuses a bad mode with exit 2 and changes nothing", async () => {
    const agents = await readAgents();

    const { code, out } = await run(["bogus"]);

    expect(code).toBe(2);
    expect(out).toContain('Unknown testing mode "bogus"');
    expect((await readConfig()).testing).toStrictEqual({ mode: "tdd" });
    await expect(readAgents()).resolves.toBe(agents);
  });

  it("refuses an unknown argument with exit 2", async () => {
    const { code, out } = await run(["off", "--force"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): --force");
  });

  it("refuses outside a project with exit 2", async () => {
    await rm(join(project, "saasaloy.json"));

    const { code } = await run(["off"]);

    expect(code).toBe(2);
  });
});
