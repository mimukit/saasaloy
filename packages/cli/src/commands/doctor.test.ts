import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, runDoctor } from "./doctor.js";

// `doctor` exists so a module author finds a broken descriptor before a stranger does, so
// the exit code carries as much as the output: 2 on any finding, which makes it usable as
// a pre-publish gate.

const CLEAN = fileURLToPath(
  new URL("../../test/fixtures/registry-clean", import.meta.url)
);
const BROKEN = fileURLToPath(
  new URL("../../test/fixtures/registry-broken", import.meta.url)
);

const temps: string[] = [];

afterAll(async () => {
  await Promise.all(
    temps.map((dir) => rm(dir, { recursive: true, force: true }))
  );
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

async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const captured = capture();
  try {
    return { code: await runDoctor(argv), out: captured.lines.join("") };
  } finally {
    captured.restore();
  }
}

describe("doctor — parseArgs", () => {
  it("reads the path off the first positional", () => {
    expect(parseArgs(["modules/waitlist"])).toStrictEqual({
      path: "modules/waitlist",
      unknown: [],
    });
  });

  it("leaves the path undefined when nothing is named", () => {
    expect(parseArgs([]).path).toBeUndefined();
  });

  it("reports a flag it does not know", () => {
    expect(parseArgs(["--strict"]).unknown).toStrictEqual(["--strict"]);
  });

  it("reports a second positional", () => {
    expect(parseArgs(["a", "b"]).unknown).toStrictEqual(["b"]);
  });

  it("keeps --help out of the unknown list", () => {
    expect(parseArgs(["--help"]).unknown).toStrictEqual([]);
  });
});

describe("runDoctor — what it reports and what it exits with", () => {
  it("exits 0 and says so when a registry is clean", async () => {
    const { code, out } = await run([CLEAN]);

    expect(code).toBe(0);
    expect(out).toContain("Checked 2 modules");
    expect(out).toContain("No problems found.");
  });

  it("checks a single module folder when pointed at one", async () => {
    const { code, out } = await run([join(CLEAN, "beta")]);

    expect(code).toBe(0);
    expect(out).toContain("Checked 1 module");
    expect(out).not.toContain("alpha");
  });

  it("exits 2 and counts the problems when a registry is broken", async () => {
    const { code, out } = await run([BROKEN]);

    expect(code).toBe(2);
    expect(out).toMatch(/\d+ problems in \d+ modules\./);
  });

  it("names the module each finding belongs to", async () => {
    const { out } = await run([BROKEN]);

    expect(out).toContain("unknown-alias");
    expect(out).toContain("ghost-dep");
  });

  it("reports how many modules were clean", async () => {
    const { out } = await run([BROKEN]);

    expect(out).toContain("Checked 9 modules; 0 clean.");
  });

  it("refuses an unknown flag", async () => {
    const { code, out } = await run([CLEAN, "--strict"]);

    expect(code).toBe(2);
    expect(out).toContain("Unknown argument(s): --strict");
  });

  it("refuses a path that does not exist", async () => {
    const { code, out } = await run([join(tmpdir(), "saasaloy-doctor-absent")]);

    expect(code).toBe(2);
    expect(out).toContain("No such path");
  });

  it("refuses a directory that holds no module folders", async () => {
    const empty = await mkdtemp(join(tmpdir(), "saasaloy-doctor-empty-"));
    temps.push(empty);

    const { code, out } = await run([empty]);

    expect(code).toBe(2);
    expect(out).toContain("No module folders in");
  });

  it("prints help without checking anything", async () => {
    const logged: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    let code: number;
    try {
      code = await runDoctor(["--help"]);
    } finally {
      console.log = originalLog;
    }

    expect(code).toBe(0);
    expect(stripAnsi(logged.join("\n"))).toContain("saasaloy doctor [<path>]");
  });
});
