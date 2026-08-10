import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, pathExists } from "./fs-utils.js";
import { emptyLock, type Lockfile, type LockModule } from "./lock.js";
import { emptyManifest, type Manifest } from "./manifest.js";
import type { LoadedModule } from "./registry.js";
import type { RegistryItem, SaasaloyConfig } from "./schema.js";
import {
  buildUpdatePlan,
  type BuildUpdatePlanArgs,
  compareInstalled,
  executeUpdatePlan,
  type ModuleUpdateInput,
  type UpdatePlan,
} from "./updater.js";

// The three-way core of `saasaloy update` (issue #48): `compareInstalled` answers
// "did anything move?" from the lock alone, and `buildUpdatePlan` classifies every
// managed file against base (old SHA), theirs (new SHA) and mine (on disk). Nothing
// here touches the network — base/theirs arrive as on-disk module folders, exactly
// what the command hands over after fetching them, mirroring applier.test.ts's style.

const OLD_SHA = "a".repeat(40);
const NEW_SHA = "b".repeat(40);

let root: string;
let moduleRoot: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-update-root-"));
  moduleRoot = await mkdtemp(join(tmpdir(), "saasaloy-update-mod-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(moduleRoot, { recursive: true, force: true });
});

// Lay one revision of a module folder on disk and return it as a LoadedModule.
async function writeModule(
  rev: string,
  name: string,
  item: Omit<RegistryItem, "name">,
  files: Record<string, string>,
): Promise<LoadedModule> {
  const dir = join(moduleRoot, rev, name);
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf8");
  }
  return { dir, item: { name, ...item } };
}

function config(overrides: Partial<SaasaloyConfig> = {}): SaasaloyConfig {
  return { aliases: { "@api": "apps/api/src" }, installed: ["email"], ...overrides };
}

function lockWith(entries: Record<string, LockModule>): Lockfile {
  return { ...emptyLock(), modules: entries };
}

function emailLock(overrides: Partial<LockModule> = {}): Lockfile {
  return lockWith({
    email: { source: "mimukit/saasaloy", ref: "main", resolved: OLD_SHA, ...overrides },
  });
}

// Write a file on disk and track it in the manifest exactly as `add` would have.
async function trackFile(
  manifest: Manifest,
  target: string,
  content: string,
  from: string,
  module = "email",
): Promise<void> {
  const abs = join(root, ...target.split("/"));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  manifest.managed[target] = { module, hash: hashContent(content), from };
}

async function onDisk(target: string): Promise<string> {
  return readFile(join(root, ...target.split("/")), "utf8");
}

// A one-file `email` feature at two revisions — the workhorse fixture.
async function emailRevisions(base: string, theirs: string) {
  const item = {
    type: "saasaloy:feature" as const,
    files: [{ path: "files/lib/email.ts", target: "@api/lib/email.ts" }],
  };
  return {
    base: await writeModule("old", "email", item, { "files/lib/email.ts": base }),
    theirs: await writeModule("new", "email", item, { "files/lib/email.ts": theirs }),
  };
}

function input(overrides: Partial<ModuleUpdateInput> & Pick<ModuleUpdateInput, "theirs">): ModuleUpdateInput {
  return {
    comparison: {
      name: overrides.theirs.item.name,
      source: "mimukit/saasaloy",
      ref: "main",
      current: OLD_SHA,
      latest: NEW_SHA,
      status: "outdated",
    },
    ...overrides,
  };
}

function build(args: Partial<BuildUpdatePlanArgs> & Pick<BuildUpdatePlanArgs, "inputs">): Promise<UpdatePlan> {
  return buildUpdatePlan({
    root,
    config: args.config ?? config(),
    manifest: args.manifest ?? emptyManifest(),
    lock: args.lock ?? emailLock(),
    ...args,
  });
}

