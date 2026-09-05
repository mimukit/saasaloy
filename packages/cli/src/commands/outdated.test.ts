import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startGithubFixture } from "../../test/support/github-fixture.js";
import type { GithubFixture } from "../../test/support/github-fixture.js";
import { emptyLock } from "../lib/lock.js";
import type { LockModule } from "../lib/lock.js";
import { GITHUB_API_ENV, REGISTRY_ENV } from "../lib/registry.js";
import { stripAnsi } from "../lib/tui.js";
import type { ModuleComparison } from "../lib/updater.js";
import {
  countDrift,
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

  it("says so plainly when nothing is installed", () => {
    expect(rendered([])).toContain("Nothing installed");
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

  it("says nothing is installed and exits 0", async () => {
    await writeProject([], {});
    const { code, out } = await runCommand([]);

    expect(code).toBe(0);
    expect(out).toContain("Nothing installed");
  });

  it("exits 0 when every module is settled", async () => {
    await writeProject(["auth"], {
      auth: { source: "mimukit/saasaloy", ref: SHA_A, resolved: SHA_A },
    });
    const { code, out } = await runCommand([]);

    expect(code).toBe(0);
    expect(out).toContain("pinned");
    expect(out).toContain("Everything is up to date");
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
