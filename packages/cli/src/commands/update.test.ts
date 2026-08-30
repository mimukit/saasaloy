import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { stripAnsi } from "../lib/tui.js";
import { runUpdate } from "./update.js";

// Both guards here reject bad input *before* the command reaches the registry, which is
// what keeps these tests offline. A value flag that swallowed the next flag would carry
// "--dry-run" into a ref lookup, and an `--out` aimed at a state file would replace it
// with merge-plan prose after the ledger had already been saved.

const ORIGINAL_CWD = process.cwd();

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-update-guards-"));
  await writeFile(
    join(dir, "saasaloy.json"),
    JSON.stringify({ aliases: { "@web": "apps/web" }, installed: ["email"] }),
    "utf-8"
  );
  process.chdir(dir);
});

afterAll(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(dir, { recursive: true, force: true });
});

// The update TUI writes to stderr so stdout stays reserved for the merge plan.
function capture(): { lines: string[]; restore: () => void } {
  const lines: string[] = [];
  const originalWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  return {
    lines,
    restore() {
      process.stderr.write = originalWrite;
    },
  };
}

async function runCaptured(argv: string[]): Promise<[number, string]> {
  const captured = capture();
  let code: number;
  try {
    code = await runUpdate(argv);
  } finally {
    captured.restore();
  }
  return [code, captured.lines.join("")];
}

describe("runUpdate value flags", () => {
  it("rejects `--ref` when the next token is another flag", async () => {
    const [code, output] = await runCaptured(["email", "--ref", "--dry-run"]);
    expect(code).toBe(1);
    expect(output).toContain("--ref (missing value)");
  });

  it("rejects `--ref` at the end of the argv", async () => {
    const [code, output] = await runCaptured(["email", "--ref"]);
    expect(code).toBe(1);
    expect(output).toContain("--ref (missing value)");
  });

  it("still accepts the inline `--ref=<value>` form", async () => {
    // Reaches the "needs an explicit module" guard, which proves the ref was parsed.
    const [code, output] = await runCaptured(["--ref=v2"]);
    expect(code).toBe(1);
    expect(output).toContain("`--ref` needs an explicit module");
  });
});

describe("runUpdate --out", () => {
  it.each([
    ["saasaloy.json"],
    ["saasaloy-lock.json"],
    [join(".saasaloy", "manifest.json")],
  ])("refuses to write the merge plan over %s", async (target) => {
    const [code, output] = await runCaptured(["--out", target]);
    expect(code).toBe(1);
    expect(output).toContain("Refusing to write the merge plan");
  });

  it("refuses an absolute path that resolves to a state file", async () => {
    const [code, output] = await runCaptured([
      "--out",
      join(dir, "saasaloy-lock.json"),
    ]);
    expect(code).toBe(1);
    expect(output).toContain("Refusing to write the merge plan");
  });
});
