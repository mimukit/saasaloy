import { describe, expect, it } from "vitest";
import { detectConflicts, formatConflicts, type ModuleConflict } from "./conflicts.js";
import { emptyLock, type Lockfile, upsertLock } from "./lock.js";
import type { LoadedModule, ModuleProvenance } from "./registry.js";
import type { Graph } from "./resolve.js";
import { type SaasaloyConfig, validateRegistryItem } from "./schema.js";

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
  return { dir: `/tmp/${name}`, item: { name, type: "saasaloy:feature", ...spec } };
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
    graph(...modules),
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
    expect(report.conflicts).toEqual([
      { declaredBy: "database-d1", conflictsWith: "database-pg", installed: "database-pg" },
    ]);
  });

  it("stays silent when the named module isn't installed and isn't in the graph", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1", { conflictsWith: ["database-pg"] })),
      config: config("api"),
      lock: lockFor(mod("api")),
    });
    expect(report.conflicts).toEqual([]);
  });

  it("stays silent when no module declares anything", () => {
    const report = detectConflicts({
      graph: graph(mod("waitlist", { dependsOn: ["api"] }), mod("api")),
      config: config("api"),
      lock: lockFor(mod("api")),
    });
    expect(report.conflicts).toEqual([]);
  });

  it("flags a conflict declared by a transitive prerequisite, not just the requested module", () => {
    // `waitlist` is clean; the `database-d1` it drags in is what collides.
    const report = detectConflicts({
      graph: graph(
        mod("waitlist", { dependsOn: ["database-d1"] }),
        mod("database-d1", { conflictsWith: ["database-pg"] }),
      ),
      config: config("database-pg"),
      lock: lockFor(mod("database-pg")),
    });
    expect(report.conflicts).toEqual([
      { declaredBy: "database-d1", conflictsWith: "database-pg", installed: "database-pg" },
    ]);
  });

  it("flags two mutually exclusive modules pulled into one graph, with nothing installed", () => {
    const report = detectConflicts({
      graph: graph(
        mod("bundle", { dependsOn: ["database-d1", "database-pg"] }),
        mod("database-d1", { conflictsWith: ["database-pg"] }),
        mod("database-pg"),
      ),
      config: config(),
      lock: emptyLock(),
    });
    // No `installed` key — neither side is on disk, so there's nothing to remove.
    expect(report.conflicts).toEqual([
      { declaredBy: "database-d1", conflictsWith: "database-pg" },
    ]);
  });

  it("ignores a module that names itself", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1", { conflictsWith: ["database-d1"] })),
      config: config("database-d1"),
      lock: lockFor(mod("database-d1", { conflictsWith: ["database-d1"] })),
    });
    expect(report.conflicts).toEqual([]);
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
    expect(report.conflicts).toEqual([
      { declaredBy: "database-pg", conflictsWith: "database-d1", installed: "database-pg" },
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
    const lock = lockFor(mod("database-pg", { conflictsWith: ["database-d1"] }));
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config(), // pg was removed; only its lock entry lingers
      lock,
    });
    expect(report.conflicts).toEqual([]);
  });

  it("reports an installed module with no lock entry as unverifiable, and proceeds", () => {
    const report = detectConflicts({
      graph: graph(mod("database-d1")),
      config: config("legacy"),
      lock: emptyLock(),
    });
    expect(report.conflicts).toEqual([]);
    expect(report.missingLockEntries).toEqual(["legacy"]);
  });

  it("doesn't report a missing lock entry for a module whose descriptor is in the graph", () => {
    const report = detectConflicts({
      graph: graph(mod("api"), mod("waitlist", { dependsOn: ["api"] })),
      config: config("api"),
      lock: emptyLock(),
    });
    expect(report.missingLockEntries).toEqual([]);
  });
});

describe("formatConflicts", () => {
  const message = (conflict: ModuleConflict, requested: string) =>
    formatConflicts([conflict], requested);

  it("names both modules and the remove that clears the conflict", () => {
    const text = message(
      { declaredBy: "database-d1", conflictsWith: "database-pg", installed: "database-pg" },
      "database-d1",
    );
    expect(text).toContain("database-d1");
    expect(text).toContain("database-pg");
    expect(text).toContain("`saasaloy remove database-pg`");
  });

  it("says which side declared the conflict when the installed module is the declarer", () => {
    const text = message(
      { declaredBy: "database-pg", conflictsWith: "database-d1", installed: "database-pg" },
      "database-d1",
    );
    expect(text).toContain("database-pg is already installed and declares a conflict with database-d1");
  });

  it("names the prerequisite when the requested module isn't the conflicting one", () => {
    const text = message(
      { declaredBy: "database-d1", conflictsWith: "database-pg", installed: "database-pg" },
      "waitlist",
    );
    expect(text).toContain("database-d1 (required by waitlist)");
    expect(text).toContain("`saasaloy remove database-pg`");
  });

  it("offers no remove when both conflicting modules arrive in the same run", () => {
    const text = message({ declaredBy: "database-d1", conflictsWith: "database-pg" }, "bundle");
    expect(text).toContain("Add only one of them.");
    expect(text).not.toContain("saasaloy remove");
  });

  it("lists every pair under one heading", () => {
    const text = formatConflicts(
      [
        { declaredBy: "a", conflictsWith: "b", installed: "b" },
        { declaredBy: "c", conflictsWith: "d", installed: "d" },
      ],
      "a",
    );
    expect(text.split("\n")).toHaveLength(3);
    expect(text.split("\n")[0]).toBe("Cannot add a — module conflicts:");
  });
});

describe("registry-item schema — conflictsWith", () => {
  const item = (conflictsWith: unknown) => ({
    name: "database-d1",
    type: "saasaloy:feature" as const,
    conflictsWith,
  });

  it("accepts a list of module names", async () => {
    const result = await validateRegistryItem(item(["database-pg", "database-mysql"]));
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("accepts a descriptor that omits the field", async () => {
    const result = await validateRegistryItem({ name: "database-d1", type: "saasaloy:feature" });
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("rejects a name that isn't a module name", async () => {
    expect((await validateRegistryItem(item(["Database-PG"]))).valid).toBe(false);
  });

  it("rejects duplicates and non-array values", async () => {
    expect((await validateRegistryItem(item(["database-pg", "database-pg"]))).valid).toBe(false);
    expect((await validateRegistryItem(item("database-pg"))).valid).toBe(false);
  });
});
