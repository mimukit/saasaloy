import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { detectConflicts, formatConflicts } from "./conflicts.js";
import type { ModuleConflict } from "./conflicts.js";
import { emptyLock, loadLock, saveLock, upsertLock } from "./lock.js";
import type { Lockfile } from "./lock.js";
import type { LoadedModule, ModuleProvenance } from "./registry.js";
import type { Graph } from "./resolve.js";
import { validateLock, validateRegistryItem } from "./schema.js";
import type { SaasaloyConfig } from "./schema.js";

const PROVENANCE: ModuleProvenance = {
  source: "mimukit/saasaloy",
  ref: "main",
  resolved: "9f3a1c2b7e5d4808a1f6c9b2e0d7a4c3f5b8e1d0",
};

interface ModSpec {
  dependsOn?: string[];
  conflictsWith?: string[];
}

function mod(name: string, spec: ModSpec = {}): LoadedModule {
  return {
    dir: `/tmp/${name}`,
    item: { name, type: "saasaloy:feature", ...spec },
  };
}

/** A graph whose `order` is just its keys — resolution order is irrelevant to this check. */
function graph(...modules: LoadedModule[]): Graph {
  return {
    order: modules.map((m) => m.item.name),
    modules: new Map(modules.map((m) => [m.item.name, m])),
  };
}

function config(...installed: string[]): SaasaloyConfig {
  return { aliases: {}, installed };
}

/** A lock as `add` would have written it when `installed` went in. */
function lockFor(...modules: LoadedModule[]): Lockfile {
  const lock = emptyLock();
  upsertLock(
    lock,
    PROVENANCE,
    modules.map((m) => m.item.name),
    graph(...modules)
  );
  return lock;
}

describe("detectConflicts — forward direction (incoming descriptor declares it)", () => {
  it("flags an incoming module that names an installed one", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1", { conflictsWith: ["database-pg"] })),
      config: config("database-pg"),
      lock: lockFor(mod("database-pg")),
    });
    expect(report.conflicts).toStrictEqual([
      {
        declaredBy: "database-d1",
        conflictsWith: "database-pg",
        installed: "database-pg",
      },
    ]);
  });

  it("stays silent when the named module isn't installed and isn't in the graph", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1", { conflictsWith: ["database-pg"] })),
      config: config("api"),
      lock: lockFor(mod("api")),
    });
    expect(report.conflicts).toStrictEqual([]);
  });

  it("stays silent when no module declares anything", () => {
    const report = detectConflicts({
      graph: graph(mod("waitlist", { dependsOn: ["api"] }), mod("api")),
      config: config("api"),
      lock: lockFor(mod("api")),
    });
    expect(report.conflicts).toStrictEqual([]);
  });

  it("flags a conflict declared by a transitive prerequisite, not just the requested module", () => {
    // `waitlist` is clean; the `database-d1` it drags in is what collides.
    const report = detectConflicts({
      graph: graph(
        mod("waitlist", { dependsOn: ["database-d1"] }),
        mod("database-d1", { conflictsWith: ["database-pg"] })
      ),
      config: config("database-pg"),
      lock: lockFor(mod("database-pg")),
    });
    expect(report.conflicts).toStrictEqual([
      {
        declaredBy: "database-d1",
        conflictsWith: "database-pg",
        installed: "database-pg",
      },
    ]);
  });

  it("flags two mutually exclusive modules pulled into one graph, with nothing installed", () => {
    const report = detectConflicts({
      graph: graph(
        mod("bundle", { dependsOn: ["database-d1", "database-pg"] }),
        mod("database-d1", { conflictsWith: ["database-pg"] }),
        mod("database-pg")
      ),
      config: config(),
      lock: emptyLock(),
    });
    // No `installed` key — neither side is on disk, so there's nothing to remove.
    expect(report.conflicts).toStrictEqual([
      { declaredBy: "database-d1", conflictsWith: "database-pg" },
    ]);
  });

  it("ignores a module that names itself", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1", { conflictsWith: ["database-d1"] })),
      config: config("database-d1"),
      lock: lockFor(mod("database-d1", { conflictsWith: ["database-d1"] })),
    });
    expect(report.conflicts).toStrictEqual([]);
  });
});

