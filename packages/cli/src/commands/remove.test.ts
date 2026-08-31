import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { stripAnsi } from "../lib/tui.js";
import { runRemove } from "./remove.js";

// Same hazard as `add`: `remove` with no module opens a picker, which without a terminal
// would hang forever instead of failing.

const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;
const ORIGINAL_CWD = process.cwd();

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "saasaloy-remove-tty-"));
  // One installed module, so the command gets past "nothing installed" and reaches the
  // picker branch.
  await writeFile(
    join(dir, "saasaloy.json"),
    JSON.stringify({
      aliases: { "@web": "apps/web" },
      installed: ["waitlist"],
    }),
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

describe("runRemove without a module name", () => {
  it("fails with the usage line instead of opening a prompt nobody can answer", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const captured = capture();
    let code: number;
    try {
      code = await runRemove([]);
    } finally {
      captured.restore();
    }
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("saasaloy remove [<module>]");
  });

  it("also refuses when only stdout is redirected", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const captured = capture();
    let code: number;
    try {
      code = await runRemove([]);
    } finally {
      captured.restore();
    }
    expect(code).toBe(2);
    expect(captured.lines.join("")).toContain("saasaloy remove [<module>]");
  });
});
