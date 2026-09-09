import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import {
  BASE_INTENT,
  BASE_MODULE,
  baseEntries,
  baseRecord,
  recordBaseFiles,
  templateHash,
} from "../lib/base.js";
import { EXIT_MERGE_PENDING } from "../lib/exit.js";
import { hashContent, pathExists } from "../lib/fs-utils.js";
import { emptyLock, loadLock, saveLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { emptyManifest, loadManifest, saveManifest } from "../lib/manifest.js";
import type { Manifest } from "../lib/manifest.js";
import { REGISTRY_ENV } from "../lib/registry.js";
import {
  baseTemplateDir,
  copyTemplate,
  templateVars,
} from "../lib/scaffold.js";
import { stripAnsi } from "../lib/tui.js";
import { readVersion } from "../version.js";
import { runUpdate } from "./update.js";

// Both guards here reject bad input *before* the command reaches the registry, which is
// what keeps these tests offline. A value flag that swallowed the next flag would carry
// "--dry-run" into a ref lookup, and an `--out` aimed at a state file would replace it
// with merge-plan prose after the ledger had already been saved.

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_STDIN_TTY = process.stdin.isTTY;
const ORIGINAL_STDOUT_TTY = process.stdout.isTTY;

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
    expect(code).toBe(2);
    expect(output).toContain("--ref (missing value)");
  });

  it("rejects `--ref` at the end of the argv", async () => {
    const [code, output] = await runCaptured(["email", "--ref"]);
    expect(code).toBe(2);
    expect(output).toContain("--ref (missing value)");
  });

  it("still accepts the inline `--ref=<value>` form", async () => {
    // Reaches the "needs an explicit module" guard, which proves the ref was parsed.
    const [code, output] = await runCaptured(["--ref=v2"]);
    expect(code).toBe(2);
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
    expect(code).toBe(2);
    expect(output).toContain("Refusing to write the merge plan");
  });

  it("refuses an absolute path that resolves to a state file", async () => {
    const [code, output] = await runCaptured([
      "--out",
      join(dir, "saasaloy-lock.json"),
    ]);
    expect(code).toBe(2);
    expect(output).toContain("Refusing to write the merge plan");
  });
});

// #98 Phase 5. `update` used to read a non-TTY *stdout* as "a script is driving me" and
// set `--yes` for itself. But stdout is where the merge plan goes, so `saasaloy update |
// tee log` applied every file unconfirmed. stdin is the stream the prompt actually reads,
// and a non-TTY stdin with no `--yes` means nobody can answer — so it refuses.
describe("runUpdate — the confirmation gate (#98)", () => {
  let project: string;

  // A fresh project per test. A run that gets past the gate adopts the base and records
  // every template file as missing from this empty directory, so a shared project would
  // leave the next test facing a 53-file restore plan instead of the gate.
  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-update-tty-"));
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed: [] }),
      "utf-8"
    );
    process.chdir(project);
  });

  afterEach(async () => {
    process.stdin.isTTY = ORIGINAL_STDIN_TTY;
    process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
    process.chdir(dir);
    await rm(project, { recursive: true, force: true });
  });

  it("refuses to apply when stdin isn't a terminal and `--yes` is absent", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured([]);
    expect(code).toBe(2);
    expect(output).toContain("No terminal to confirm in");
    // It refuses before the registry is reached, which is what keeps this test offline.
    expect(output).not.toContain("Nothing installed");
  });

  it("still refuses when only stdout is a terminal", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = true;
    const [code, output] = await runCaptured([]);
    expect(code).toBe(2);
    expect(output).toContain("No terminal to confirm in");
  });

  // Past the gate, a project with no base record is adopted and the run stops (#120);
  // the point here is only that the gate let it through.
  it("proceeds past the gate with `--yes` on a piped stdin", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured(["--yes"]);
    expect(code).toBe(0);
    expect(output).not.toContain("No terminal to confirm in");
  });

  it("proceeds past the gate for a preview, which writes nothing", async () => {
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured(["--dry-run"]);
    expect(code).toBe(0);
    expect(output).not.toContain("No terminal to confirm in");
  });

  it("proceeds past the gate on a terminal, with the merge plan piped away", async () => {
    process.stdin.isTTY = true;
    process.stdout.isTTY = false;
    const [code, output] = await runCaptured([]);
    expect(code).toBe(0);
    expect(output).not.toContain("No terminal to confirm in");
  });
});

