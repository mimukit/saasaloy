import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startGithubFixture } from "../../test/support/github-fixture.js";
import type { GithubFixture } from "../../test/support/github-fixture.js";
import { templateHash } from "../lib/base.js";
import { pathExists } from "../lib/fs-utils.js";
import { emptyLock } from "../lib/lock.js";
import { baseTemplateDir } from "../lib/scaffold.js";
import type { LockModule } from "../lib/lock.js";
import { GITHUB_API_ENV, REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import type { ModuleComparison } from "../lib/updater.js";
import {
  countDrift,
  describeDrift,
  parseArgs,
  renderComparisons,
  runOutdated,
} from "./outdated.js";

/** The usage line the refusal quotes, kept here so a reworded flag list fails loudly. */
const USAGE_LINE = "saasaloy outdated [--check]";

const SHA_A = "a".repeat(40);
const SHA_B = "b".repeat(40);

function comparison(
  over: Partial<ModuleComparison> & Pick<ModuleComparison, "name" | "status">
): ModuleComparison {
  return {
    source: "mimukit/saasaloy",
    ref: "main",
    current: SHA_A,
    latest: SHA_A,
    ...over,
  };
}

/** Every status `compareInstalled` can return, one row each. */
const ALL_STATUSES: ModuleComparison[] = [
  comparison({ name: "api", status: "current" }),
  comparison({ name: "email", status: "outdated", latest: SHA_B }),
  comparison({
    name: "auth",
    ref: SHA_A,
    status: "pinned",
    detail: "pinned at aaaaaaa — nothing to update",
  }),
  comparison({
    name: "billing",
    source: "local",
    ref: "local",
    current: "local",
    latest: "local",
    status: "local",
    detail:
      "installed from a working copy — set SAASALOY_REGISTRY_DIR to update it",
  }),
  comparison({
    name: "teams",
    status: "unresolvable",
    detail: "fetch failed: ECONNREFUSED",
  }),
];

function rendered(comparisons: ModuleComparison[]): string {
  return stripAnsi(renderComparisons(comparisons).join("\n"));
}

/** Where a row's short current SHA starts — the alignment the table has to hold. */
function shaColumn(line: string): number {
  return line.indexOf("a".repeat(7));
}

/** `runOutdated` with stdout captured, so the clack rail can be read back. */
async function runCommand(
  args: string[]
): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk: string | Uint8Array) => {
    lines.push(stripAnsi(String(chunk)));
    return true;
  };
  try {
    return { code: await runOutdated(args), out: lines.join("") };
  } finally {
    process.stdout.write = originalWrite;
  }
}

describe(renderComparisons, () => {
  it("prints a header and one row per module", () => {
    const lines = rendered(ALL_STATUSES).split("\n");

    expect(lines[0]).toContain("MODULE");
    expect(lines[0]).toContain("STATUS");
    expect(lines[0]).toContain("CURRENT");
    expect(lines[0]).toContain("LATEST");
    for (const c of ALL_STATUSES) {
      expect(lines.filter((line) => line.startsWith(c.name))).toHaveLength(1);
    }
  });

  it("shortens a SHA to seven characters", () => {
    const out = rendered([
      comparison({ name: "email", status: "outdated", latest: SHA_B }),
    ]);

    expect(out).toContain("aaaaaaa");
    expect(out).toContain("bbbbbbb");
    expect(out).not.toContain(SHA_A);
  });

  it("shows the ref each module tracks", () => {
    expect(rendered(ALL_STATUSES)).toContain("main");
  });

  it("notes a local entry rather than pretending it was compared", () => {
    const out = rendered(ALL_STATUSES);

    expect(out).toContain("local");
    expect(out).toContain("installed from a working copy");
  });

  it("reports an unreachable source as a row with its reason", () => {
    const out = rendered(ALL_STATUSES);

    expect(out).toContain("unresolvable");
    expect(out).toContain("ECONNREFUSED");
  });

  it("carries the detail of a pinned module", () => {
    expect(rendered(ALL_STATUSES)).toContain("nothing to update");
  });

  it("aligns the columns, so every row's SHA starts in the same place", () => {
    const lines = rendered([
      comparison({ name: "a", status: "current" }),
      comparison({
        name: "a-very-long-module-name",
        status: "outdated",
        latest: SHA_B,
      }),
    ]).split("\n");

    expect(shaColumn(lines[1]!)).toBe(shaColumn(lines[2]!));
  });

  it("says so plainly when no module is installed", () => {
    expect(rendered([])).toContain("No modules installed");
  });

  it("renders an untracked base row with its hint (#120)", () => {
    const out = rendered([
      comparison({
        name: "base",
        source: "bundled template",
        ref: "template",
        current: "untracked",
        latest: "0.0.0 (abcdef0)",
        status: "untracked",
        detail:
          "not recorded — run `saasaloy update` to adopt the base at this CLI",
      }),
    ]);

    expect(out).toContain("untracked");
    expect(out).toContain("saasaloy update");
    expect(out).toContain("0.0.0 (abcdef0)");
  });
});

