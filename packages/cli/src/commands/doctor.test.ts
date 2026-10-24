import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { stripAnsi } from "../lib/tui.js";
import { runJson } from "../../test/support/json-run.js";
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
      json: false,
      path: "modules/waitlist",
      unknown: [],
    });
  });

  it("reads --json as a flag, not a path", () => {
    expect(parseArgs(["modules", "--json"])).toStrictEqual({
      json: true,
      path: "modules",
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

  // #107. The default path is the current directory, so a bare `doctor` run inside a
  // scaffolded project lands in project mode without needing `doctor .` named explicitly.
  describe("a bare run inside a project", () => {
    const original = process.cwd();

    afterEach(() => {
      process.chdir(original);
    });

    it("checks the project directly, with no path named", async () => {
      const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-project-"));
      temps.push(project);
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ aliases: {}, installed: [] })
      );
      process.chdir(project);

      const { code, out } = await run([]);

      expect(code).toBe(0);
      expect(out).not.toContain("No such path");
    });

    it("checks the registry layout in a directory that is no project", async () => {
      const plain = await mkdtemp(join(tmpdir(), "saasaloy-doctor-plain-"));
      temps.push(plain);
      process.chdir(plain);

      const { code, out } = await run([]);

      expect(code).toBe(2);
      expect(out).toContain("No module folders in .");
    });
  });

  // #229: a core installed without any of the owners its `requiresOneOf` names.
  it("reports an installed module whose requiresOneOf is unmet, and exits 2", async () => {
    const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-requires-"));
    temps.push(project);
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: {}, installed: ["api-keys"] })
    );
    await mkdir(join(project, ".saasaloy"));
    await writeFile(
      join(project, ".saasaloy", "manifest.json"),
      JSON.stringify({
        managed: {
          "keys.ts": { module: "api-keys", hash: hashContent("k\n") },
        },
      })
    );
    await writeFile(join(project, "keys.ts"), "k\n");
    await writeFile(
      join(project, "saasaloy-lock.json"),
      JSON.stringify({
        lockfileVersion: 1,
        modules: {
          "api-keys": {
            source: "local",
            ref: "local",
            resolved: "local",
            requiresOneOf: ["api-keys-organization", "api-keys-user"],
          },
        },
      })
    );

    const { code, out } = await run([project]);

    expect(code).toBe(2);
    // The note box wraps the line, so the second command may straddle a border.
    expect(out).toContain("api-keys  needs one of");
    expect(out).toContain("saasaloy add api-keys-organization");
    expect(out).toMatch(/saasaloy add[\s│]+api-keys-user/);
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

  // ADR 0048: the deploy rules warn and print the fix, and never fail the run.
  describe("the deploy warnings of a project", () => {
    it("warns about the retired task and a workspace with no row, and exits 0", async () => {
      const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-deploy-"));
      temps.push(project);
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ aliases: {}, installed: [] })
      );
      await writeFile(
        join(project, "turbo.json"),
        JSON.stringify({
          tasks: {
            deploy: { dependsOn: ["^build", "^db:migrate:prod"] },
            "db:migrate:prod": { cache: false },
          },
        })
      );
      await mkdir(join(project, "apps", "api"), { recursive: true });
      await writeFile(
        join(project, "apps", "api", "package.json"),
        JSON.stringify({
          name: "@repo/api",
          scripts: { deploy: "env-deploy api" },
        })
      );
      await writeFile(join(project, "apps", "api", "wrangler.jsonc"), "{}");
      await mkdir(join(project, "packages", "tooling", "src"), {
        recursive: true,
      });
      await writeFile(
        join(project, "packages", "tooling", "src", "targets.ts"),
        'export const DEPLOY_TARGETS = [{ service: "web", order: 30 }];\n'
      );

      const { code, out } = await run([project]);

      expect(code).toBe(0);
      expect(out).toContain("Deploy warnings");
      expect(out).toContain("turbo.json still names db:migrate:prod");
      expect(out).toContain("apps/api deploys and has no DEPLOY_TARGETS row");
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

// `--json` (#223): the same findings as data, the exit code unchanged.
describe("runDoctor --json (#223)", () => {
  const original = process.cwd();

  afterEach(() => {
    process.chdir(original);
  });

  it("prints a clean registry as one document and exits 0", async () => {
    const { code, doc, err } = await runJson(runDoctor, [CLEAN, "--json"]);

    expect(code).toBe(0);
    expect(doc).toStrictEqual({
      mode: "registry",
      modules: [
        { findings: [], module: "alpha", warnings: [] },
        { findings: [], module: "beta", warnings: [] },
      ],
      path: CLEAN,
      problems: 0,
      schemaVersion: 1,
    });
    expect(err).toContain("No problems found.");
  });

  it("prints every finding of a broken registry and still exits 2", async () => {
    const { code, doc } = await runJson(runDoctor, [BROKEN, "--json"]);

    expect(code).toBe(2);
    const modules = doc.modules as {
      module: string;
      findings: { where: string; message: string }[];
    }[];
    const noDescription = modules.find((m) => m.module === "no-description");
    expect(noDescription?.findings.map((f) => f.where)).toStrictEqual([
      "/description",
    ]);
    expect(doc.problems).toBe(
      modules.reduce((sum, m) => sum + m.findings.length, 0)
    );
  });

  it("prints the project report in project mode", async () => {
    const project = await mkdtemp(join(tmpdir(), "saasaloy-doctor-json-"));
    temps.push(project);
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: {}, installed: [] })
    );
    process.chdir(project);

    const { code, doc } = await runJson(runDoctor, ["--json"]);

    expect(code).toBe(0);
    expect(doc).toMatchObject({
      base: { status: "untracked" },
      findings: [],
      installed: [],
      mode: "project",
      problems: 0,
      schemaVersion: 1,
    });
  });

  it("prints an error document for a path that does not exist", async () => {
    const { code, doc } = await runJson(runDoctor, [
      join(tmpdir(), "saasaloy-doctor-absent"),
      "--json",
    ]);

    expect(code).toBe(2);
    expect(doc).toMatchObject({
      error: { exitCode: 2, message: expect.stringContaining("No such path") },
      schemaVersion: 1,
    });
  });
});
