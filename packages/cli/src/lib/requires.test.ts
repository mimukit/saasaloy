import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { detectConflicts, formatConflicts } from "./conflicts.js";
import { emptyLock, upsertLock } from "./lock.js";
import type { LoadedModule, ModuleProvenance } from "./registry.js";
import type { Graph } from "./resolve.js";
import {
  detectMissingRequirements,
  formatMissingRequirements,
} from "./requires.js";
import { validateRegistryItem } from "./schema.js";
import type { RegistryItem, SaasaloyConfig } from "./schema.js";

interface ModSpec {
  dependsOn?: string[];
  requiresOneOf?: string[];
}

function mod(name: string, spec: ModSpec = {}): LoadedModule {
  return {
    dir: `/tmp/${name}`,
    item: { name, type: "saasaloy:capability", ...spec },
  };
}

/** A graph whose `order` is its keys in the order given. */
function graph(...modules: LoadedModule[]): Graph {
  return {
    order: modules.map((m) => m.item.name),
    modules: new Map(modules.map((m) => [m.item.name, m])),
  };
}

function config(...installed: string[]): SaasaloyConfig {
  return { aliases: {}, installed };
}

const DRIVERS = ["database-d1", "database-postgres"];

describe("detectMissingRequirements — what counts as satisfied", () => {
  it("flags a module whose choice is neither in the graph nor installed", () => {
    const missing = detectMissingRequirements({
      config: config(),
      graph: graph(mod("database", { requiresOneOf: DRIVERS })),
    });
    expect(missing).toStrictEqual([
      { declaredBy: "database", options: DRIVERS },
    ]);
  });

  it("is satisfied by an option arriving in the same graph", () => {
    const missing = detectMissingRequirements({
      config: config(),
      graph: graph(
        mod("database", { requiresOneOf: DRIVERS }),
        mod("database-d1", { dependsOn: ["database"] })
      ),
    });
    expect(missing).toStrictEqual([]);
  });

  it("is satisfied by an option that is already installed", () => {
    const missing = detectMissingRequirements({
      config: config("database-postgres"),
      graph: graph(mod("database", { requiresOneOf: DRIVERS })),
    });
    expect(missing).toStrictEqual([]);
  });

  it("stays silent for a module that declares nothing", () => {
    const missing = detectMissingRequirements({
      config: config(),
      graph: graph(mod("api"), mod("validators")),
    });
    expect(missing).toStrictEqual([]);
  });

  it("treats an empty list as no requirement, so a typo cannot block every add", () => {
    const missing = detectMissingRequirements({
      config: config(),
      graph: graph(mod("database", { requiresOneOf: [] })),
    });
    expect(missing).toStrictEqual([]);
  });

  it("reports in topological order, one entry per declaring module", () => {
    const missing = detectMissingRequirements({
      config: config(),
      graph: graph(
        mod("api", { requiresOneOf: ["api-node"] }),
        mod("database", { requiresOneOf: DRIVERS })
      ),
    });
    expect(missing.map((m) => m.declaredBy)).toStrictEqual(["api", "database"]);
  });
});

describe("formatMissingRequirements — the refusal text", () => {
  it("names the requested module when it is the one that declared the choice", () => {
    const message = formatMissingRequirements(
      [{ declaredBy: "database", options: DRIVERS }],
      "database"
    );
    expect(message).toContain("Cannot add database");
    expect(message).toContain("database needs one of");
    expect(message).toContain("database-d1, database-postgres");
    expect(message).toContain("saasaloy add database-d1");
  });

  it("says which requested module dragged in the declaring prerequisite", () => {
    const message = formatMissingRequirements(
      [{ declaredBy: "database", options: DRIVERS }],
      "waitlist"
    );
    expect(message).toContain("Cannot add waitlist");
    expect(message).toContain("database (required by waitlist)");
  });

  it("pluralizes the heading for more than one requirement", () => {
    const message = formatMissingRequirements(
      [
        { declaredBy: "api", options: ["api-node"] },
        { declaredBy: "database", options: DRIVERS },
      ],
      "waitlist"
    );
    expect(message).toContain("unmet requirements");
    expect(message.split("\n")).toHaveLength(3);
  });
});