describe("detectConflicts — reverse direction (installed module declared it)", () => {
  it("flags an installed module whose lock entry names the incoming one", () => {
    // database-pg went in first and is the only side that declares the conflict.
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config("database-pg"),
      lock: lockFor(mod("database-pg", { conflictsWith: ["database-d1"] })),
    });
    expect(report.conflicts).toStrictEqual([
      {
        declaredBy: "database-pg",
        conflictsWith: "database-d1",
        installed: "database-pg",
      },
    ]);
  });

  it("refuses in both install orders for the same declaring module", () => {
    const pg = mod("database-pg", { conflictsWith: ["database-d1"] });
    const d1 = mod("database-d1");

    // pg first, then d1 — caught via pg's lock entry.
    const pgFirst = detectConflicts({
      graph: graph(d1),
      config: config("database-pg"),
      lock: lockFor(pg),
    });
    // d1 first, then pg — caught via pg's own fresh descriptor.
    const d1First = detectConflicts({
      graph: graph(pg),
      config: config("database-d1"),
      lock: lockFor(d1),
    });

    expect(pgFirst.conflicts).toHaveLength(1);
    expect(d1First.conflicts).toHaveLength(1);
    expect(pgFirst.conflicts[0]?.installed).toBe("database-pg");
    expect(d1First.conflicts[0]?.installed).toBe("database-d1");
  });

  it("reports one entry, not two, when both sides declare the same pair", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1", { conflictsWith: ["database-pg"] })),
      config: config("database-pg"),
      lock: lockFor(mod("database-pg", { conflictsWith: ["database-d1"] })),
    });
    expect(report.conflicts).toHaveLength(1);
    // The fresh descriptor wins the attribution over the recorded copy.
    expect(report.conflicts[0]?.declaredBy).toBe("database-d1");
  });

  it("ignores a stale lock entry for a module that is no longer installed", () => {
    const lock = lockFor(
      mod("database-pg", { conflictsWith: ["database-d1"] })
    );
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config(), // pg was removed; only its lock entry lingers
      lock,
    });
    expect(report.conflicts).toStrictEqual([]);
  });

  it("reports an installed module with no lock entry as unverifiable, and proceeds", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config("legacy"),
      lock: emptyLock(),
    });
    expect(report.conflicts).toStrictEqual([]);
    expect(report.missingLockEntries).toStrictEqual(["legacy"]);
  });

  it("doesn't report a missing lock entry for a module whose descriptor is in the graph", () => {
    const report = detectConflicts({
      graph: graph(mod("api"), mod("waitlist", { dependsOn: ["api"] })),
      config: config("api"),
      lock: emptyLock(),
    });
    expect(report.missingLockEntries).toStrictEqual([]);
  });

  it("stays silent about an installed name the tool never applied (the template's web)", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config("web", "api"),
      lock: lockFor(mod("api")),
      managed: new Set(["api"]), // `web` comes from the scaffold, not from `add`
    });
    expect(report.missingLockEntries).toStrictEqual([]);
  });

  it("still reports a managed module that lost its lock entry", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config("web", "api"),
      lock: emptyLock(),
      managed: new Set(["api"]),
    });
    expect(report.missingLockEntries).toStrictEqual(["api"]);
  });
});

const message = (conflict: ModuleConflict, requested: string) =>
  formatConflicts([conflict], requested);