describe("compareInstalled", () => {
  const resolvesTo = (sha: string) => async () => sha;

  it("reports a module whose ref now points somewhere else as outdated", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: emailLock(),
      resolveRef: resolvesTo(NEW_SHA),
    });
    expect(result).toMatchObject({
      name: "email",
      source: "mimukit/saasaloy",
      ref: "main",
      current: OLD_SHA,
      latest: NEW_SHA,
      status: "outdated",
    });
  });

  it("reports a module already at the resolved SHA as current", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: emailLock(),
      resolveRef: resolvesTo(OLD_SHA),
    });
    expect(result).toMatchObject({ status: "current", latest: OLD_SHA });
  });

  it("never moves a ref that is itself a SHA, reporting it pinned", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: emailLock({ ref: OLD_SHA }),
      resolveRef: resolvesTo(NEW_SHA),
    });
    expect(result?.status).toBe("pinned");
    expect(result?.latest).toBe(OLD_SHA);
    expect(result?.detail).toContain(`pinned at ${OLD_SHA.slice(0, 7)}`);
  });

  it("treats --ref as the explicit unpin, rewriting ref alongside resolved", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: emailLock({ ref: OLD_SHA }),
      resolveRef: resolvesTo(NEW_SHA),
      overrideRef: "v2",
    });
    expect(result).toMatchObject({ ref: "v2", latest: NEW_SHA, status: "outdated" });
  });

  it("reports an installed module with no lock entry as unresolvable, never throwing", async () => {
    const [result] = await compareInstalled({
      installed: ["mystery"],
      lock: emptyLock(),
      resolveRef: resolvesTo(NEW_SHA),
    });
    expect(result).toMatchObject({ name: "mystery", status: "unresolvable" });
    expect(result?.detail).toContain("no lock entry");
  });

  it("reports a source it cannot reach as unresolvable, carrying the reason", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: emailLock(),
      resolveRef: async () => {
        throw new Error("Not found on GitHub: mimukit/saasaloy");
      },
    });
    expect(result).toMatchObject({ status: "unresolvable" });
    expect(result?.detail).toContain("Not found on GitHub");
  });

  it("skips a `local` install when no registry override is set", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: lockWith({ email: { source: "local", ref: "local", resolved: "local" } }),
      resolveRef: resolvesTo("local"),
    });
    expect(result?.status).toBe("local");
    expect(result?.detail).toContain("SAASALOY_REGISTRY_DIR");
  });

  it("updates a `local` install when the registry override is set, with no merge base", async () => {
    const [result] = await compareInstalled({
      installed: ["email"],
      lock: lockWith({ email: { source: "local", ref: "local", resolved: "local" } }),
      resolveRef: resolvesTo("local"),
      registryOverride: true,
    });
    expect(result).toMatchObject({ status: "outdated", latest: "local" });
    expect(result?.detail).toContain("local install");
  });

  it("covers every installed module in one pass, in order", async () => {
    const results = await compareInstalled({
      installed: ["api", "email"],
      lock: lockWith({
        api: { source: "mimukit/saasaloy", ref: "main", resolved: OLD_SHA },
        email: { source: "mimukit/saasaloy", ref: "main", resolved: NEW_SHA },
      }),
      resolveRef: resolvesTo(NEW_SHA),
    });
    expect(results.map((r) => [r.name, r.status])).toEqual([
      ["api", "outdated"],
      ["email", "current"],
    ]);
  });
});

