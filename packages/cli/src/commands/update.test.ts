import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
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
import { EXIT_WORK_PENDING } from "../lib/exit.js";
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
import { TESTING_BLOCKS } from "../lib/testing.js";
import { stripAnsi } from "../lib/tui.js";
import { readVersion } from "../version.js";
import { finishUpToDate, runUpdate } from "./update.js";
import type { UpToDateSteps } from "./update.js";

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

/** stderr (the TUI) and stdout (the merge plan), both captured. */
async function runBothCaptured(
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

/** The four sections every update note holds (#298). */
const NOTE_SECTIONS = [
  "## What update does",
  "",
  "It writes a file.",
  "",
  "## What the merge plan gets",
  "",
  "Nothing.",
  "",
  "## What you do",
  "",
  "Nothing more.",
  "",
  "## Verify",
  "",
  "Run `pnpm check`.",
  "",
].join("\n");

/** The note ids a merge plan lists, split at its "may apply" subsection (#298). */
function noteIds(plan: string): { notes: string[]; mayApply: string[] } {
  const at = plan.indexOf("### Notes that may apply");
  const ids = (text: string): string[] =>
    [...text.matchAll(/^#{3,4} ([a-z0-9-]+\/\d{4}-[a-z0-9-]+): /gm)].map(
      (match) => match[1]!
    );
  return at === -1
    ? { notes: ids(plan), mayApply: [] }
    : { notes: ids(plan.slice(0, at)), mayApply: ids(plan.slice(at)) };
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
    modules: Record<string, unknown>,
    recorded?: string
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
          cliVersion: recorded ?? (await readVersion()),
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

  /** An update note in the fixture registry's copy of `name`. */
  async function updateNote(
    name: string,
    file: string,
    frontmatter: string
  ): Promise<void> {
    const notes = join(registry, name, "update-notes");
    await mkdir(notes, { recursive: true });
    await writeFile(
      join(notes, file),
      `---\n${frontmatter}\n---\n\n${NOTE_SECTIONS}`,
      "utf-8"
    );
  }

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

  // #229. A module split moves files out of a core into an owner the project must pick.
  // Without this check the new core lists fewer files, and the updater deletes every
  // unchanged file it no longer lists — the project's schema with it.
  it("refuses an update whose new version gains an unmet requiresOneOf, and deletes nothing", async () => {
    await state(["widget"], { widget: localEntry });
    const content = "export const widgets = 1;\n";
    await mkdir(join(project, "src"), { recursive: true });
    await writeFile(join(project, "src", "widget.ts"), content, "utf-8");
    const manifest = JSON.parse(
      await readFile(join(project, ".saasaloy", "manifest.json"), "utf-8")
    ) as { managed: Record<string, unknown> };
    manifest.managed["src/widget.ts"] = {
      module: "widget",
      hash: hashContent(content),
    };
    await writeFile(
      join(project, ".saasaloy", "manifest.json"),
      JSON.stringify(manifest),
      "utf-8"
    );
    await descriptor("widget", {
      requiresOneOf: ["widget-owner-a", "widget-owner-b"],
    });
    await descriptor("widget-owner-a", { dependsOn: ["widget"] });
    await descriptor("widget-owner-b", { dependsOn: ["widget"] });

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(2);
    expect(output).toContain("saasaloy add widget-owner-a");
    expect(output).toContain("saasaloy add widget-owner-b");
    await expect(
      readFile(join(project, "src", "widget.ts"), "utf-8")
    ).resolves.toBe(content);
    const after = JSON.parse(
      await readFile(join(project, ".saasaloy", "manifest.json"), "utf-8")
    ) as { managed: Record<string, unknown> };
    expect(after.managed["src/widget.ts"]).toBeDefined();
  });

  it("lets an update through when an installed module meets the new requiresOneOf", async () => {
    await state(["widget", "widget-owner-a"], {
      widget: localEntry,
      "widget-owner-a": localEntry,
    });
    await descriptor("widget", {
      requiresOneOf: ["widget-owner-a", "widget-owner-b"],
    });

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(0);
    expect(output).not.toContain("saasaloy add widget-owner");
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

  it("links a project's own skill folder, not only the skills a module names (#234)", async () => {
    await state(["widget"], { widget: localEntry });
    await descriptor("widget", {});
    await mkdir(join(project, ".agents", "skills", "project-own"), {
      recursive: true,
    });
    await mkdir(join(project, ".claude", "skills", "taken"), {
      recursive: true,
    });
    await mkdir(join(project, ".agents", "skills", "taken"), {
      recursive: true,
    });

    const [code, output] = await runCaptured(["widget", "--yes"]);

    expect(code).toBe(0);
    await expect(
      readlink(join(project, ".claude", "skills", "project-own"))
    ).resolves.toBe(join("..", "..", ".agents", "skills", "project-own"));
    expect(output).toContain(".claude/skills/project-own");
    expect(output).toContain("Skill link .claude/skills/taken left untouched");
  });

  // #298 Phase 3: a project whose lock predates the v0.8.0 notes gets, on stdout, exactly
  // the notes whose `when` holds for it. The base note comes from the real folder the CLI
  // ships; the module notes come from the fixture registry. `shell` arrives as a new
  // prerequisite, so its old folder is empty and its note applies outright; `widget` is a
  // working copy with no merge base, so its note may apply.
  describe("update notes (#298)", () => {
    async function fixture(installed: string[]): Promise<void> {
      await state(
        installed,
        Object.fromEntries(installed.map((name) => [name, localEntry])),
        "0.7.0"
      );
      await descriptor("widget", { dependsOn: ["shell"] });
      await descriptor("shell", {});
      await descriptor("admin", {});
      await updateNote("widget", "0001-widget-port.md", "title: Widget port");
      await updateNote(
        "shell",
        "0001-admin-kit-move.md",
        "title: Admin kit move\nwhen:\n  installed:\n    - admin"
      );
      await updateNote("shell", "0002-shell-css.md", "title: Shell css");
    }

    it("hands a project without admin every note but the admin one", async () => {
      await fixture(["widget"]);

      const { code, out } = await runBothCaptured(["--dry-run"]);

      expect(code).toBe(0);
      expect(out).toContain("## Update notes");
      expect(noteIds(out)).toStrictEqual({
        notes: ["base/0001-brand-css", "shell/0002-shell-css"],
        mayApply: ["widget/0001-widget-port"],
      });
    });

    it("hands a project with admin the admin note too", async () => {
      await fixture(["widget", "admin"]);

      const { code, out } = await runBothCaptured(["--dry-run"]);

      expect(code).toBe(0);
      expect(noteIds(out)).toStrictEqual({
        notes: [
          "base/0001-brand-css",
          "shell/0001-admin-kit-move",
          "shell/0002-shell-css",
        ],
        mayApply: ["widget/0001-widget-port"],
      });
    });

    // `SAASALOY_REGISTRY_DIR` leaves every module with no merge base, so each run selects
    // its notes again. A cleared one stays cleared.
    it("keeps a cleared module note cleared under the registry override", async () => {
      await fixture(["widget"]);
      const first = await runBothCaptured(["--yes"]);
      expect(first.code).toBe(EXIT_WORK_PENDING);
      expect(noteIds(first.out).mayApply).toStrictEqual([
        "widget/0001-widget-port",
      ]);

      await runBothCaptured(["--done", "widget/0001-widget-port", "--yes"]);
      const next = await runBothCaptured(["--dry-run"]);

      expect(noteIds(next.out).mayApply).toStrictEqual([]);
      expect(next.out).not.toContain("widget/0001-widget-port");
      const manifest = await loadManifest(project);
      expect(manifest.doneNotes).toContain("widget/0001-widget-port");
      expect((manifest.pendingNotes ?? []).map((n) => n.id)).not.toContain(
        "widget/0001-widget-port"
      );
    });

    it("emits the plan on an applied run with no file to merge, and counts the notes in the summary", async () => {
      await fixture(["widget"]);

      const { code, err, out } = await runBothCaptured(["--yes"]);

      expect(code).toBe(EXIT_WORK_PENDING);
      expect(out).toContain("No file needs a merge");
      expect(out).toContain("### shell/0002-shell-css: Shell css");
      expect(err).toMatch(/3 update notes/);
    });
  });

  // #223: after a merge, `--resolved` records it, and the next run has nothing left to
  // offer. A working copy has no merge base, which is the hard case: the recorded hash
  // alone would read the merged file as clean and overwrite it.
  describe("--resolved (#223)", () => {
    const TARGET = "apps/web/widget.ts";

    async function drifted(): Promise<void> {
      await state(["widget"], { widget: localEntry });
      await descriptor("widget", {
        files: [{ path: "files/widget.ts", target: "@web/widget.ts" }],
      });
      await mkdir(join(registry, "widget", "files"), { recursive: true });
      await writeFile(
        join(registry, "widget", "files", "widget.ts"),
        "export const retries = 3;\n",
        "utf-8"
      );
      await mkdir(join(project, "apps", "web"), { recursive: true });
      await writeFile(
        join(project, ...TARGET.split("/")),
        "export const retries = 1; // ours\n",
        "utf-8"
      );
      // Tracked at the old version, and edited since: drift.
      await writeFile(
        join(project, ".saasaloy", "manifest.json"),
        JSON.stringify({
          links: {},
          managed: {
            "AGENTS.md": { hash: "a".repeat(64), module: "base" },
            [TARGET]: {
              from: "files/widget.ts",
              hash: hashContent("export const retries = 1;\n"),
              module: "widget",
            },
          },
          patches: [],
          removeWarnings: {},
        }),
        "utf-8"
      );
    }

    it("records the merge, then the next update exits 0 and leaves the file alone", async () => {
      await drifted();
      const planPath = join(project, "merge-plan.md");

      const [first] = await runCaptured(["widget", "--yes", "--out", planPath]);
      expect(first).toBe(EXIT_WORK_PENDING);
      const plan = await readFile(planPath, "utf-8");
      expect(plan).toContain(`--resolved ${TARGET}`);

      const merged = "export const retries = 3; // ours\n";
      await writeFile(join(project, ...TARGET.split("/")), merged, "utf-8");

      // From a subdirectory, with the path relative to it.
      process.chdir(join(project, "apps", "web"));
      const [second, output] = await runCaptured([
        "widget",
        "--resolved",
        "widget.ts",
        "--yes",
      ]);
      process.chdir(project);
      expect(second).toBe(0);
      expect(output).toContain(`record  ${TARGET}`);
      const manifest = await loadManifest(project);
      expect(manifest.managed[TARGET]?.hash).toBe(hashContent(merged));

      const [third] = await runCaptured(["widget", "--yes"]);
      expect(third).toBe(0);
      await expect(
        readFile(join(project, ...TARGET.split("/")), "utf-8")
      ).resolves.toBe(merged);
    });

    it("refuses a path the plan does not send to a merge, and records nothing", async () => {
      await drifted();

      const [code, output] = await runCaptured([
        "widget",
        "--resolved",
        "apps/web/other.ts",
        "--yes",
      ]);
      expect(code).toBe(2);
      expect(output).toContain("apps/web/other.ts");
      expect(output).toContain(`Waiting on a merge: ${TARGET}`);
      const manifest = await loadManifest(project);
      expect(manifest.managed[TARGET]?.hash).toBe(
        hashContent("export const retries = 1;\n")
      );
    });
  });
});

// #242. Backfill writes the gated entries an installed module now owes the project. It
// runs under the update's own approval: after every refusal and the confirmation, and
// after the backup, so a refused run writes nothing and `--abort` takes a backfilled
// file back out. Offline, off a SAASALOY_REGISTRY_DIR checkout.
describe("runUpdate — backfill (#242)", () => {
  let project: string;
  let registry: string;
  const GADGET_TEST = join("apps", "web", "gadget.test.ts");

  async function module(
    name: string,
    item: Record<string, unknown>,
    files: Record<string, string> = {}
  ): Promise<void> {
    const modDir = join(registry, name);
    await mkdir(join(modDir, "files"), { recursive: true });
    await writeFile(
      join(modDir, "registry-item.json"),
      JSON.stringify({ name, type: "saasaloy:feature", files: [], ...item }),
      "utf-8"
    );
    for (const [rel, content] of Object.entries(files)) {
      await writeFile(join(modDir, rel), content, "utf-8");
    }
  }

  /** `gadget` is installed with testing on, and its gated test was never written. */
  async function state(
    installed: string[],
    modules: Record<string, unknown>
  ): Promise<void> {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({
        aliases: { "@web": "apps/web" },
        installed,
        testing: { mode: "tests-after" },
      }),
      "utf-8"
    );
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
    await module(
      "gadget",
      {
        files: [
          {
            path: "files/gadget.vitest.ts",
            target: "@web/gadget.test.ts",
            when: { testing: true },
          },
        ],
      },
      { "files/gadget.vitest.ts": "test\n" }
    );
  }

  const localEntry = { source: "local", ref: "local", resolved: "local" };

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-update-backfill-"));
    registry = await mkdtemp(join(tmpdir(), "saasaloy-update-backfill-reg-"));
    process.env[REGISTRY_ENV] = registry;
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(dir);
    delete process.env[REGISTRY_ENV];
    await rm(project, { recursive: true, force: true });
    await rm(registry, { recursive: true, force: true });
  });

  it("writes no backfilled file when the update is refused", async () => {
    await state(["widget", "gadget"], {
      widget: localEntry,
      gadget: localEntry,
    });
    await module("widget", { requires: { saasaloy: ">=99.0.0" } });

    const [code] = await runCaptured(["widget", "--yes"]);

    expect(code).toBe(2);
    await expect(pathExists(join(project, GADGET_TEST))).resolves.toBeFalsy();
  });

  it("backs up a backfilled file, so --abort removes it", async () => {
    await state(["widget", "gadget"], {
      widget: localEntry,
      gadget: localEntry,
    });
    await module("widget", {});

    const [code, output] = await runCaptured(["widget", "--yes"]);
    expect(code).toBe(0);
    expect(output).toContain("backfill");
    await expect(pathExists(join(project, GADGET_TEST))).resolves.toBeTruthy();

    expect((await runCaptured(["--abort"]))[0]).toBe(0);
    await expect(pathExists(join(project, GADGET_TEST))).resolves.toBeFalsy();
  });

  // The update landed before the backfill ran, so a backfill that stops must not hide
  // the update's merge plan or its exit code. Here a symlinked directory makes the
  // backfill's write refuse, after the update held one of widget's files for a merge.
  it("keeps the merge plan and exit 3 when the backfill fails after the update", async () => {
    await state(["widget", "gadget"], {
      widget: localEntry,
      gadget: localEntry,
    });
    const config = JSON.parse(
      await readFile(join(project, "saasaloy.json"), "utf-8")
    ) as Record<string, unknown>;
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({
        ...config,
        aliases: { "@web": "apps/web", "@lib": "lib" },
      }),
      "utf-8"
    );
    await module(
      "widget",
      { files: [{ path: "files/widget.ts", target: "@lib/widget.ts" }] },
      { "files/widget.ts": "theirs\n" }
    );
    await mkdir(join(project, "lib"), { recursive: true });
    await writeFile(join(project, "lib", "widget.ts"), "mine\n", "utf-8");
    await mkdir(join(project, "elsewhere"), { recursive: true });
    await mkdir(join(project, "apps"), { recursive: true });
    await symlink(join(project, "elsewhere"), join(project, "apps", "web"));

    const [code, output] = await runCaptured([
      "widget",
      "--yes",
      "--out",
      "plan.md",
    ]);

    expect(output).toContain("Backfill stopped");
    expect(code).toBe(EXIT_WORK_PENDING);
    await expect(pathExists(join(project, "plan.md"))).resolves.toBeTruthy();
    expect(output).toContain("saasaloy update");
  });

  // Nothing is outdated (gadget has no lock entry to compare, and naming it leaves the
  // base out), yet the backfill still runs: it is how a partial backfill is finished.
  it("backfills when everything is up to date, under a backup", async () => {
    await state(["gadget"], {});

    const [code, output] = await runCaptured(["gadget", "--yes"]);
    expect(code).toBe(0);
    expect(output).toContain("Everything is up to date");
    await expect(pathExists(join(project, GADGET_TEST))).resolves.toBeTruthy();

    expect((await runCaptured(["--abort"]))[0]).toBe(0);
    await expect(pathExists(join(project, GADGET_TEST))).resolves.toBeFalsy();
  });

  it("lists the backfill under --dry-run and writes nothing", async () => {
    await state(["gadget"], {});

    const [code, output] = await runCaptured(["gadget", "--dry-run"]);

    expect(code).toBe(0);
    expect(output).toContain("apps/web/gadget.test.ts");
    await expect(pathExists(join(project, GADGET_TEST))).resolves.toBeFalsy();
  });
});