// #98 Phase 5. `update` never imported `detectConflicts`, so a new version that pulls in
// a second driver installed it as a prerequisite — the exact pair `add` refuses. It also
// never read the new descriptor's `envVars`, so a version that starts requiring a secret
// updated in silence. Both run offline here, off a SAASALOY_REGISTRY_DIR checkout.
describe("runUpdate — conflicts and env vars (#98)", () => {
  let project: string;
  let registry: string;

  async function descriptor(
    name: string,
    item: Record<string, unknown>
  ): Promise<void> {
    const modDir = join(registry, name);
    await mkdir(modDir, { recursive: true });
    await writeFile(
      join(modDir, "registry-item.json"),
      JSON.stringify({ name, type: "saasaloy:feature", files: [], ...item }),
      "utf-8"
    );
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-update-conf-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-update-reg-"));
    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  async function state(
    installed: string[],
    modules: Record<string, unknown>
  ): Promise<void> {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed }),
      "utf-8"
    );
    // A tracked, current base, so a bare run goes on to the modules rather than
    // adopting the base and stopping (#120).
    await writeFile(
      join(project, "saasaloy-lock.json"),
      JSON.stringify({
        lockfileVersion: 1,
        modules,
        base: {
          name: "web",
          cliVersion: await readVersion(),
          templateHash: await templateHash(await baseTemplateDir()),
        },
      }),
      "utf-8"
    );
    await mkdir(join(project, ".saasaloy"), { recursive: true });
    await writeFile(
      join(project, ".saasaloy", "manifest.json"),
      JSON.stringify({
        managed: { "AGENTS.md": { module: "base", hash: "a".repeat(64) } },
      }),
      "utf-8"
    );
  }

  const localEntry = { source: "local", ref: "local", resolved: "local" };

  it("refuses an update whose new prerequisite conflicts with an installed module", async () => {
    await state(["widget", "driver-a"], {
      widget: localEntry,
      "driver-a": { ...localEntry, conflictsWith: ["driver-b"] },
    });
    await descriptor("widget", { dependsOn: ["driver-b"] });
    await descriptor("driver-b", { conflictsWith: ["driver-a"] });

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(2);
    expect(output).toContain("module conflict");
    expect(output).toContain("driver-a");
    expect(output).toContain("saasaloy remove driver-a");
    // Refused before anything landed: the lock still records only what was installed.
    const lock = JSON.parse(
      await readFile(join(project, "saasaloy-lock.json"), "utf-8")
    ) as { modules: Record<string, unknown> };
    expect(Object.keys(lock.modules).toSorted()).toStrictEqual([
      "driver-a",
      "widget",
    ]);
  });

  it("refuses a pair that arrives across two separate prerequisite graphs", async () => {
    // Neither graph alone holds both drivers, so the per-module check passes twice and
    // only the combined pass sees the pair.
    await state(["alpha", "beta"], { alpha: localEntry, beta: localEntry });
    await descriptor("alpha", { dependsOn: ["driver-a"] });
    await descriptor("beta", { dependsOn: ["driver-b"] });
    await descriptor("driver-a", { conflictsWith: ["driver-b"] });
    await descriptor("driver-b", {});

    const [code, output] = await runCaptured(["--yes"]);
    expect(code).toBe(2);
    expect(output).toContain("module conflict");
    expect(output).toContain("driver-a");
    expect(output).toContain("driver-b");
    // Refused before anything landed: the lock still records only what was installed.
    const lock = JSON.parse(
      await readFile(join(project, "saasaloy-lock.json"), "utf-8")
    ) as { modules: Record<string, unknown> };
    expect(Object.keys(lock.modules).toSorted()).toStrictEqual([
      "alpha",
      "beta",
    ]);
  });

  it("lets a non-conflicting update through", async () => {
    await state(["widget", "driver-a"], {
      widget: localEntry,
      "driver-a": { ...localEntry, conflictsWith: ["driver-b"] },
    });
    await descriptor("widget", {});

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(0);
    expect(output).not.toContain("module conflict");
  });

  it("names the env vars the new version requires before applying", async () => {
    await state(["widget"], { widget: localEntry });
    await descriptor("widget", {
      envVars: { WIDGET_TOKEN: "Signs widget callbacks" },
    });

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(0);
    expect(output).toContain("WIDGET_TOKEN");
    expect(output).toContain("Signs widget callbacks");
  });
});