describe("buildUpdatePlan — three-way file classification", () => {
  it("overwrites a clean file the module changed", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]).toMatchObject({
      target: "apps/api/src/lib/email.ts",
      from: "files/lib/email.ts",
      action: "overwrite",
      base: "v1\n",
      theirs: "v2\n",
      mine: "v1\n",
    });
  });

  it("leaves a file the module did not change alone, even when it drifted", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v1\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await writeFile(join(root, "apps/api/src/lib/email.ts"), "mine\n", "utf8");

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]?.action).toBe("skip");
  });

  it("routes a hand-edited file to the merge plan and never writes it", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await writeFile(join(root, "apps/api/src/lib/email.ts"), "mine\n", "utf8");

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]).toMatchObject({ action: "drift", base: "v1\n", theirs: "v2\n", mine: "mine\n" });
    expect(plan.modules[0]?.needsMerge).toBe(true);
  });

  it("restores a tracked file that is missing from disk", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await rm(join(root, "apps/api/src/lib/email.ts"));

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]?.action).toBe("restore");
  });

  it("classifies an untracked file the new version introduces as a two-way conflict", async () => {
    const item = {
      type: "saasaloy:feature" as const,
      files: [{ path: "files/lib/new.ts", target: "@api/lib/new.ts" }],
    };
    const theirs = await writeModule("new", "email", item, { "files/lib/new.ts": "theirs\n" });
    const base = await writeModule("old", "email", { type: "saasaloy:feature", files: [] }, {});
    await mkdir(join(root, "apps/api/src/lib"), { recursive: true });
    await writeFile(join(root, "apps/api/src/lib/new.ts"), "hand-written\n", "utf8");

    const plan = await build({ inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]).toMatchObject({ action: "conflict", base: undefined, mine: "hand-written\n" });
  });

  it("creates a file the new version adds where nothing is in the way", async () => {
    const theirs = await writeModule(
      "new",
      "email",
      { type: "saasaloy:feature", files: [{ path: "files/lib/new.ts", target: "@api/lib/new.ts" }] },
      { "files/lib/new.ts": "theirs\n" },
    );
    const base = await writeModule("old", "email", { type: "saasaloy:feature", files: [] }, {});

    const plan = await build({ inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]?.action).toBe("create");
  });

  it("falls back to re-deriving the target when a manifest entry has no `from`", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    // A project installed before `from` shipped.
    delete manifest.managed["apps/api/src/lib/email.ts"]?.from;

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]?.action).toBe("overwrite");
  });

  it("degrades to two-way when there is no base, stamping the reason", async () => {
    const { theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await writeFile(join(root, "apps/api/src/lib/email.ts"), "mine\n", "utf8");

    const plan = await build({
      manifest,
      inputs: [input({ theirs, noMergeBase: "local install" })],
    });
    expect(plan.modules[0]?.noMergeBase).toBe("local install");
    expect(plan.modules[0]?.files[0]).toMatchObject({ action: "drift", base: undefined });
  });
});

describe("buildUpdatePlan — files the new version dropped", () => {
  it("deletes a dropped file whose on-disk hash still matches", async () => {
    const base = await writeModule(
      "old",
      "email",
      { type: "saasaloy:feature", files: [{ path: "files/lib/old.ts", target: "@api/lib/old.ts" }] },
      { "files/lib/old.ts": "gone soon\n" },
    );
    const theirs = await writeModule("new", "email", { type: "saasaloy:feature", files: [] }, {});
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/old.ts", "gone soon\n", "files/lib/old.ts");

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.removals[0]).toMatchObject({
      target: "apps/api/src/lib/old.ts",
      action: "delete",
    });
  });

  it("never deletes a dropped file the user hand-edited", async () => {
    const base = await writeModule(
      "old",
      "email",
      { type: "saasaloy:feature", files: [{ path: "files/lib/old.ts", target: "@api/lib/old.ts" }] },
      { "files/lib/old.ts": "gone soon\n" },
    );
    const theirs = await writeModule("new", "email", { type: "saasaloy:feature", files: [] }, {});
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/old.ts", "gone soon\n", "files/lib/old.ts");
    await writeFile(join(root, "apps/api/src/lib/old.ts"), "my work\n", "utf8");

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.removals[0]?.action).toBe("delete-drift");
    expect(plan.modules[0]?.needsMerge).toBe(true);
  });

  it("untracks a dropped file that is already gone", async () => {
    const base = await writeModule(
      "old",
      "email",
      { type: "saasaloy:feature", files: [{ path: "files/lib/old.ts", target: "@api/lib/old.ts" }] },
      { "files/lib/old.ts": "gone soon\n" },
    );
    const theirs = await writeModule("new", "email", { type: "saasaloy:feature", files: [] }, {});
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/old.ts", "gone soon\n", "files/lib/old.ts");
    await rm(join(root, "apps/api/src/lib/old.ts"));

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.removals[0]?.action).toBe("delete-missing");
  });
});

