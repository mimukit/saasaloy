import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyLock, loadLock, saveLock, upsertLock } from "./lock.js";
import type { LoadedModule, ModuleProvenance } from "./registry.js";
import type { Graph } from "./resolve.js";
import { validateLock } from "./schema.js";

const PROVENANCE: ModuleProvenance = {
  source: "mimukit/saasaloy",
  ref: "main",
  resolved: "9f3a1c2b7e5d4808a1f6c9b2e0d7a4c3f5b8e1d0",
};

function mod(name: string, dependsOn?: string[]): LoadedModule {
  return { dir: `/tmp/${name}`, item: { name, type: "saasaloy:feature", dependsOn } };
}

const ALL = ["database", "api", "hello-widget"];

function graph(): Graph {
  return {
    order: ALL,
    modules: new Map([
      ["database", mod("database")],
      ["api", mod("api", ["database"])],
      ["hello-widget", mod("hello-widget", ["api", "database"])],
    ]),
  };
}

describe("upsertLock", () => {
  it("records each installed module under one source's provenance", () => {
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ALL, graph());
    expect(Object.keys(lock.modules).sort()).toEqual(["api", "database", "hello-widget"]);
    expect(lock.modules["hello-widget"]).toEqual({ ...PROVENANCE, dependsOn: ["api", "database"] });
  });

  it("records only the modules that were installed, not the whole graph", () => {
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ["hello-widget"], graph());
    expect(Object.keys(lock.modules)).toEqual(["hello-widget"]);
  });

  it("leaves an already-installed dependency's prior SHA untouched", () => {
    const lock = emptyLock();
    // database was installed earlier at an older SHA.
    const older: ModuleProvenance = { source: "mimukit/saasaloy", ref: "main", resolved: "b".repeat(40) };
    upsertLock(lock, older, ["database"], graph());
    // Now hello-widget is installed at a newer SHA; database is skipped, not re-fetched.
    upsertLock(lock, PROVENANCE, ["hello-widget"], graph());
    expect(lock.modules.database?.resolved).toBe("b".repeat(40));
    expect(lock.modules["hello-widget"]?.resolved).toBe(PROVENANCE.resolved);
  });

  it("omits dependsOn for a module that declares none", () => {
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ALL, graph());
    expect(lock.modules.database).toEqual(PROVENANCE);
    expect(lock.modules.database).not.toHaveProperty("dependsOn");
  });

  it("overwrites a prior entry on re-resolution", () => {
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ALL, graph());
    const next: ModuleProvenance = { source: "mimukit/saasaloy", ref: "main", resolved: "a".repeat(40) };
    upsertLock(lock, next, ALL, graph());
    expect(lock.modules.api?.resolved).toBe("a".repeat(40));
  });
});

describe("lockfile shape", () => {
  it("produces a document that validates against the schema", async () => {
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ALL, graph());
    const result = await validateLock(lock);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });
});

describe("loadLock / saveLock", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-lock-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("returns an empty lock when the file is missing", async () => {
    expect((await loadLock(root)).modules).toEqual({});
  });

  it("round-trips through disk", async () => {
    const lock = emptyLock();
    upsertLock(lock, PROVENANCE, ALL, graph());
    await saveLock(root, lock);
    const reloaded = await loadLock(root);
    expect(reloaded.lockfileVersion).toBe(1);
    expect(reloaded.modules).toEqual(lock.modules);
  });
});