// #120. The base rides the module engine. These run offline: the template ships with the
// CLI, so a "newer template" is simply a project whose lock records another hash and
// whose files differ from today's render.
describe("runUpdate — the base template (#120)", () => {
  let project: string;
  let templateDir: string;
  let runningHash: string;
  let cliVersion: string;

  /** stderr (the TUI) and stdout (the merge plan), both captured. */
  async function runBoth(
    argv: string[]
  ): Promise<{ code: number; err: string; out: string }> {
    const out: string[] = [];
    const originalOut = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk: string | Uint8Array) => {
      out.push(stripAnsi(String(chunk)));
      return true;
    };
    try {
      const [code, err] = await runCaptured(argv);
      return { code, err, out: out.join("") };
    } finally {
      process.stdout.write = originalOut;
    }
  }

  beforeAll(async () => {
    templateDir = await baseTemplateDir();
    runningHash = await templateHash(templateDir);
    cliVersion = await readVersion();
  });

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-update-base-"));
    process.chdir(project);
    process.stdin.isTTY = false;
    process.stdout.isTTY = false;
  });

  afterEach(async () => {
    process.chdir(dir);
    process.stdin.isTTY = ORIGINAL_STDIN_TTY;
    process.stdout.isTTY = ORIGINAL_STDOUT_TTY;
    await rm(project, { recursive: true, force: true });
  });

  /** A project `init` scaffolded with today's CLI, recorded exactly as `init` records it. */
  async function scaffolded(): Promise<{ manifest: Manifest; lock: Lockfile }> {
    const written = await copyTemplate(
      templateDir,
      project,
      templateVars(basename(project))
    );
    const manifest = emptyManifest();
    recordBaseFiles(manifest, written);
    const lock = { ...emptyLock(), base: baseRecord(cliVersion, runningHash) };
    await saveManifest(project, manifest);
    await saveLock(project, lock);
    return { manifest, lock };
  }

  /** Make the record say an older template rendered the project: another hash, and `AGENTS.md` at old bytes. */
  async function fromOlderTemplate(state: {
    manifest: Manifest;
    lock: Lockfile;
  }): Promise<void> {
    await writeFile(join(project, "AGENTS.md"), "old agent rules\n", "utf-8");
    state.manifest.managed["AGENTS.md"]!.hash =
      hashContent("old agent rules\n");
    state.lock.base = baseRecord("0.0.0", "f".repeat(64));
    await saveManifest(project, state.manifest);
    await saveLock(project, state.lock);
  }

  async function lockOnDisk(): Promise<Lockfile> {
    return loadLock(project);
  }

  it("adopts an unrecorded project at the running CLI, applies nothing, and exits 0", async () => {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: {}, installed: [] })
    );
    await writeFile(join(project, "AGENTS.md"), "my own rules\n", "utf-8");

    const { code, err } = await runBoth(["--yes"]);

    expect(code).toBe(0);
    expect(err).toMatch(/Adopted \d+ base files? at CLI/);
    expect(err).toContain("saasaloy update");
    await expect(readFile(join(project, "AGENTS.md"), "utf-8")).resolves.toBe(
      "my own rules\n"
    );
    const lock = await lockOnDisk();
    expect(lock.base).toStrictEqual(baseRecord(cliVersion, runningHash));
    const manifest = await loadManifest(project);
    expect(manifest.managed["AGENTS.md"]).toMatchObject({
      module: BASE_MODULE,
      hash: hashContent("my own rules\n"),
    });
  });

  it("re-adopts when the lock has a record but the manifest has no base entries", async () => {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: {}, installed: [] })
    );
    await saveLock(project, {
      ...emptyLock(),
      base: baseRecord("0.0.0", "f".repeat(64)),
    });

    const { code, err } = await runBoth(["--yes"]);

    expect(code).toBe(0);
    expect(err).toContain("Adopted");
    expect(
      Object.keys(baseEntries(await loadManifest(project))).length
    ).toBeGreaterThan(10);
  });

  it("previews the adoption under --dry-run and writes nothing", async () => {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: {}, installed: [] })
    );

    const { code, err } = await runBoth(["--dry-run"]);

    expect(code).toBe(0);
    expect(err).toMatch(/Would adopt \d+ base files?/);
    await expect(
      pathExists(join(project, "saasaloy-lock.json"))
    ).resolves.toBeFalsy();
    await expect(pathExists(join(project, ".saasaloy"))).resolves.toBeFalsy();
  });

  it("refuses a downgrade, naming both versions, and writes nothing", async () => {
    const state = await scaffolded();
    state.lock.base = baseRecord("99.0.0", "f".repeat(64));
    await saveLock(project, state.lock);

    const { code, err } = await runBoth(["--yes"]);

    expect(code).toBe(2);
    expect(err).toContain("99.0.0");
    expect(err).toContain(cliVersion);
    expect(err).toContain("Upgrade");
    expect((await lockOnDisk()).base?.cliVersion).toBe("99.0.0");
  });

  it("says the base is up to date when the recorded hash is the running one", async () => {
    await scaffolded();

    const { code, err } = await runBoth(["--yes"]);

    expect(code).toBe(0);
    expect(err).toContain("Everything is up to date");
  });

  it("overwrites a clean base file from an older template and moves the lock record", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);

    const { code, err, out } = await runBoth(["--yes"]);

    expect(code).toBe(0);
    expect(err).toContain("AGENTS.md");
    expect(out).toBe("");
    const now = await readFile(join(project, "AGENTS.md"), "utf-8");
    expect(now).not.toBe("old agent rules\n");
    expect((await lockOnDisk()).base).toStrictEqual(
      baseRecord(cliVersion, runningHash)
    );
    expect((await loadManifest(project)).managed["AGENTS.md"]?.hash).toBe(
      hashContent(now)
    );
  });

  it("routes a hand-edited base file to the merge plan on stdout and keeps the old record", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    await writeFile(
      join(project, "AGENTS.md"),
      "old agent rules, plus mine\n",
      "utf-8"
    );

    const { code, err, out } = await runBoth(["--yes"]);

    // 3, not 0: the run applied what it could and left a file waiting on a merge.
    expect(code).toBe(EXIT_MERGE_PENDING);
    expect(out).toContain("# Saasaloy merge plan");
    expect(out).toContain("## base");
    expect(out).toContain(BASE_INTENT);
    expect(out).toContain("AGENTS.md");
    expect(err).toContain("needs a merge");
    await expect(readFile(join(project, "AGENTS.md"), "utf-8")).resolves.toBe(
      "old agent rules, plus mine\n"
    );
    expect((await lockOnDisk()).base).toStrictEqual(
      baseRecord("0.0.0", "f".repeat(64))
    );
  });

  it("writes the merge plan to --out and shows a diff under --diff", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    await writeFile(
      join(project, "AGENTS.md"),
      "old agent rules, plus mine\n",
      "utf-8"
    );

    const diff = await runBoth(["--diff"]);
    expect(diff.code).toBe(0);
    expect(diff.err).toContain("drift → merge");
    expect(diff.err).toContain("- old agent rules, plus mine");

    const applied = await runBoth(["--yes", "--out", "plan.md"]);
    expect(applied.code).toBe(EXIT_MERGE_PENDING);
    expect(applied.out).toBe("");
    await expect(
      readFile(join(project, "plan.md"), "utf-8")
    ).resolves.toContain(BASE_INTENT);
  });

  it("never touches a seed file, however far it drifted", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    await writeFile(
      join(project, "README.md"),
      "rewritten by the owner\n",
      "utf-8"
    );
    state.manifest.managed["README.md"]!.hash = "0".repeat(64);
    await saveManifest(project, state.manifest);

    const { code, err, out } = await runBoth(["--yes"]);

    expect(code).toBe(0);
    expect(err).not.toContain("README.md");
    expect(out).not.toContain("README.md");
    await expect(readFile(join(project, "README.md"), "utf-8")).resolves.toBe(
      "rewritten by the owner\n"
    );
  });

  it("targets the base alone under `update base`, without reading the modules", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    // A module with no lock entry would be reported as unresolvable on a bare run.
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: {}, installed: ["ghost"] })
    );

    const { code, err } = await runBoth(["base", "--yes"]);

    expect(code).toBe(0);
    expect(err).not.toContain("ghost");
    expect((await lockOnDisk()).base).toStrictEqual(
      baseRecord(cliVersion, runningHash)
    );
  });

  it("refuses `--ref` on the base", async () => {
    await scaffolded();

    const { code, err } = await runBoth(["base", "--ref", "v2", "--yes"]);

    expect(code).toBe(2);
    expect(err).toContain("--ref");
  });

  // The incident this whole group of tests exists for (#144). A project adopted on one
  // run had every hand-edited file recorded at its own hash, and the next run read that
  // hash as proof the file was untouched template output and overwrote it.
  it("offers a merge for an adopted file rather than overwriting it", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    state.manifest.managed["AGENTS.md"]!.adopted = true;
    await saveManifest(project, state.manifest);

    const { code, out } = await runBoth(["--yes"]);

    expect(code).toBe(EXIT_MERGE_PENDING);
    expect(out).toContain("AGENTS.md");
    expect(out).toContain("adopted this file");
    await expect(readFile(join(project, "AGENTS.md"), "utf-8")).resolves.toBe(
      "old agent rules\n"
    );
  });

  it("never writes a file the template declares the project owns", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    const owned = join("packages", "ui", "src", "styles", "globals.css");
    await writeFile(join(project, owned), ":root { --mine: 1; }\n", "utf-8");
    // Recorded at the bytes on disk: by hash alone this file is pristine and writable.
    state.manifest.managed[owned.replaceAll("\\", "/")]!.hash = hashContent(
      ":root { --mine: 1; }\n"
    );
    await saveManifest(project, state.manifest);

    const { code } = await runBoth(["--yes"]);

    expect(code).toBe(EXIT_MERGE_PENDING);
    await expect(readFile(join(project, owned), "utf-8")).resolves.toBe(
      ":root { --mine: 1; }\n"
    );
  });

  it("takes the project name from saasaloy.json, not from the directory", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    const config = JSON.parse(
      await readFile(join(project, "saasaloy.json"), "utf-8")
    ) as Record<string, unknown>;
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ ...config, name: "unishopr" }),
      "utf-8"
    );

    await runBoth(["--yes"]);

    const pkg = JSON.parse(
      await readFile(join(project, "package.json"), "utf-8")
    ) as { name?: string };
    expect(pkg.name).toBe("unishopr");
    expect(pkg.name).not.toBe(basename(project));
  });

  it("backs up what it touches, and `--abort` puts it back", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);

    const applied = await runBoth(["--yes"]);
    expect(applied.code).toBe(0);
    expect(applied.err).toContain(".saasaloy/backups");
    const updated = await readFile(join(project, "AGENTS.md"), "utf-8");
    expect(updated).not.toBe("old agent rules\n");

    const aborted = await runBoth(["--abort"]);
    expect(aborted.code).toBe(0);
    await expect(readFile(join(project, "AGENTS.md"), "utf-8")).resolves.toBe(
      "old agent rules\n"
    );
    expect((await lockOnDisk()).base).toStrictEqual(
      baseRecord("0.0.0", "f".repeat(64))
    );
  });

  it("refuses `--abort` when there is no backup", async () => {
    await scaffolded();

    const { code, err } = await runBoth(["--abort"]);

    expect(code).toBe(2);
    expect(err).toContain("No backup to restore");
  });

  it("refuses a dirty git working tree, and applies under --force", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: project, stdio: "ignore" });
    git("init", "--initial-branch=main");
    git("config", "user.email", "test@example.com");
    git("config", "user.name", "test");
    git("add", "AGENTS.md");
    git("commit", "-m", "base");
    await writeFile(
      join(project, "AGENTS.md"),
      "edited, uncommitted\n",
      "utf-8"
    );

    const refused = await runBoth(["--yes"]);
    expect(refused.code).toBe(2);
    expect(refused.err).toContain("uncommitted changes");
    await expect(readFile(join(project, "AGENTS.md"), "utf-8")).resolves.toBe(
      "edited, uncommitted\n"
    );

    const forced = await runBoth(["--yes", "--force"]);
    expect(forced.code).toBe(EXIT_MERGE_PENDING);
  });
});