describe("buildUpdatePlan — dependency pins", () => {
  const withDeps = (deps: string[]) => ({ type: "saasaloy:feature" as const, dependencies: deps, files: [] });

  async function writePkg(contents: Record<string, string>): Promise<void> {
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "app", dependencies: contents }, null, 2)}\n`,
      "utf8",
    );
  }

  it("bumps a pin the module owns and the user has not touched", async () => {
    const base = await writeModule("old", "email", withDeps(["hono@4.6.3"]), {});
    const theirs = await writeModule("new", "email", withDeps(["hono@4.7.1"]), {});
    await writePkg({ hono: "4.6.3" });

    const plan = await build({
      inputs: [input({ theirs, base })],
      pkg: JSON.parse(await readFile(join(root, "package.json"), "utf8")),
    });
    expect(plan.modules[0]?.depBumps).toMatchObject([{ name: "hono", from: "4.6.3", to: "4.7.1" }]);
  });

  it("leaves a pin the user overrode alone, reporting a conflict instead", async () => {
    const base = await writeModule("old", "email", withDeps(["hono@4.6.3"]), {});
    const theirs = await writeModule("new", "email", withDeps(["hono@4.7.1"]), {});
    await writePkg({ hono: "4.9.9" });

    const plan = await build({
      inputs: [input({ theirs, base })],
      pkg: JSON.parse(await readFile(join(root, "package.json"), "utf8")),
    });
    expect(plan.modules[0]?.depBumps).toEqual([]);
    expect(plan.modules[0]?.depConflicts.join(" ")).toContain("hono");
  });

  it("adds a dependency the new version introduces", async () => {
    const base = await writeModule("old", "email", withDeps([]), {});
    const theirs = await writeModule("new", "email", withDeps(["zod@4.1.0"]), {});
    await writePkg({});

    const plan = await build({
      inputs: [input({ theirs, base })],
      pkg: JSON.parse(await readFile(join(root, "package.json"), "utf8")),
    });
    expect(plan.modules[0]?.depAdds).toEqual([{ name: "zod", version: "4.1.0" }]);
  });
});

describe("buildUpdatePlan — config patches", () => {
  const patched = {
    type: "saasaloy:capability" as const,
    files: [],
    patches: [
      {
        file: "apps/api/wrangler.jsonc",
        kind: "wrangler-binding" as const,
        bindingType: "d1_databases",
        entry: { binding: "DB", database_id: "local" },
      },
    ],
  };

  it("re-applies a patch that is not yet present", async () => {
    const theirs = await writeModule("new", "email", patched, {});
    await mkdir(join(root, "apps/api"), { recursive: true });
    await writeFile(join(root, "apps/api/wrangler.jsonc"), '{ "name": "api" }\n', "utf8");

    const plan = await build({ inputs: [input({ theirs })] });
    expect(plan.modules[0]?.patches[0]).toMatchObject({ file: "apps/api/wrangler.jsonc", action: "apply" });
  });

  it("reports a patch whose matchOn key already holds a different value", async () => {
    const theirs = await writeModule("new", "email", patched, {});
    await mkdir(join(root, "apps/api"), { recursive: true });
    await writeFile(
      join(root, "apps/api/wrangler.jsonc"),
      '{ "d1_databases": [{ "binding": "DB", "database_id": "9f2c-real" }] }\n',
      "utf8",
    );

    const plan = await build({ inputs: [input({ theirs })] });
    expect(plan.modules[0]?.patches[0]).toMatchObject({ action: "unchanged" });
    expect(plan.modules[0]?.patches[0]?.matched).toMatchObject({ key: "d1_databases[binding=DB]" });
    expect(plan.modules[0]?.needsMerge).toBe(true);
  });

  // `add` deliberately doesn't re-hash a file it patched (the patch belongs to another
  // module), so the file reads as drift here forever. Naming the patcher keeps the merge
  // plan from blaming the user for a change Saasaloy itself made.
  it("names the module that patched a file which now classifies as drift", async () => {
    const item = {
      type: "saasaloy:feature" as const,
      files: [{ path: "files/package.json", target: "@api/package.json" }],
    };
    const base = await writeModule("old", "email", item, { "files/package.json": '{ "name": "api" }\n' });
    const theirs = await writeModule("new", "email", item, { "files/package.json": '{ "name": "api", "v": 2 }\n' });
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/package.json", '{ "name": "api" }\n', "files/package.json");
    await writeFile(join(root, "apps/api/src/package.json"), '{ "name": "api", "deps": {} }\n', "utf8");
    manifest.patches.push({
      module: "billing",
      file: "apps/api/src/package.json",
      patch: {
        file: "apps/api/src/package.json",
        kind: "package-json-dependency",
        section: "dependencies",
        name: "@repo/billing",
        range: "workspace:*",
      },
    });

    const plan = await build({ manifest, inputs: [input({ theirs, base })] });
    expect(plan.modules[0]?.files[0]).toMatchObject({ action: "drift", patchedBy: ["billing"] });
  });
});

describe("buildUpdatePlan — a new dependsOn", () => {
  // The new version needs a capability the project doesn't have yet. It gets folded
  // into the same confirmed plan, pinned to the same SHA (decision 11).
  async function withNewPrereq() {
    const base = await writeModule("old", "email", { type: "saasaloy:feature", files: [] }, {});
    const theirs = await writeModule(
      "new",
      "email",
      { type: "saasaloy:feature", dependsOn: ["queue"], files: [] },
      {},
    );
    const queue = await writeModule(
      "new",
      "queue",
      {
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: "apps/queue",
            aliases: { "@queue": "apps/queue/src" },
            files: [{ path: "files/index.ts", target: "src/index.ts" }],
          },
        ],
      },
      { "files/index.ts": "export default {};\n" },
    );
    return { base, theirs, prereqs: { order: ["queue"], modules: new Map([["queue", queue]]) } };
  }

  it("folds the new prerequisite into the same plan", async () => {
    const { base, theirs, prereqs } = await withNewPrereq();
    const plan = await build({ inputs: [input({ theirs, base, prereqs })] });
    expect(plan.modules[0]?.prereqNames).toEqual(["queue"]);
    expect(plan.modules[0]?.prereqPlan?.files.map((f) => f.target)).toEqual(["apps/queue/src/index.ts"]);
  });

  it("installs it and gives it its own lock entry at the same SHA", async () => {
    const { base, theirs, prereqs } = await withNewPrereq();
    const state = { config: config(), manifest: emptyManifest(), lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base, prereqs })] });

    const result = await executeUpdatePlan(plan, { root, ...state });
    expect(result.prereqsInstalled).toEqual(["queue"]);
    expect(await onDisk("apps/queue/src/index.ts")).toBe("export default {};\n");
    expect(state.lock.modules.queue).toMatchObject({ resolved: NEW_SHA, ref: "main" });
    expect(state.config.installed).toContain("queue");
    expect(state.config.aliases["@queue"]).toBe("apps/queue/src");
  });

  it("leaves an already-installed prerequisite alone", async () => {
    const { base, theirs, prereqs } = await withNewPrereq();
    const plan = await build({
      config: config({ installed: ["email", "queue"] }),
      inputs: [input({ theirs, base, prereqs })],
    });
    expect(plan.modules[0]?.prereqNames).toEqual([]);
    expect(plan.modules[0]?.prereqPlan).toBeUndefined();
  });
});

describe("buildUpdatePlan — reporting and surfacing", () => {
  it("reports installed modules with no lock entry rather than failing", async () => {
    const { theirs } = await emailRevisions("v1\n", "v2\n");
    const plan = await build({
      config: config({ installed: ["email", "mystery"] }),
      inputs: [input({ theirs })],
    });
    expect(plan.missingLockEntries).toEqual(["mystery"]);
  });

  it("surfaces the migration command when a db schema file moved", async () => {
    const item = {
      type: "saasaloy:capability" as const,
      files: [{ path: "files/schema/users.ts", target: "@db/schema/users.ts" }],
    };
    const base = await writeModule("old", "email", item, { "files/schema/users.ts": "v1\n" });
    const theirs = await writeModule("new", "email", item, { "files/schema/users.ts": "v2\n" });

    const plan = await build({
      config: config({ aliases: { "@db": "packages/db/src" }, installed: ["email", "database"] }),
      inputs: [input({ theirs, base })],
    });
    expect(plan.migrationCommand).toBe("pnpm --filter @repo/db db:generate");
  });

  it("stays quiet about migrations when `database` is not installed", async () => {
    const item = {
      type: "saasaloy:capability" as const,
      files: [{ path: "files/schema/users.ts", target: "@db/schema/users.ts" }],
    };
    const base = await writeModule("old", "email", item, { "files/schema/users.ts": "v1\n" });
    const theirs = await writeModule("new", "email", item, { "files/schema/users.ts": "v2\n" });

    const plan = await build({
      config: config({ aliases: { "@db": "packages/db/src" }, installed: ["email"] }),
      inputs: [input({ theirs, base })],
    });
    expect(plan.migrationCommand).toBeUndefined();
  });

  it("carries commit subjects through as the merge plan's intent", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const plan = await build({
      inputs: [input({ theirs, base, intent: ["fix(email): retry on 429"] })],
    });
    expect(plan.modules[0]?.intent).toEqual(["fix(email): retry on 429"]);
  });

  it("refuses a manifest path that escapes the project root", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    manifest.managed["../escape.ts"] = { module: "email", hash: "0".repeat(64), from: "files/lib/email.ts" };
    await expect(build({ manifest, inputs: [input({ theirs, base })] })).rejects.toThrow(/Refusing to resolve/);
  });
});

describe("executeUpdatePlan", () => {
  async function run(plan: UpdatePlan, state: { config: SaasaloyConfig; manifest: Manifest; lock: Lockfile }) {
    return executeUpdatePlan(plan, { root, ...state });
  }

  it("writes clean files and re-hashes them in the manifest", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    const result = await run(plan, state);
    expect(await onDisk("apps/api/src/lib/email.ts")).toBe("v2\n");
    expect(manifest.managed["apps/api/src/lib/email.ts"]).toMatchObject({
      hash: hashContent("v2\n"),
      from: "files/lib/email.ts",
    });
    expect(result.written.map((f) => f.target)).toEqual(["apps/api/src/lib/email.ts"]);
  });

  it("leaves a byte-identical file alone but backfills its manifest entry", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    // Already holds the new content — and was installed before `from` was recorded.
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v2\n", "files/lib/email.ts");
    delete manifest.managed["apps/api/src/lib/email.ts"]?.from;
    const before = await stat(join(root, "apps/api/src/lib/email.ts"));
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    const result = await run(plan, state);
    expect(result.written).toHaveLength(0);
    expect(result.refreshed.map((f) => f.target)).toEqual(["apps/api/src/lib/email.ts"]);
    expect(manifest.managed["apps/api/src/lib/email.ts"]?.from).toBe("files/lib/email.ts");
    // Untouched on disk — no pointless mtime churn on an already-correct file.
    expect((await stat(join(root, "apps/api/src/lib/email.ts"))).mtimeMs).toBe(before.mtimeMs);
  });

  it("moves the lock to the new SHA once a module fully applied", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    await run(plan, state);
    expect(state.lock.modules.email).toMatchObject({ ref: "main", resolved: NEW_SHA });
  });

  it("keeps the lock at the old SHA while anything still needs merging", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await writeFile(join(root, "apps/api/src/lib/email.ts"), "mine\n", "utf8");
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    await run(plan, state);
    // The old SHA is the only merge base a re-run has; moving it would strand the drift.
    expect(state.lock.modules.email?.resolved).toBe(OLD_SHA);
    expect(await onDisk("apps/api/src/lib/email.ts")).toBe("mine\n");
  });

  it("records a --ref unpin even while files are still out for merge", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await writeFile(join(root, "apps/api/src/lib/email.ts"), "mine\n", "utf8");
    const state = { config: config(), manifest, lock: emailLock({ ref: OLD_SHA }) };
    const plan = await build({
      ...state,
      inputs: [input({ theirs, base, comparison: { ...input({ theirs }).comparison, ref: "v2" } })],
    });

    const result = await run(plan, state);
    // `ref` is intent, `resolved` is fact: without this the user would have to repeat
    // `--ref` on the very re-run the merge plan asks them to do.
    expect(state.lock.modules.email).toMatchObject({ ref: "v2", resolved: OLD_SHA });
    expect(result.refsRecorded).toEqual(["email"]);
  });

  it("never writes over a file that drifted between planning and execution", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    // The user edits the file while the confirmation prompt is up.
    await writeFile(join(root, "apps/api/src/lib/email.ts"), "edited mid-prompt\n", "utf8");
    const result = await run(plan, state);

    expect(await onDisk("apps/api/src/lib/email.ts")).toBe("edited mid-prompt\n");
    expect(result.written).toHaveLength(0);
    expect(result.lateDrift.map((f) => f.target)).toEqual(["apps/api/src/lib/email.ts"]);
  });

  it("deletes a dropped file and untracks it", async () => {
    const base = await writeModule(
      "old",
      "email",
      { type: "saasaloy:feature", files: [{ path: "files/lib/old.ts", target: "@api/lib/old.ts" }] },
      { "files/lib/old.ts": "gone soon\n" },
    );
    const theirs = await writeModule("new", "email", { type: "saasaloy:feature", files: [] }, {});
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/old.ts", "gone soon\n", "files/lib/old.ts");
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    const result = await run(plan, state);
    expect(await pathExists(join(root, "apps/api/src/lib/old.ts"))).toBe(false);
    expect(manifest.managed["apps/api/src/lib/old.ts"]).toBeUndefined();
    expect(result.deleted).toHaveLength(1);
  });

  it("restores a tracked file that had been deleted", async () => {
    const { base, theirs } = await emailRevisions("v1\n", "v2\n");
    const manifest = emptyManifest();
    await trackFile(manifest, "apps/api/src/lib/email.ts", "v1\n", "files/lib/email.ts");
    await rm(join(root, "apps/api/src/lib/email.ts"));
    const state = { config: config(), manifest, lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs, base })] });

    const result = await run(plan, state);
    expect(await onDisk("apps/api/src/lib/email.ts")).toBe("v2\n");
    expect(result.written[0]?.action).toBe("restore");
  });

  it("applies config patches and records them in the manifest", async () => {
    const theirs = await writeModule(
      "new",
      "email",
      {
        type: "saasaloy:capability",
        files: [],
        patches: [
          {
            file: "apps/api/wrangler.jsonc",
            kind: "wrangler-binding",
            bindingType: "d1_databases",
            entry: { binding: "DB", database_id: "local" },
          },
        ],
      },
      {},
    );
    await mkdir(join(root, "apps/api"), { recursive: true });
    await writeFile(join(root, "apps/api/wrangler.jsonc"), '{ "name": "api" }\n', "utf8");
    const state = { config: config(), manifest: emptyManifest(), lock: emailLock() };
    const plan = await build({ ...state, inputs: [input({ theirs })] });

    await run(plan, state);
    expect(await onDisk("apps/api/wrangler.jsonc")).toContain('"DB"');
    expect(state.manifest.patches).toHaveLength(1);
  });

  it("bumps the dependency pins it planned", async () => {
    const base = await writeModule("old", "email", { type: "saasaloy:feature", dependencies: ["hono@4.6.3"], files: [] }, {});
    const theirs = await writeModule("new", "email", { type: "saasaloy:feature", dependencies: ["hono@4.7.1"], files: [] }, {});
    await writeFile(
      join(root, "package.json"),
      `${JSON.stringify({ name: "app", dependencies: { hono: "4.6.3" } }, null, 2)}\n`,
      "utf8",
    );
    const state = { config: config(), manifest: emptyManifest(), lock: emailLock() };
    const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as Record<string, unknown>;
    const plan = await build({ ...state, inputs: [input({ theirs, base })], pkg });

    await executeUpdatePlan(plan, { root, ...state, pkg });
    const written = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(written.dependencies.hono).toBe("4.7.1");
  });
});