describe(countDrift, () => {
  it("counts only the outdated modules", () => {
    expect(countDrift(ALL_STATUSES)).toBe(1);
  });

  it("counts a pinned, local or unresolvable module as no drift", () => {
    expect(
      countDrift(ALL_STATUSES.filter((c) => c.status !== "outdated"))
    ).toBe(0);
  });

  it("is zero for an empty comparison", () => {
    expect(countDrift([])).toBe(0);
  });

  it("counts an outdated base, and never an untracked one (#120)", () => {
    const base = comparison({ name: "base", status: "outdated" });
    const untracked = comparison({ name: "base", status: "untracked" });

    expect(countDrift([base])).toBe(1);
    expect(countDrift([untracked])).toBe(0);
  });
});

describe(describeDrift, () => {
  it("names the base alone, the modules alone, or both", () => {
    const base = comparison({ name: "base", status: "outdated" });
    const email = comparison({ name: "email", status: "outdated" });

    expect(describeDrift([base])).toContain("The base template moved");
    expect(describeDrift([email])).toContain("1 module moved");
    expect(
      describeDrift([
        base,
        email,
        comparison({ name: "auth", status: "outdated" }),
      ])
    ).toContain("The base template and 2 modules moved");
  });
});

describe(parseArgs, () => {
  it("defaults to a report, not a gate", () => {
    expect(parseArgs([])).toStrictEqual({ check: false, unknown: [] });
  });

  it("reads --check", () => {
    expect(parseArgs(["--check"]).check).toBeTruthy();
  });

  it("reports an unknown flag rather than ignoring it", () => {
    expect(parseArgs(["--checkk"]).unknown).toStrictEqual(["--checkk"]);
  });

  it("reports a stray positional", () => {
    expect(parseArgs(["email"]).unknown).toStrictEqual(["email"]);
  });

  it("does not treat --help as unknown", () => {
    expect(parseArgs(["--help"]).unknown).toStrictEqual([]);
  });
});

