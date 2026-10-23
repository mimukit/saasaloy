import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseRecord, recordBaseFiles, templateHash } from "../lib/base.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { emptyLock, saveLock } from "../lib/lock.js";
import { emptyManifest, loadManifest, saveManifest } from "../lib/manifest.js";
import {
  baseTemplateDir,
  copyTemplate,
  templateVars,
} from "../lib/scaffold.js";
import { TESTING_BLOCKS } from "../lib/testing.js";
import { stripAnsi } from "../lib/tui.js";
import { parseArgs, runTesting } from "./testing.js";

// `saasaloy testing [mode]` (#242): print the mode, or change it in `saasaloy.json` and in
// the root `AGENTS.md` block together. Each case runs against a project scaffolded and
// recorded the way `init --testing=tdd` leaves one, so the clean-file rule is exercised
// against real recorded hashes.

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
  const templateDir = await baseTemplateDir();
  const written = await copyTemplate(
    templateDir,
    project,
    templateVars(basename(project)),
    { testingMode: "tdd" }
  );
  const config = await readConfig();
  await writeFile(
    join(project, "saasaloy.json"),
    `${JSON.stringify({ ...config, testing: { mode: "tdd" } }, null, 2)}\n`,
    "utf-8"
  );
  const manifest = emptyManifest();
  recordBaseFiles(manifest, written);
  await saveManifest(project, manifest);
  await saveLock(project, {
    ...emptyLock(),
    base: baseRecord("0.0.0", await templateHash(templateDir)),
  });
  process.chdir(project);
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  await rm(project, { recursive: true, force: true });
});

describe("testing — parseArgs", () => {
  it("reads the mode off the first positional", () => {
    expect(parseArgs(["tdd"])).toStrictEqual({ mode: "tdd", unknown: [] });
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

describe("runTesting — change", () => {
  it("changes the mode in saasaloy.json and the AGENTS.md block, then prints it", async () => {
    const { code } = await run(["off"]);

    expect(code).toBe(0);
    expect((await readConfig()).testing).toStrictEqual({ mode: "off" });
    const agents = await readAgents();
    expect(agents).toContain(TESTING_BLOCKS.off);
    expect(agents).not.toContain(TESTING_BLOCKS.tdd);
    await expect(run([])).resolves.toMatchObject({ out: "off\n" });
  });

  it("records the new AGENTS.md hash when the file was clean", async () => {
    await run(["tests-after"]);

    const manifest = await loadManifest(project);
    expect(manifest.managed["AGENTS.md"]?.hash).toBe(
      hashContent(await readAgents())
    );
  });

  it("rewrites the block but keeps the recorded hash when the file was edited", async () => {
    const before = (await loadManifest(project)).managed["AGENTS.md"]?.hash;
    await writeFile(
      join(project, "AGENTS.md"),
      `${await readAgents()}\n- my own rule\n`,
      "utf-8"
    );

    const { code } = await run(["off"]);

    expect(code).toBe(0);
    const agents = await readAgents();
    expect(agents).toContain(TESTING_BLOCKS.off);
    expect(agents).toContain("- my own rule");
    expect((await loadManifest(project)).managed["AGENTS.md"]?.hash).toBe(
      before
    );
  });

  it("writes the mode, warns with the file name and exits 0 when the markers are gone", async () => {
    await writeFile(join(project, "AGENTS.md"), "# my rules\n", "utf-8");

    const { code, out } = await run(["off"]);

    expect(code).toBe(0);
    expect((await readConfig()).testing).toStrictEqual({ mode: "off" });
    expect(out).toContain("AGENTS.md");
    expect(out).toContain("<!-- saasaloy:testing -->");
    await expect(readAgents()).resolves.toBe("# my rules\n");
  });

  it("deletes no test file when testing turns off", async () => {
    const test = join(project, "apps", "api", "src", "routes", "auth.test.ts");
    await mkdir(join(test, ".."), { recursive: true });
    await writeFile(test, "test\n", "utf-8");
    const manifest = await loadManifest(project);
    manifest.managed["apps/api/src/routes/auth.test.ts"] = {
      hash: hashContent("test\n"),
      module: "auth",
    };
    await saveManifest(project, manifest);

    await run(["off"]);

    await expect(pathExists(test)).resolves.toBeTruthy();
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