const item = (requiresOneOf: unknown) => ({
  name: "database",
  type: "saasaloy:capability",
  requiresOneOf,
});

describe("registry-item schema — requiresOneOf", () => {
  it("accepts a list of module names", async () => {
    const result = await validateRegistryItem(item(DRIVERS));
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("accepts a descriptor that omits the field", async () => {
    const result = await validateRegistryItem({
      name: "database",
      type: "saasaloy:capability",
    });
    expect(result.errors).toStrictEqual([]);
    expect(result.valid).toBeTruthy();
  });

  it("rejects a name that isn't a module name", async () => {
    expect(
      (await validateRegistryItem(item(["Database-D1"]))).valid
    ).toBeFalsy();
    expect((await validateRegistryItem(item(["../etc"]))).valid).toBeFalsy();
  });

  it("rejects a repeated name", async () => {
    const result = await validateRegistryItem(
      item(["database-d1", "database-d1"])
    );
    expect(result.valid).toBeFalsy();
  });

  it("rejects a single-option list — that is what dependsOn is for", async () => {
    const result = await validateRegistryItem(item(["database-d1"]));
    expect(result.valid).toBeFalsy();
  });

  it("rejects a string in place of the list", async () => {
    const result = await validateRegistryItem(item("database-d1"));
    expect(result.valid).toBeFalsy();
  });
});

// The first-party wiring these two fields exist for (#98, ADR 0026's amendment). The
// descriptors are read off disk rather than restated here, so an edit that unpicks the
// driver split fails a test instead of shipping.

const MODULES_DIR = fileURLToPath(
  new URL("../../../../modules", import.meta.url)
);

async function descriptor(name: string): Promise<RegistryItem> {
  const raw = await readFile(
    `${MODULES_DIR}/${name}/registry-item.json`,
    "utf-8"
  );
  return JSON.parse(raw) as RegistryItem;
}

async function loaded(name: string): Promise<LoadedModule> {
  return { dir: `${MODULES_DIR}/${name}`, item: await descriptor(name) };
}

const PROVENANCE: ModuleProvenance = {
  ref: "main",
  resolved: "9f3a1c2b7e5d4808a1f6c9b2e0d7a4c3f5b8e1d0",
  source: "mimukit/saasaloy",
};

describe("the first-party database driver wiring", () => {
  it("has the core requiring one of the two drivers", async () => {
    expect((await descriptor("database")).requiresOneOf).toStrictEqual([
      "database-d1",
      "database-postgres",
    ]);
  });

  it("has each driver refusing the other", async () => {
    expect((await descriptor("database-d1")).conflictsWith).toContain(
      "database-postgres"
    );
    expect((await descriptor("database-postgres")).conflictsWith).toContain(
      "database-d1"
    );
  });

  it("has the two SQLite payloads depending on the D1 driver", async () => {
    expect((await descriptor("auth")).dependsOn).toContain("database-d1");
    expect((await descriptor("waitlist")).dependsOn).toContain("database-d1");
  });

  it("leaves nothing unmet when a driver comes in as a prerequisite", async () => {
    const missing = detectMissingRequirements({
      config: config(),
      graph: graph(
        await loaded("database"),
        await loaded("database-d1"),
        await loaded("auth")
      ),
    });
    expect(missing).toStrictEqual([]);
  });

  it("refuses `add auth` on a project already running database-postgres", async () => {
    // The acceptance case: `add database-postgres`, then `add auth`. The reverse pass
    // reads the installed driver's lock entry, and `auth`'s new `dependsOn` is what puts
    // `database-d1` in the graph for it to collide with.
    const installed = await loaded("database-postgres");
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ["database-postgres"], graph(installed));

    const report = detectConflicts({
      config: config("database", "database-postgres"),
      graph: graph(
        await loaded("database"),
        await loaded("database-d1"),
        await loaded("auth")
      ),
      lock,
    });

    expect(report.conflicts).toStrictEqual([
      {
        conflictsWith: "database-postgres",
        declaredBy: "database-d1",
        installed: "database-postgres",
      },
    ]);
    const message = formatConflicts(report.conflicts, "auth");
    expect(message).toContain("Cannot add auth");
    expect(message).toContain("database-d1 (required by auth)");
    expect(message).toContain("saasaloy remove database-postgres");
  });
});