// #242. With nothing outdated, a `--ref` rewrite and an owed backfill are the only
// writes. The rewrite stays unconfirmed on its own, and moves behind the confirmation
// and the backup once a backfill is owed, so a declined run writes nothing.
describe("finishUpToDate (#242)", () => {
  const SHA = "a".repeat(40);

  function steps(
    backfill: boolean,
    answer?: number
  ): { calls: string[]; lock: Lockfile; steps: UpToDateSteps } {
    const calls: string[] = [];
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        widget: { ref: "main", resolved: SHA, source: "acme/registry" },
      },
    };
    return {
      calls,
      lock,
      steps: {
        backfill: backfill
          ? ({
              cleanup: async () => {},
              plan: { files: [{ target: "a.test.ts" }], patches: [] },
              skipped: [],
            } as unknown as NonNullable<UpToDateSteps["backfill"]>)
          : undefined,
        backUp: async (targets) => {
          calls.push(
            `backup ${targets.join(",")} ref=${lock.modules.widget?.ref}`
          );
        },
        comparisons: [
          {
            current: SHA,
            latest: SHA,
            name: "widget",
            ref: "v2",
            refRewrite: true,
            source: "acme/registry",
            status: "current",
          },
        ],
        confirm: async () => {
          calls.push("confirm");
          return answer;
        },
        lock,
        persist: async () => {
          calls.push(`persist ref=${lock.modules.widget?.ref}`);
        },
        writeBackfill: async () => {
          calls.push("backfill");
        },
      },
    };
  }

  it("writes the ref rewrite unconfirmed when no backfill is owed", async () => {
    const run = steps(false);

    await expect(finishUpToDate(run.steps)).resolves.toBeUndefined();

    expect(run.calls).toStrictEqual(["persist ref=v2"]);
  });

  it("writes nothing, the ref rewrite included, when the backfill is declined", async () => {
    const run = steps(true, 0);

    await expect(finishUpToDate(run.steps)).resolves.toBe(0);

    expect(run.calls).toStrictEqual(["confirm"]);
    expect(run.lock.modules.widget?.ref).toBe("main");
  });

  it("backs up before the ref rewrite and the backfill once confirmed", async () => {
    const run = steps(true);

    await finishUpToDate(run.steps);

    expect(run.calls).toStrictEqual([
      "confirm",
      "backup a.test.ts ref=main",
      "persist ref=v2",
      "backfill",
    ]);
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
    // At the running CLI, so the run selects no base update note (#298) and these tests
    // see the file outcome alone.
    state.lock.base = baseRecord(cliVersion, "f".repeat(64));
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
    expect(lock.base).toStrictEqual({
      ...baseRecord(cliVersion, runningHash),
      adoptedAt: cliVersion,
    });
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
    // No file waits on a merge, and the record sits at the running CLI, so there is no
    // update note either: no merge plan at all (#298).
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
    expect(code).toBe(EXIT_WORK_PENDING);
    expect(out).toContain("# Saasaloy merge plan");
    expect(out).toContain("## base");
    expect(out).toContain(BASE_INTENT);
    expect(out).toContain("AGENTS.md");
    expect(err).toContain("needs a merge");
    await expect(readFile(join(project, "AGENTS.md"), "utf-8")).resolves.toBe(
      "old agent rules, plus mine\n"
    );
    expect((await lockOnDisk()).base).toStrictEqual(
      baseRecord(cliVersion, "f".repeat(64))
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
    expect(applied.code).toBe(EXIT_WORK_PENDING);
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

  // #298 Phase 3: an adopted base carries no record of the CLI that really made it, so the
  // base notes up to the adopting CLI cannot be placed.
  describe("update notes on an adopted base (#298)", () => {
    async function adopted(): Promise<void> {
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ aliases: {}, installed: [] })
      );
      await writeFile(join(project, "AGENTS.md"), "my own rules\n", "utf-8");
      const adoption = await runBoth(["--yes"]);
      expect(adoption.code).toBe(0);
    }

    it("records adoptedAt at the running CLI", async () => {
      await adopted();
      expect((await lockOnDisk()).base).toStrictEqual({
        ...baseRecord(cliVersion, runningHash),
        adoptedAt: cliVersion,
      });
    });

    it("shows the base notes under may apply without `--from`", async () => {
      await adopted();

      const { code, out } = await runBoth(["--dry-run"]);

      expect(code).toBe(0);
      expect(noteIds(out)).toStrictEqual({
        notes: [],
        mayApply: ["base/0001-brand-css"],
      });
    });

    it("places the base notes newer than `--from`", async () => {
      await adopted();

      const { code, out } = await runBoth(["--dry-run", "--from", "0.7.0"]);

      expect(code).toBe(0);
      expect(noteIds(out)).toStrictEqual({
        notes: ["base/0001-brand-css"],
        mayApply: [],
      });
    });

    // The adoption window stays open while the base sits at the running CLI, so every
    // run selects the note again. `--done` records the id, and selection skips it.
    it("keeps a cleared note cleared while the adopted base sits at the running CLI", async () => {
      await adopted();

      const shown = await runBoth(["--yes"]);
      expect(shown.code).toBe(EXIT_WORK_PENDING);
      expect(noteIds(shown.out).mayApply).toStrictEqual([
        "base/0001-brand-css",
      ]);

      const done = await runBoth(["--done", "base/0001-brand-css", "--yes"]);
      expect(done.code).toBe(0);

      const next = await runBoth(["--yes"]);
      expect(next.code).toBe(0);
      expect(next.err).toContain("Everything is up to date.");
      expect(next.out).toBe("");
      const manifest = await loadManifest(project);
      expect(manifest.pendingNotes).toBeUndefined();
      expect(manifest.doneNotes).toStrictEqual(["base/0001-brand-css"]);
    });

    it("refuses `--from` on a run that is not the first after adoption, and writes nothing", async () => {
      await scaffolded();
      const before = await readFile(
        join(project, "saasaloy-lock.json"),
        "utf-8"
      );

      const { code, err, out } = await runBoth(["--from", "0.7.0", "--yes"]);

      expect(code).toBe(2);
      expect(err).toContain("already exact");
      expect(out).toBe("");
      await expect(
        readFile(join(project, "saasaloy-lock.json"), "utf-8")
      ).resolves.toBe(before);
    });

    it("refuses a `--from` that is not a version", async () => {
      await adopted();

      const { code, err } = await runBoth(["--dry-run", "--from", "seven"]);

      expect(code).toBe(2);
      expect(err).toContain("seven");
    });

    it("refuses `--from` on the run that adopts the base", async () => {
      await writeFile(
        join(project, "saasaloy.json"),
        JSON.stringify({ aliases: {}, installed: [] })
      );

      const { code, err } = await runBoth(["--from", "0.7.0", "--yes"]);

      expect(code).toBe(2);
      expect(err).toContain("--from");
      await expect(
        pathExists(join(project, "saasaloy-lock.json"))
      ).resolves.toBeFalsy();
    });

    it("refuses `--from` with a named module, which reads no base", async () => {
      await scaffolded();

      const { code, err } = await runBoth([
        "email",
        "--from",
        "0.7.0",
        "--dry-run",
      ]);

      expect(code).toBe(2);
      expect(err).toContain("--from");
    });
  });

  it("emits the base notes when the base itself is up to date", async () => {
    const state = await scaffolded();
    state.lock.base = baseRecord("0.7.0", runningHash);
    await saveLock(project, state.lock);

    const { code, err, out } = await runBoth(["--yes"]);

    expect(code).toBe(EXIT_WORK_PENDING);
    expect(noteIds(out)).toStrictEqual({
      notes: ["base/0001-brand-css"],
      mayApply: [],
    });
    expect(err).not.toContain("Everything is up to date");
  });

  // #298 Phase 4. A note an applied run shows stays pending in the manifest until
  // `update --done <id>`, keeps the run at exit 3, and prints in every later merge plan.
  describe("pending update notes (#298)", () => {
    const NOTE_ID = "base/0001-brand-css";

    /** A current base recorded at 0.7.0, so the run selects the brand.css note. */
    async function belowTheNote(): Promise<void> {
      const state = await scaffolded();
      state.lock.base = baseRecord("0.7.0", runningHash);
      await saveLock(project, state.lock);
    }

    async function pendingIds(): Promise<string[]> {
      return ((await loadManifest(project)).pendingNotes ?? []).map(
        (n) => n.id
      );
    }

    it("exits 3 on the run that shows a note, clears it with --done, then exits 0", async () => {
      await belowTheNote();

      const first = await runBoth(["--yes"]);
      expect(first.code).toBe(EXIT_WORK_PENDING);
      expect(noteIds(first.out).notes).toStrictEqual([NOTE_ID]);
      expect(first.out).toContain(`--done ${NOTE_ID}`);
      expect(first.err).toContain("1 update note pending");
      await expect(pendingIds()).resolves.toStrictEqual([NOTE_ID]);
      // The range moves to the running CLI, so the note is never selected again.
      expect((await lockOnDisk()).base?.cliVersion).toBe(cliVersion);

      const done = await runBoth(["--done", NOTE_ID, "--yes"]);
      expect(done.code).toBe(0);
      expect(done.err).toContain(`done  ${NOTE_ID}`);
      expect(done.out).toBe("");
      await expect(pendingIds()).resolves.toStrictEqual([]);
      expect((await loadManifest(project)).pendingNotes).toBeUndefined();

      const last = await runBoth(["--yes"]);
      expect(last.code).toBe(0);
      expect(last.err).toContain("Everything is up to date.");
      expect(last.out).toBe("");
    });

    it("repeats a pending note in the next merge plan, once", async () => {
      await belowTheNote();
      await runBoth(["--yes"]);

      const preview = await runBoth(["--dry-run"]);
      expect(preview.code).toBe(0);
      expect(noteIds(preview.out).notes).toStrictEqual([NOTE_ID]);

      const again = await runBoth(["--yes"]);
      expect(again.code).toBe(EXIT_WORK_PENDING);
      expect(noteIds(again.out).notes).toStrictEqual([NOTE_ID]);
      await expect(pendingIds()).resolves.toStrictEqual([NOTE_ID]);
    });

    it("repeats a pending note in `update base` and keeps exit 3", async () => {
      await belowTheNote();
      await runBoth(["--yes"]);

      const named = await runBoth(["base", "--yes"]);
      expect(named.code).toBe(EXIT_WORK_PENDING);
      expect(noteIds(named.out).notes).toStrictEqual([NOTE_ID]);
    });

    it("moves the recorded CLI of a base still waiting on a merge, and keeps its hash", async () => {
      const state = await scaffolded();
      await writeFile(join(project, "AGENTS.md"), "mine\n", "utf-8");
      state.manifest.managed["AGENTS.md"]!.hash = hashContent("old\n");
      state.lock.base = baseRecord("0.7.0", "f".repeat(64));
      await saveManifest(project, state.manifest);
      await saveLock(project, state.lock);

      const first = await runBoth(["--yes"]);
      expect(first.code).toBe(EXIT_WORK_PENDING);
      expect(first.out).toContain("## base");
      expect(noteIds(first.out).notes).toStrictEqual([NOTE_ID]);
      expect((await lockOnDisk()).base).toStrictEqual(
        baseRecord(cliVersion, "f".repeat(64))
      );

      // Cleared while the merge still waits: the next run offers the merge, not the note.
      await runBoth(["--done", NOTE_ID, "--yes"]);
      const next = await runBoth(["--yes"]);
      expect(next.code).toBe(EXIT_WORK_PENDING);
      expect(next.out).toContain("## base");
      expect(noteIds(next.out).notes).toStrictEqual([]);
      await expect(pendingIds()).resolves.toStrictEqual([]);
    });

    it("records nothing under --dry-run", async () => {
      await belowTheNote();

      const preview = await runBoth(["--dry-run"]);
      expect(preview.code).toBe(0);
      expect(noteIds(preview.out).notes).toStrictEqual([NOTE_ID]);
      expect((await loadManifest(project)).pendingNotes).toBeUndefined();
      expect((await lockOnDisk()).base?.cliVersion).toBe("0.7.0");
    });

    it("refuses a --done id that is not pending, lists the pending ids, and writes nothing", async () => {
      await belowTheNote();
      await runBoth(["--yes"]);
      const before = await readFile(
        join(project, ".saasaloy", "manifest.json"),
        "utf-8"
      );

      const refused = await runBoth(["--done", "api/0001-nope", "--yes"]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("api/0001-nope");
      expect(refused.err).toContain(`Pending: ${NOTE_ID}`);
      await expect(
        readFile(join(project, ".saasaloy", "manifest.json"), "utf-8")
      ).resolves.toBe(before);
    });

    it("refuses --done when no note is pending", async () => {
      await belowTheNote();

      const refused = await runBoth(["--done", NOTE_ID, "--yes"]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("No update note is pending");
      expect((await lockOnDisk()).base?.cliVersion).toBe("0.7.0");
    });

    it("refuses --done with a missing value", async () => {
      await belowTheNote();
      const refused = await runBoth(["--done"]);
      expect(refused.code).toBe(2);
      expect(refused.err).toContain("--done (missing value)");
    });
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

    expect(code).toBe(EXIT_WORK_PENDING);
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

    expect(code).toBe(EXIT_WORK_PENDING);
    await expect(readFile(join(project, owned), "utf-8")).resolves.toBe(
      ":root { --mine: 1; }\n"
    );
  });

  /** Merge `extra` into the project's saasaloy.json. */
  async function setConfig(extra: Record<string, unknown>): Promise<void> {
    const config = JSON.parse(
      await readFile(join(project, "saasaloy.json"), "utf-8")
    ) as Record<string, unknown>;
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ ...config, ...extra }),
      "utf-8"
    );
  }

  it("renders the project's testing mode into AGENTS.md, never the template's off text (#242)", async () => {
    const state = await scaffolded();
    await fromOlderTemplate(state);
    await setConfig({ testing: { mode: "tdd" } });

    const { code } = await runBoth(["--yes"]);

    expect(code).toBe(0);
    const now = await readFile(join(project, "AGENTS.md"), "utf-8");
    expect(now).toContain(TESTING_BLOCKS.tdd);
    expect(now).not.toContain(TESTING_BLOCKS.off);
  });

  it("suggests a testing mode when a module ships a test and the key is absent (#242)", async () => {
    const state = await scaffolded();
    state.manifest.managed["apps/api/src/routes/auth.test.ts"] = {
      hash: "a".repeat(64),
      module: "auth",
    };
    await saveManifest(project, state.manifest);

    const { err } = await runBoth(["--yes"]);

    expect(err.split("saasaloy testing tests-after")).toHaveLength(2);
  });

  it("prints no testing suggestion once the key is present (#242)", async () => {
    const state = await scaffolded();
    state.manifest.managed["apps/api/src/routes/auth.test.ts"] = {
      hash: "a".repeat(64),
      module: "auth",
    };
    await saveManifest(project, state.manifest);
    await setConfig({ testing: { mode: "off" } });

    const { err } = await runBoth(["--yes"]);

    expect(err).not.toContain("saasaloy testing");
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
      baseRecord(cliVersion, "f".repeat(64))
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
    expect(forced.code).toBe(EXIT_WORK_PENDING);
  });
});