describe(formatConflicts, () => {
  it("names both modules and the remove that clears the conflict", () => {
    const text = message(
      {
        declaredBy: "database-d1",
        conflictsWith: "database-pg",
        installed: "database-pg",
      },
      "database-d1"
    );
    expect(text).toContain("database-d1");
    expect(text).toContain("database-pg");
    expect(text).toContain("`saasaloy remove database-pg`");
  });

  it("says which side declared the conflict when the installed module is the declarer", () => {
    const text = message(
      {
        declaredBy: "database-pg",
        conflictsWith: "database-d1",
        installed: "database-pg",
      },
      "database-d1"
    );
    expect(text).toContain(
      "database-pg is already installed and declares a conflict with database-d1"
    );
  });

  it("names the prerequisite when the requested module isn't the conflicting one", () => {
    const text = message(
      {
        declaredBy: "database-d1",
        conflictsWith: "database-pg",
        installed: "database-pg",
      },
      "waitlist"
    );
    expect(text).toContain("database-d1 (required by waitlist)");
    expect(text).toContain("`saasaloy remove database-pg`");
  });

  it("offers no remove when both conflicting modules arrive in the same run", () => {
    const text = message(
      { declaredBy: "database-d1", conflictsWith: "database-pg" },
      "bundle"
    );
    expect(text).toContain("Add only one of them.");
    expect(text).not.toContain("saasaloy remove");
  });

  it("lists every pair under one heading", () => {
    const text = formatConflicts(
      [
        { declaredBy: "a", conflictsWith: "b", installed: "b" },
        { declaredBy: "c", conflictsWith: "d", installed: "d" },
      ],
      "a"
    );
    expect(text.split("\n")).toHaveLength(3);
    expect(text.split("\n")[0]).toBe("Cannot add a — module conflicts:");
  });

  // #98 Phase 5. `update` runs the same check, because a new version's `dependsOn` can
  // pull in a second driver as a prerequisite — so the refusal has to say `update`.
  it("says which command refused when `update` is the caller", () => {
    const text = formatConflicts(
      [
        {
          declaredBy: "database-d1",
          conflictsWith: "database-pg",
          installed: "database-pg",
        },
      ],
      "waitlist",
      "update"
    );
    expect(text.split("\n")[0]).toBe(
      "Cannot update waitlist — module conflict:"
    );
    expect(text).toContain("`saasaloy remove database-pg`");
  });

  it("says `updating` rather than `adding` when both modules arrive together", () => {
    const text = formatConflicts(
      [{ declaredBy: "database-d1", conflictsWith: "database-pg" }],
      "bundle",
      "update"
    );
    expect(text).toContain("updating bundle installs both");
  });
});

const item = (conflictsWith: unknown) => ({
  name: "database-d1",
  type: "saasaloy:feature" as const,
  conflictsWith,
});

describe("registry-item schema — conflictsWith", () => {
  it("accepts a list of module names", async () => {
    const result = await validateRegistryItem(
      item(["database-pg", "database-mysql"])
    );
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("accepts a descriptor that omits the field", async () => {
    const result = await validateRegistryItem({
      name: "database-d1",
      type: "saasaloy:feature",
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a name that isn't a module name", async () => {
    expect(
      (await validateRegistryItem(item(["Database-PG"]))).valid
    ).toBeFalsy();
  });

  it("rejects duplicates and non-array values", async () => {
    expect(
      (await validateRegistryItem(item(["database-pg", "database-pg"]))).valid
    ).toBeFalsy();
    expect((await validateRegistryItem(item("database-pg"))).valid).toBeFalsy();
  });
});

// #83 Phase 4. Every test above hands `detectConflicts` a Lockfile it holds in memory.
// The reverse direction only works in a real run if the field survives the JSON write
// and read between the two `add` invocations, so this drives that seam: install one
// module, save the lock, load it back in a fresh process's shape, then add the other.
describe("conflictsWith — across two runs, through the lockfile on disk", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-conflicts-root-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("refuses the second module using only what the first run wrote to disk", async () => {
    // Run 1: `add database-d1`, which declares the conflict. Nothing is installed yet,
    // so nothing is refused, and the lock records what the descriptor said.
    const d1 = mod("database-d1", { conflictsWith: ["database-pg"] });
    const first = detectConflicts({
      graph: graph(d1),
      config: config(),
      lock: emptyLock(),
    });
    expect(first.conflicts).toStrictEqual([]);

    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ["database-d1"], graph(d1));
    await saveLock(root, lock);

    // Run 2: `add database-pg`. Its own descriptor declares nothing, and `database-d1`'s
    // descriptor is long gone — the refusal has to come out of the lockfile.
    const reloaded = await loadLock(root);
    expect(reloaded.modules["database-d1"]?.conflictsWith).toStrictEqual([
      "database-pg",
    ]);
    expect((await validateLock(reloaded)).errors).toStrictEqual([]);

    const report = detectConflicts({
      graph: graph(mod("database-pg")),
      config: config("database-d1"),
      lock: reloaded,
    });
    expect(report.missingLockEntries).toStrictEqual([]);
    expect(report.conflicts).toStrictEqual([
      {
        declaredBy: "database-d1",
        conflictsWith: "database-pg",
        installed: "database-d1",
      },
    ]);
    expect(formatConflicts(report.conflicts, "database-pg")).toContain(
      "Run `saasaloy remove database-d1` first."
    );
  });
});
