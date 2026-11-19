import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  baseTemplateDir,
  copyTemplate,
  templateVars,
} from "../lib/scaffold.js";
import { stripAnsi } from "../lib/tui.js";
import { runJson } from "../../test/support/json-run.js";
import {
  DEFAULT_PROJECT_NAME,
  parseArgs,
  projectNameForVars,
  renderBundledSkill,
  runSkill,
} from "./skill.js";

// `saasaloy skill [<name>]` (#359, ADR 0064) prints a base skill from the running CLI's
// own package, so stdout is the contract: the skill's bytes exactly as `init` writes
// them, the list, or one JSON document. Everything else goes to stderr.

const ORIGINAL_CWD = process.cwd();
const temps: string[] = [];

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/** The skill folders the bundled template holds, read straight off disk. */
async function templateSkillNames(): Promise<string[]> {
  const dir = join(await baseTemplateDir(), "_agents/skills");
  const entries = await readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/** Run `skill` with stdout and stderr captured apart, raw. */
async function run(
  argv: string[]
): Promise<{ code: number; out: string; err: string }> {
  const out: string[] = [];
  const err: string[] = [];
  const writeOut = process.stdout.write.bind(process.stdout);
  const writeErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk: string | Uint8Array) => {
    out.push(String(chunk));
    return true;
  };
  process.stderr.write = (chunk: string | Uint8Array) => {
    err.push(stripAnsi(String(chunk)));
    return true;
  };
  let code: number;
  try {
    code = await runSkill(argv);
  } finally {
    process.stdout.write = writeOut;
    process.stderr.write = writeErr;
  }
  return { code, err: err.join(""), out: out.join("") };
}

let outside: string;

beforeAll(async () => {
  outside = await tempDir("saasaloy-skill-outside-");
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
});

afterAll(async () => {
  await Promise.all(
    temps.map((dir) => rm(dir, { force: true, recursive: true }))
  );
});

describe("skill — parseArgs", () => {
  it("reads the name off the first positional and flags an extra one", () => {
    expect(parseArgs(["saasaloy-update", "--json", "extra"])).toStrictEqual({
      json: true,
      name: "saasaloy-update",
      unknown: ["extra"],
    });
  });
});

describe("skill <name>", () => {
  it("prints a skill byte for byte as init writes it", async () => {
    const rendered = await tempDir("saasaloy-skill-init-");
    await copyTemplate(
      await baseTemplateDir(),
      rendered,
      templateVars(DEFAULT_PROJECT_NAME)
    );
    const written = await readFile(
      join(rendered, ".agents/skills/saasaloy-update/SKILL.md"),
      "utf-8"
    );
    process.chdir(outside);

    const result = await run(["saasaloy-update"]);

    expect(result.code).toBe(0);
    expect(result.out).toBe(written);
    expect(result.err).toBe("");
  });

  it("renders the template vars with the project's own name inside a project", async () => {
    const project = await tempDir("saasaloy-skill-project-");
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({
        ...(JSON.parse(
          await readFile(
            join(await baseTemplateDir(), "saasaloy.json"),
            "utf-8"
          )
        ) as object),
        name: "acme-shop",
      }),
      "utf-8"
    );
    const skills = await tempDir("saasaloy-skill-fixture-");
    await mkdir(join(skills, "probe"));
    await writeFile(
      join(skills, "probe", "SKILL.md"),
      "name {{PROJECT_NAME}} at {{CLI_VERSION}}\n",
      "utf-8"
    );

    const rendered = await renderBundledSkill("probe", "acme-shop", skills);

    expect(rendered).toBe(
      `name acme-shop at ${templateVars("acme-shop").CLI_VERSION}\n`
    );

    // The run reads the name from saasaloy.json, never from the folder.
    process.chdir(project);
    await expect(projectNameForVars()).resolves.toBe("acme-shop");
    process.chdir(outside);
    await expect(projectNameForVars()).resolves.toBe(DEFAULT_PROJECT_NAME);
  });

  it("refuses an unknown name with exit 2, names the known skills, and keeps stdout empty", async () => {
    process.chdir(outside);

    const result = await run(["nope"]);

    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("nope");
    for (const name of await templateSkillNames()) {
      expect(result.err).toContain(name);
    }
  });

  it("refuses an unknown flag with exit 2 and keeps stdout empty", async () => {
    process.chdir(outside);

    const result = await run(["saasaloy-update", "--bogus"]);

    expect(result.code).toBe(2);
    expect(result.out).toBe("");
    expect(result.err).toContain("--bogus");
  });

  it("prints the skill as one JSON document under --json", async () => {
    process.chdir(outside);
    const plain = await run(["saasaloy-update"]);

    const json = await runJson(runSkill, ["saasaloy-update", "--json"]);

    expect(json.code).toBe(0);
    expect(json.doc).toMatchObject({
      content: plain.out,
      name: "saasaloy-update",
      schemaVersion: 1,
    });
    expect(json.doc.description).toMatch(/saasaloy update/);
  });

  it("prints an error document for an unknown name under --json", async () => {
    process.chdir(outside);

    const json = await runJson(runSkill, ["nope", "--json"]);

    expect(json.code).toBe(2);
    expect(json.doc).toMatchObject({ error: { exitCode: 2 } });
  });
});

