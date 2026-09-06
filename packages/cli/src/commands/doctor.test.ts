import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { hashContent, pathExists } from "../lib/fs-utils.js";
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

    // No exact count: adding a broken fixture must not break this test.
    expect(out).toMatch(/Checked \d+ modules; 0 clean\./);
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
    expect(out).not.toContain("saasaloy doctor .");
  });

  // #107. The default path is the registry layout, which a scaffolded project does not
  // have, so a bare `doctor` there refuses. That refusal is where the project user has to
  // find the project mode.
  describe("a bare run inside a project", () => {
    const original = process.cwd();

    afterEach(() => {
      process.chdir(original);
    });

    it("names `doctor .` when the directory carries a saasaloy.json", async () => {
      const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-project-"));
      temps.push(project);
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ installed: [] })
      );
      process.chdir(project);

      const { code, out } = await run([]);

      expect(code).toBe(2);
      expect(out).toContain("No such path: modules");
      expect(out).toContain("saasaloy doctor .");
    });

    it("stays silent about it in a directory that is no project", async () => {
      const plain = await mkdtemp(join(tmpdir(), "saasaloy-doctor-plain-"));
      temps.push(plain);
      process.chdir(plain);

      const { code, out } = await run([]);

      expect(code).toBe(2);
      expect(out).not.toContain("saasaloy doctor .");
    });
  });

  // #120: the Base box in project mode. Drift is information, so it never turns exit 0
  // into 2, and an unrecorded base is reported and left alone.
  describe("the Base section of a project", () => {
    it("reports an unrecorded base as untracked, exits 0, and writes nothing", async () => {
      const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-base-"));
      temps.push(project);
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ aliases: {}, installed: [] })
      );

      const { code, out } = await run([project]);

      expect(code).toBe(0);
      expect(out).toContain("untracked");
      expect(out).toContain("saasaloy update");
      await expect(pathExists(join(project, ".saasaloy"))).resolves.toBeFalsy();
      await expect(
        pathExists(join(project, "saasaloy-lock.json"))
      ).resolves.toBeFalsy();
    });

    it("names the recorded CLI, the drifted files, and the seed files it did not check", async () => {
      const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-base-"));
      temps.push(project);
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ aliases: {}, installed: [] })
      );
      await writeFile(join(project, "AGENTS.md"), "a\n");
      await writeFile(join(project, "CLAUDE.md"), "edited\n");
      await writeFile(join(project, "README.md"), "rewritten\n");
      await mkdir(join(project, ".saasaloy"));
      await writeFile(
        join(project, ".saasaloy", "manifest.json"),
        JSON.stringify({
          managed: {
            "AGENTS.md": { module: "base", hash: hashContent("a\n") },
            "CLAUDE.md": { module: "base", hash: hashContent("c\n") },
            "README.md": { module: "base", hash: hashContent("seed\n") },
          },
        })
      );
      await writeFile(
        join(project, "saasaloy-lock.json"),
        JSON.stringify({
          lockfileVersion: 1,
          modules: {},
          base: {
            name: "web",
            cliVersion: "0.3.0",
            templateHash: "f".repeat(64),
          },
        })
      );

      const { code, out } = await run([project]);

      expect(code).toBe(0);
      expect(out).toContain("recorded at CLI 0.3.0");
      expect(out).toContain("1 file match");
      expect(out).toContain("CLAUDE.md");
      expect(out).toContain("edited since");
      expect(out).toContain("seed, not checked: README.md");
      expect(out).toContain("No problems found");
    });
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