// Command-level behaviour, offline. Nothing here reaches GitHub: an entry pinned to a SHA
// needs no resolution, an entry the lock doesn't hold is unresolvable on the spot, and the
// drift case resolves against the local fixture server.
describe(runOutdated, () => {
  const ORIGINAL_CWD = process.cwd();
  let project: string;
  let fixture: GithubFixture | undefined;

  async function writeProject(
    installed: string[],
    modules: Record<string, LockModule>
  ): Promise<void> {
    await writeFile(
      join(project, "saasaloy.json"),
      JSON.stringify({ aliases: { "@web": "apps/web" }, installed }),
      "utf-8"
    );
    await writeFile(
      join(project, "saasaloy-lock.json"),
      JSON.stringify({ ...emptyLock(), modules }),
      "utf-8"
    );
  }

  /**
   * A project whose lock says `email` sits on `SHA_A` while `main` now points at `SHA_B`.
   * The SHA comes from the local fixture server rather than the registry override, so the
   * drift is a real comparison result — the override says nothing about drift (B1).
   */
  async function driftingProject(): Promise<void> {
    fixture = await startGithubFixture({ sha: SHA_B });
    process.env[GITHUB_API_ENV] = fixture.url;
    await writeProject(["email"], {
      email: { source: "mimukit/saasaloy", ref: "main", resolved: SHA_A },
    });
  }

  beforeEach(async () => {
    project = await mkdtemp(join(tmpdir(), "saasaloy-outdated-"));
    process.chdir(project);
  });

  afterEach(async () => {
    process.chdir(ORIGINAL_CWD);
    delete process.env[REGISTRY_ENV];
    delete process.env[GITHUB_API_ENV];
    await fixture?.close();
    fixture = undefined;
    await rm(project, { recursive: true, force: true });
  });

  it("says no module is installed and exits 0", async () => {
    await writeProject([], {});
    const { code, out } = await runCommand([]);

    expect(code).toBe(0);
    expect(out).toContain("No modules installed");
  });

  // #120: the base row. An unrecorded project is the common case for now — every
  // project scaffolded before the record existed — and it is news, not drift.
  describe("the base row", () => {
    async function trackedBase(hash: string): Promise<void> {
      await writeProject([], {});
      // On disk, or the row reads `outdated` on the missing file rather than on the hash.
      await writeFile(join(project, "AGENTS.md"), "# base\n", "utf-8");
      await mkdir(join(project, ".saasaloy"), { recursive: true });
      await writeFile(
        join(project, ".saasaloy", "manifest.json"),
        JSON.stringify({
          managed: { "AGENTS.md": { module: "base", hash: "a".repeat(64) } },
        }),
        "utf-8"
      );
      await writeFile(
        join(project, "saasaloy-lock.json"),
        JSON.stringify({
          ...emptyLock(),
          base: { name: "web", cliVersion: "0.0.0", templateHash: hash },
        }),
        "utf-8"
      );
    }

    it("reports an unrecorded base as untracked, exits 0, and writes nothing", async () => {
      await writeProject([], {});
      const { code, out } = await runCommand([]);

      expect(code).toBe(0);
      expect(out).toContain("untracked");
      expect(out).toContain("saasaloy update");
      await expect(pathExists(join(project, ".saasaloy"))).resolves.toBeFalsy();
      const lock = JSON.parse(
        await readFile(join(project, "saasaloy-lock.json"), "utf-8")
      );
      expect(lock.base).toBeUndefined();
    });

    it("does not fail --check on an untracked base", async () => {
      await writeProject([], {});

      await expect(runCommand(["--check"]).then((r) => r.code)).resolves.toBe(
        0
      );
    });

    it("reports a base at the running template's hash as current", async () => {
      await trackedBase(await templateHash(await baseTemplateDir()));
      const { code, out } = await runCommand([]);

      expect(code).toBe(0);
      expect(out).toContain("current");
      expect(out).toContain("Everything is up to date");
    });

    it("reports a base at another hash as outdated, and gates --check on it", async () => {
      await trackedBase("f".repeat(64));
      const report = await runCommand([]);

      expect(report.code).toBe(0);
      expect(report.out).toContain("outdated");
      expect(report.out).toContain("The base template moved");
      await expect(runCommand(["--check"]).then((r) => r.code)).resolves.toBe(
        2
      );
    });
  });

  it("exits 0 when every module is settled", async () => {
    await writeProject(["auth"], {
      auth: { source: "mimukit/saasaloy", ref: SHA_A, resolved: SHA_A },
    });
    const { code, out } = await runCommand([]);

    expect(code).toBe(0);
    expect(out).toContain("pinned");
    // No base record here, so the closing line reports the modules and names the gap.
    expect(out).toContain("up to date");
    expect(out).toContain("base is untracked");
  });

  it("exits 0 with --check when nothing moved", async () => {
    await writeProject(["auth"], {
      auth: { source: "mimukit/saasaloy", ref: SHA_A, resolved: SHA_A },
    });

    await expect(runCommand(["--check"]).then((r) => r.code)).resolves.toBe(0);
  });

  it("tables a module with no lock entry as unresolvable, and still exits 0", async () => {
    await writeProject(["ghost"], {});
    const { code, out } = await runCommand([]);

    expect(code).toBe(0);
    expect(out).toContain("unresolvable");
    expect(out).toContain("no lock entry");
  });

  it("does not fail --check on an unresolvable module — a blip is not drift", async () => {
    await writeProject(["ghost"], {});

    await expect(runCommand(["--check"]).then((r) => r.code)).resolves.toBe(0);
  });

  it("exits 0 on drift by default, and names the fix", async () => {
    await driftingProject();
    const { code, out } = await runCommand([]);

    expect(code).toBe(0);
    expect(out).toContain("outdated");
    expect(out).toContain("1 module moved");
    expect(out).toContain("saasaloy update");
  });

  it("exits 2 with --check once anything has moved", async () => {
    await driftingProject();

    await expect(runCommand(["--check"]).then((r) => r.code)).resolves.toBe(2);
  });

  // Regression, review B1: `compareInstalled` calls an override row `outdated`, which to
  // `update` means "re-apply from the checkout". Read as drift, that made every module
  // under SAASALOY_REGISTRY_DIR a moved module and `--check` exited 2 in a playground
  // where nothing had moved at all.
  describe(`with ${REGISTRY_ENV} set`, () => {
    beforeEach(async () => {
      process.env[REGISTRY_ENV] = project;
      await writeProject(["email"], {
        email: { source: "mimukit/saasaloy", ref: "main", resolved: SHA_A },
      });
    });

    it("reads every module as local, not as drift", async () => {
      const { code, out } = await runCommand([]);

      const row = out
        .split("\n")
        .find((line) => line.includes("email"))
        ?.trim();

      expect(code).toBe(0);
      expect(row).toContain("local");
      // The banner says "saasaloy outdated", so the status is read off the row itself.
      expect(row).not.toContain("outdated");
      expect(out).not.toContain("moved");
      expect(out).toContain("Nothing to compare");
    });

    it("exits 0 with --check — an override is not drift", async () => {
      await expect(runCommand(["--check"]).then((r) => r.code)).resolves.toBe(
        0
      );
    });
  });

  it("refuses an unknown flag", async () => {
    await writeProject([], {});
    const { code, out } = await runCommand(["--checkk"]);

    expect(code).toBe(2);
    expect(out).toContain("--checkk");
    expect(out).toContain(USAGE_LINE);
  });
});