describe("skill in a project whose saasaloy.json is broken", () => {
  // A broken config is the state an agent may be reporting, so the skill still prints:
  // a warning on stderr, the default name in the vars, and exit 0 (#359).
  it("warns on stderr and still prints the skill", async () => {
    const project = await tempDir("saasaloy-skill-broken-");
    await writeFile(join(project, "saasaloy.json"), "{ nope", "utf-8");
    process.chdir(outside);
    const clean = await run(["saasaloy-update"]);
    process.chdir(project);

    const result = await run(["saasaloy-update"]);

    expect(result.code).toBe(0);
    expect(result.out).toBe(clean.out);
    expect(result.err).toContain("saasaloy.json");
  });

  it("keeps stdout one JSON document under --json", async () => {
    const project = await tempDir("saasaloy-skill-broken-json-");
    await writeFile(join(project, "saasaloy.json"), "{ nope", "utf-8");
    process.chdir(project);

    const json = await runJson(runSkill, ["saasaloy-update", "--json"]);

    expect(json.code).toBe(0);
    expect(json.doc).toMatchObject({
      name: "saasaloy-update",
      schemaVersion: 1,
    });
  });
});

describe("skill (no name)", () => {
  it("lists every skill folder in the template with its description", async () => {
    process.chdir(outside);

    const result = await run([]);

    expect(result.code).toBe(0);
    expect(result.err).toBe("");
    const lines = result.out.trimEnd().split("\n");
    const names = await templateSkillNames();
    expect(lines.map((line) => line.split(" ")[0])).toStrictEqual(names);
    for (const line of lines) {
      expect(line.slice(line.split(" ")[0]!.length).trim()).not.toBe("");
    }
  });

  it("prints the list as one JSON document under --json", async () => {
    process.chdir(outside);

    const json = await runJson(runSkill, ["--json"]);

    expect(json.code).toBe(0);
    const skills = json.doc.skills as { name: string; description: string }[];
    expect(skills.map((skill) => skill.name)).toStrictEqual(
      await templateSkillNames()
    );
    for (const skill of skills) {
      expect(skill.description).not.toBe("");
    }
  });
});

describe("skill --help", () => {
  it("prints usage and exits 0", async () => {
    const logged: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((line: string) => {
      logged.push(stripAnsi(line));
    });
    let code: number;
    try {
      code = await runSkill(["--help"]);
    } finally {
      spy.mockRestore();
    }

    expect(code).toBe(0);
    expect(logged.join("\n")).toContain("saasaloy skill [<name>] [--json]");
  });
});
