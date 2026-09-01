import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashContent, pathExists } from "./fs-utils.js";
import { emptyLock } from "./lock.js";
import type { Lockfile } from "./lock.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest, ManifestPatch } from "./manifest.js";
import { applyPatch } from "./patch/index.js";
import {
  buildRemovePlan,
  classifyTrackedFile,
  executeRemovePlan,
} from "./remover.js";
import type { RemovePlan } from "./remover.js";
import type { SaasaloyConfig } from "./schema.js";

// The undo side of the applier split (issue #27): `buildRemovePlan` classifies each
// manifest-owned file/link/patch against fresh disk state; `executeRemovePlan` acts
// on that classification. Fully offline — no module descriptor involved, only the
// three local state files, mirroring applier.test.ts's fixture style.

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-remove-root-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function emptyConfig(): SaasaloyConfig {
  return { aliases: {}, installed: [] };
}

async function writeManaged(
  manifest: Manifest,
  target: string,
  content: string,
  module = "auth"
): Promise<void> {
  const abs = join(root, ...target.split("/"));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf-8");
  manifest.managed[target] = { module, hash: hashContent(content) };
}

async function build(
  name: string,
  config: SaasaloyConfig,
  manifest: Manifest,
  lock: Lockfile
): Promise<RemovePlan> {
  return buildRemovePlan({ root, name, config, manifest, lock });
}

// The one definition of "is this still the file Saasaloy put there?", shared with
// `update`'s delete side (updater.ts) so the two commands can't disagree about drift.
describe(classifyTrackedFile, () => {
  it("calls a file whose hash still matches safe to delete", () => {
    expect(classifyTrackedFile("v1\n", hashContent("v1\n"))).toBe("delete");
  });

  it("calls a hand-edited file drift", () => {
    expect(classifyTrackedFile("edited\n", hashContent("v1\n"))).toBe("drift");
  });

  it("calls an absent file missing", () => {
    expect(classifyTrackedFile(undefined, hashContent("v1\n"))).toBe("missing");
  });
});

describe("buildRemovePlan — file classification", () => {
  it("classifies a hash-clean managed file as delete", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "export const x = 1;\n"
    );
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toMatchObject({
      target: "apps/api/src/routes/auth.ts",
      action: "delete",
    });
  });

  it("classifies a hand-edited managed file as drift", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "export const x = 1;\n"
    );
    // Hand-edit after the manifest hash was recorded.
    await writeFile(
      join(root, "apps/api/src/routes/auth.ts"),
      "export const x = 2; // hand-edited\n",
      "utf-8"
    );
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files[0]?.action).toBe("drift");
  });

  it("classifies an already-gone managed file as missing", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "export const x = 1;\n"
    );
    await rm(join(root, "apps/api/src/routes/auth.ts"));
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files[0]?.action).toBe("missing");
  });

  it("only picks up files owned by the named module — unmanaged/other-module files untouched", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    await writeManaged(
      manifest,
      "apps/api/src/routes/billing.ts",
      "billing\n",
      "billing"
    );
    // A file the manifest never tracked at all.
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await writeFile(
      join(root, "apps/api/src/hand-written.ts"),
      "hand\n",
      "utf-8"
    );

    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
  });
});

describe("buildRemovePlan — dependents", () => {
  it("refuses via named dependents when an installed module's lock dependsOn names this one", async () => {
    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["auth", "billing"],
    };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) },
        billing: {
          source: "s/r",
          ref: "main",
          resolved: "b".repeat(40),
          dependsOn: ["auth"],
        },
      },
    };
    const plan = await build("auth", config, emptyManifest(), lock);
    expect(plan.dependents).toStrictEqual(["billing"]);
  });

  it("has no dependents when nothing installed depends on the module", async () => {
    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) },
      },
    };
    const plan = await build("auth", config, emptyManifest(), lock);
    expect(plan.dependents).toStrictEqual([]);
  });

  it("warns (missingLockEntries) when an installed module has no lock entry", async () => {
    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["auth", "mystery"],
    };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) },
      },
    };
    const plan = await build("auth", config, emptyManifest(), lock);
    expect(plan.missingLockEntries).toStrictEqual(["mystery"]);
  });
});

describe("buildRemovePlan — links", () => {
  async function skillManifest(module = "auth"): Promise<Manifest> {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      ".agents/skills/saasaloy-auth/SKILL.md",
      "# runbook\n",
      module
    );
    manifest.links[".agents/skills/saasaloy-auth"] =
      ".claude/skills/saasaloy-auth";
    return manifest;
  }

  it("attributes a link to the module owning files under its target, action remove when correct", async () => {
    const manifest = await skillManifest();
    // A real correct symlink pointing at the skill folder.
    const targetAbs = join(root, ".agents/skills/saasaloy-auth");
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(dirname(linkAbs), { recursive: true });
    await symlink(targetAbs, linkAbs, "dir");

    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0]).toMatchObject({
      module: "auth",
      target: ".agents/skills/saasaloy-auth",
      path: ".claude/skills/saasaloy-auth",
      action: "remove",
    });
  });

  it("classifies as missing when nothing sits at the link path", async () => {
    const manifest = await skillManifest();
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.links[0]?.action).toBe("missing");
  });

  it("classifies as conflict when a non-saasaloy path occupies the link", async () => {
    const manifest = await skillManifest();
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(linkAbs, { recursive: true });
    await writeFile(join(linkAbs, "SKILL.md"), "hand-written\n", "utf-8");

    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.links[0]?.action).toBe("conflict");
  });

  it("excludes a link owned by another module", async () => {
    const manifest = await skillManifest("billing");
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.links).toHaveLength(0);
  });
});

describe("buildRemovePlan — patches", () => {
  it("collects only this module's manifest.patches entries", async () => {
    const manifest = emptyManifest();
    const authPatch: ManifestPatch = {
      module: "auth",
      file: "apps/api/package.json",
      patch: {
        file: "apps/api/package.json",
        kind: "package-json-dependency",
        section: "dependencies",
        name: "@repo/auth",
        range: "workspace:*",
      },
    };
    const billingPatch: ManifestPatch = {
      module: "billing",
      file: "apps/api/package.json",
      patch: {
        file: "apps/api/package.json",
        kind: "package-json-dependency",
        section: "dependencies",
        name: "@repo/billing",
        range: "workspace:*",
      },
    };
    manifest.patches.push(authPatch, billingPatch);

    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.patches).toStrictEqual([
      { entry: authPatch, action: "drop", diff: "" },
    ]);
  });

  it("previews a reversible patch as a diff, writing nothing", async () => {
    const target = "apps/api/src/index.ts";
    const source = `import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`;
    const abs = join(root, ...target.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, source, "utf-8");

    const manifest = emptyManifest();
    manifest.patches.push({
      module: "waitlist",
      file: target,
      patch: {
        file: target,
        kind: "chained-route",
        exportName: "default",
        path: "/waitlist",
        call: "waitlist",
        import: { name: "waitlist", from: "./routes/waitlist.js" },
      },
    });

    const plan = await build(
      "waitlist",
      { aliases: {}, installed: ["waitlist"] },
      manifest,
      emptyLock()
    );
    expect(plan.patches[0]?.action).toBe("revert");
    // `--diff` promises the edit, not a label: the removed link has to be in there.
    expect(plan.patches[0]?.diff).toContain(target);
    expect(plan.patches[0]?.diff).toContain('.route("/waitlist", waitlist)');
    // Planning is read-only.
    await expect(readFile(abs, "utf-8")).resolves.toBe(source);
  });

  it("classifies a patch the inverse refuses, with the reason and no diff", async () => {
    const target = "apps/api/src/index.ts";
    const abs = join(root, ...target.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(
      abs,
      `import { Hono } from "hono";
import { myWaitlist } from "./mine.js";

const app = new Hono().route("/waitlist", myWaitlist);

export default app;
`,
      "utf-8"
    );

    const manifest = emptyManifest();
    manifest.patches.push({
      module: "waitlist",
      file: target,
      patch: {
        file: target,
        kind: "chained-route",
        exportName: "default",
        path: "/waitlist",
        call: "waitlist",
        import: { name: "waitlist", from: "./routes/waitlist.js" },
      },
    });

    const plan = await build(
      "waitlist",
      { aliases: {}, installed: ["waitlist"] },
      manifest,
      emptyLock()
    );
    expect(plan.patches[0]?.action).toBe("refused");
    expect(plan.patches[0]?.diff).toBe("");
    expect(plan.patches[0]?.reason).toContain("myWaitlist");
  });

  it("classifies a reversible patch whose target file is gone", async () => {
    const target = "apps/api/src/index.ts";
    const manifest = emptyManifest();
    manifest.patches.push({
      module: "waitlist",
      file: target,
      patch: {
        file: target,
        kind: "chained-route",
        exportName: "default",
        path: "/waitlist",
        call: "waitlist",
        import: { name: "waitlist", from: "./routes/waitlist.js" },
      },
    });

    const plan = await build(
      "waitlist",
      { aliases: {}, installed: ["waitlist"] },
      manifest,
      emptyLock()
    );
    expect(plan.patches[0]?.action).toBe("gone");
    expect(plan.patches[0]?.diff).toBe("");
  });
});

describe("executeRemovePlan — file deletion", () => {
  it("deletes hash-clean files and untracks them, leaving unmanaged files untouched", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await writeFile(
      join(root, "apps/api/src/hand-written.ts"),
      "hand\n",
      "utf-8"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(
      pathExists(join(root, "apps/api/src/routes/auth.ts"))
    ).resolves.toBeFalsy();
    expect(manifest.managed["apps/api/src/routes/auth.ts"]).toBeUndefined();
    expect(result.deleted.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
    // The hand-written file the manifest never attributed to us survives untouched.
    await expect(
      readFile(join(root, "apps/api/src/hand-written.ts"), "utf-8")
    ).resolves.toBe("hand\n");
  });

  it("leaves a drifted file on disk and untracked when not confirmed for deletion", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    await writeFile(
      join(root, "apps/api/src/routes/auth.ts"),
      "hand-edited\n",
      "utf-8"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(
      pathExists(join(root, "apps/api/src/routes/auth.ts"))
    ).resolves.toBeTruthy();
    await expect(
      readFile(join(root, "apps/api/src/routes/auth.ts"), "utf-8")
    ).resolves.toBe("hand-edited\n");
    expect(manifest.managed["apps/api/src/routes/auth.ts"]).toBeUndefined();
    expect(result.driftSurvivors.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
    expect(result.deleted).toHaveLength(0);
  });

  it("deletes a drifted file when the caller confirms it via deleteDrifted", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    await writeFile(
      join(root, "apps/api/src/routes/auth.ts"),
      "hand-edited\n",
      "utf-8"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
      deleteDrifted: new Set(["apps/api/src/routes/auth.ts"]),
    });

    await expect(
      pathExists(join(root, "apps/api/src/routes/auth.ts"))
    ).resolves.toBeFalsy();
    expect(result.deleted.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
    expect(result.driftSurvivors).toHaveLength(0);
  });

  it("untracks a missing file without erroring", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    await rm(join(root, "apps/api/src/routes/auth.ts"));

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(result.missingUntracked.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
    expect(manifest.managed["apps/api/src/routes/auth.ts"]).toBeUndefined();
  });
});

describe("executeRemovePlan — links", () => {
  it("removes a correct symlink and drops its manifest entry", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      ".agents/skills/saasaloy-auth/SKILL.md",
      "# runbook\n",
      "auth"
    );
    manifest.links[".agents/skills/saasaloy-auth"] =
      ".claude/skills/saasaloy-auth";
    const targetAbs = join(root, ".agents/skills/saasaloy-auth");
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(dirname(linkAbs), { recursive: true });
    await symlink(targetAbs, linkAbs, "dir");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(pathExists(linkAbs)).resolves.toBeFalsy();
    expect(manifest.links[".agents/skills/saasaloy-auth"]).toBeUndefined();
    expect(result.linksRemoved).toHaveLength(1);
  });

  it("leaves a conflicting symlink path untouched but still drops the manifest entry", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      ".agents/skills/saasaloy-auth/SKILL.md",
      "# runbook\n",
      "auth"
    );
    manifest.links[".agents/skills/saasaloy-auth"] =
      ".claude/skills/saasaloy-auth";
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(linkAbs, { recursive: true });
    await writeFile(join(linkAbs, "SKILL.md"), "hand-written\n", "utf-8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect((await lstat(linkAbs)).isDirectory()).toBeTruthy();
    expect(manifest.links[".agents/skills/saasaloy-auth"]).toBeUndefined();
    expect(result.linkConflicts).toHaveLength(1);
  });
});

describe("executeRemovePlan — patches", () => {
  // #36 gave the two config kinds an inverse and deliberately left the two `package.json`
  // kinds alone: a dependency other code may already import is not ours to uninstall
  // offline. This is the test that keeps that half of the contract honest.
  it("drops a kind with no inverse and reports it for the command to warn about", async () => {
    const manifest = emptyManifest();
    const authPatch: ManifestPatch = {
      module: "auth",
      file: "apps/api/package.json",
      patch: {
        file: "apps/api/package.json",
        kind: "package-json-dependency",
        section: "dependencies",
        name: "@repo/auth",
        range: "workspace:*",
      },
    };
    const billingPatch: ManifestPatch = {
      module: "billing",
      file: "apps/api/package.json",
      patch: {
        file: "apps/api/package.json",
        kind: "package-json-dependency",
        section: "dependencies",
        name: "@repo/billing",
        range: "workspace:*",
      },
    };
    manifest.patches.push(authPatch, billingPatch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(result.patchesDropped).toStrictEqual([authPatch]);
    expect(result.patchesReversed).toStrictEqual([]);
    expect(manifest.patches).toStrictEqual([billingPatch]);
  });

  // #83 Phase 4: the `package-json-script` kind has no inverse either, so `remove` must
  // leave the command on disk rather than half-reverting it. #36 generalised reversal to
  // the two config kinds and left this one where it was, on purpose.
  it("leaves a package-json-script command on disk and drops the record", async () => {
    const target = "apps/api/package.json";
    const source =
      '{\n  "name": "@app/api",\n  "scripts": {\n    "db:generate": "drizzle-kit generate"\n  }\n}\n';
    const abs = join(root, ...target.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, source, "utf-8");

    const manifest = emptyManifest();
    const patch: ManifestPatch = {
      module: "database",
      file: target,
      patch: {
        file: target,
        kind: "package-json-script",
        name: "db:generate",
        value: "drizzle-kit generate",
      },
    };
    manifest.patches.push(patch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["database"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("database", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchesDropped).toStrictEqual([patch]);
    await expect(readFile(abs, "utf-8")).resolves.toBe(source);
    expect(manifest.patches).toStrictEqual([]);
  });
});

// The first reversible patch kind (#83); `wrangler-binding` and `plugin-array` joined it
// in #36. These tests pin the seam as much as the codemod.
describe("executeRemovePlan — chained-route reversal", () => {
  const ENTRY_TARGET = "apps/api/src/index.ts";

  function routePatch(
    module: string,
    path: string,
    call: string
  ): ManifestPatch {
    return {
      module,
      file: ENTRY_TARGET,
      patch: {
        file: ENTRY_TARGET,
        kind: "chained-route",
        exportName: "default",
        path,
        call,
        import: { name: call, from: `./routes/${call}.js` },
      },
    };
  }

  // The entry file belongs to `api`, not to the module being removed — a patch mutates
  // another module's file, which is exactly why it isn't manifest-managed.
  async function writeEntry(content: string): Promise<string> {
    const abs = join(root, ...ENTRY_TARGET.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
    return abs;
  }

  it("deletes the .route() link and its import, leaving a file that still compiles", async () => {
    const abs = await writeEntry(`import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export type AppType = typeof app;
export default app;
`);
    const manifest = emptyManifest();
    const patch = routePatch("waitlist", "/waitlist", "waitlist");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    const after = await readFile(abs, "utf-8");
    expect(after).not.toContain("waitlist");
    expect(after).toContain("const app = new Hono();");
    expect(after).toContain("export type AppType = typeof app;");
    expect(result.patchesReversed).toStrictEqual([patch]);
    expect(result.patchesDropped).toStrictEqual([]);
    expect(manifest.patches).toStrictEqual([]);
  });

  it("leaves another module's link in the same chain alone", async () => {
    const abs = await writeEntry(`import { Hono } from "hono";
import { billing } from "./routes/billing.js";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/billing", billing).route("/waitlist", waitlist);

export default app;
`);
    const manifest = emptyManifest();
    manifest.patches.push(
      routePatch("waitlist", "/waitlist", "waitlist"),
      routePatch("billing", "/billing", "billing")
    );

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["waitlist", "billing"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);
    await executeRemovePlan(plan, { root, config, manifest, lock });

    const after = await readFile(abs, "utf-8");
    expect(after).toContain('.route("/billing", billing)');
    expect(after).toContain('from "./routes/billing.js"');
    expect(after).not.toContain("/waitlist");
    expect(manifest.patches.map((p) => p.module)).toStrictEqual(["billing"]);
  });

  it("drops without reverting when the link was already hand-removed", async () => {
    const source = `import { Hono } from "hono";

const app = new Hono();

export default app;
`;
    const abs = await writeEntry(source);
    const manifest = emptyManifest();
    const patch = routePatch("waitlist", "/waitlist", "waitlist");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(readFile(abs, "utf-8")).resolves.toBe(source);
    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchesDropped).toStrictEqual([patch]);
  });

  it("drops without reverting when the target file is gone", async () => {
    const manifest = emptyManifest();
    const patch = routePatch("waitlist", "/waitlist", "waitlist");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchesDropped).toStrictEqual([patch]);
  });

  it("reverses against fresh disk content, not the content at plan time", async () => {
    const abs = await writeEntry(`import { Hono } from "hono";

const app = new Hono();

export default app;
`);
    const manifest = emptyManifest();
    manifest.patches.push(routePatch("waitlist", "/waitlist", "waitlist"));

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);

    // The link lands between planning and executing — the reversal must still find it.
    await writeFile(
      abs,
      `import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`,
      "utf-8"
    );

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });
    expect(result.patchesReversed).toHaveLength(1);
    await expect(readFile(abs, "utf-8")).resolves.not.toContain("waitlist");
  });

  it("leaves a route repointed at the user's own handler, and says why", async () => {
    const source = `import { Hono } from "hono";
import { myWaitlist } from "./mine.js";

const app = new Hono().route("/waitlist", myWaitlist);

export default app;
`;
    const abs = await writeEntry(source);
    const manifest = emptyManifest();
    const patch = routePatch("waitlist", "/waitlist", "waitlist");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    // The line is the user's now, so it survives — but the record still goes, because
    // the module is being uninstalled either way.
    await expect(readFile(abs, "utf-8")).resolves.toBe(source);
    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchesDropped).toStrictEqual([patch]);
    expect(result.patchRefusals).toHaveLength(1);
    expect(result.patchRefusals[0]?.reason).toContain("myWaitlist");
    expect(manifest.patches).toStrictEqual([]);
  });

  it("untracks each entry as it is handled, so a mid-run failure matches disk", async () => {
    const abs = await writeEntry(`import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`);
    const broken = "apps/api/src/broken.ts";
    const manifest = emptyManifest();
    const good = routePatch("waitlist", "/waitlist", "waitlist");
    const bad: ManifestPatch = {
      module: "waitlist",
      file: broken,
      patch: {
        file: broken,
        kind: "chained-route",
        exportName: "default",
        path: "/waitlist",
        call: "waitlist",
        import: { name: "waitlist", from: "./routes/waitlist.js" },
      },
    };
    manifest.patches.push(good, bad);

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    // Plan while the second target is a readable file, so the failure lands in execute's
    // loop rather than in the plan's preview. Then swap it for a directory: `pathExists`
    // still says yes and the read throws EISDIR. Any mid-loop I/O failure would do; this
    // one needs no mocking.
    const secondTarget = join(root, ...broken.split("/"));
    await writeFile(secondTarget, "export default {};\n", "utf-8");
    const plan = await build("waitlist", config, manifest, lock);
    await rm(secondTarget);
    await mkdir(secondTarget, { recursive: true });

    await expect(
      executeRemovePlan(plan, { root, config, manifest, lock })
    ).rejects.toThrow(Error);

    // The first entry was reversed on disk, so it must not still be tracked; the second
    // never completed, so it must be. `runRemove` saves the manifest from a `finally`.
    await expect(readFile(abs, "utf-8")).resolves.not.toContain("/waitlist");
    expect(manifest.patches).toStrictEqual([bad]);
  });

  it("refuses a patch target reached through a symlink, touching nothing outside the root", async () => {
    const outside = await mkdtemp(join(tmpdir(), "saasaloy-remove-outside-"));
    const secret = join(outside, "secret.ts");
    const original = `export const secret = "untouched";\n`;
    await writeFile(secret, original, "utf-8");

    // A hand-edited or corrupt manifest names an in-root path; the path is a symlink out.
    const linkAbs = join(root, ...ENTRY_TARGET.split("/"));
    await mkdir(dirname(linkAbs), { recursive: true });
    await symlink(secret, linkAbs);

    const manifest = emptyManifest();
    manifest.patches.push(routePatch("waitlist", "/waitlist", "waitlist"));

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();

    // Planning reads the target to preview the reversal, so it refuses first — the earliest
    // point at which the link is visible, and before any write could happen.
    await expect(build("waitlist", config, manifest, lock)).rejects.toThrow(
      /symlink/
    );
    await expect(readFile(secret, "utf-8")).resolves.toBe(original);
    await rm(outside, { recursive: true, force: true });
  });

  it("refuses at execute too, when the link appears after the plan was built", async () => {
    const outside = await mkdtemp(join(tmpdir(), "saasaloy-remove-outside-"));
    const secret = join(outside, "secret.ts");
    const original = `export const secret = "untouched";\n`;
    await writeFile(secret, original, "utf-8");

    const abs = await writeEntry(`import { Hono } from "hono";
import { waitlist } from "./routes/waitlist.js";

const app = new Hono().route("/waitlist", waitlist);

export default app;
`);
    const manifest = emptyManifest();
    manifest.patches.push(routePatch("waitlist", "/waitlist", "waitlist"));

    const config: SaasaloyConfig = { aliases: {}, installed: ["waitlist"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("waitlist", config, manifest, lock);

    // Swap the real file for a link out of the project between plan and execute. Execute
    // re-checks rather than trusting the plan, so the write never follows it.
    await rm(abs);
    await symlink(secret, abs);

    await expect(
      executeRemovePlan(plan, { root, config, manifest, lock })
    ).rejects.toThrow(/symlink/);
    await expect(readFile(secret, "utf-8")).resolves.toBe(original);
    await rm(outside, { recursive: true, force: true });
  });
});

// The two config kinds #36 made reversible. Both patch a file another module owns — a
// `wrangler.jsonc` the `api` layer wrote, a provider registry the capability wrote — which
// is exactly why neither is manifest-managed and why the reversal has to be structural.
describe("executeRemovePlan — wrangler-binding reversal", () => {
  const WRANGLER_TARGET = "apps/api/wrangler.jsonc";

  // What the `api` layer ships before any provider module patches it.
  const PRISTINE = `{
  // Cloudflare Worker config
  "name": "api",
  "compatibility_date": "2024-09-01"
}
`;

  function bindingPatch(module: string): ManifestPatch {
    return {
      module,
      file: WRANGLER_TARGET,
      patch: {
        file: WRANGLER_TARGET,
        kind: "wrangler-binding",
        bindingType: "send_email",
        entry: { name: "EMAIL", destination_address: "ops@example.com" },
        matchOn: "name",
      },
    };
  }

  async function writeWrangler(content: string): Promise<string> {
    const abs = join(root, ...WRANGLER_TARGET.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
    return abs;
  }

  it("restores the pre-patch file when nothing touched it since", async () => {
    const patched = applyPatch(
      PRISTINE,
      bindingPatch("email-cloudflare").patch,
      WRANGLER_TARGET
    );
    expect(patched.changed).toBeTruthy();
    const abs = await writeWrangler(patched.content);

    const manifest = emptyManifest();
    const patch = bindingPatch("email-cloudflare");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    expect(plan.patches[0]?.action).toBe("revert");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(readFile(abs, "utf-8")).resolves.toBe(PRISTINE);
    expect(result.patchesReversed).toStrictEqual([patch]);
    expect(result.patchesDropped).toStrictEqual([]);
    expect(manifest.patches).toStrictEqual([]);
  });

  it("leaves a sibling module's binding in place", async () => {
    const mine = bindingPatch("email-cloudflare");
    const theirs: ManifestPatch = {
      module: "database-d1",
      file: WRANGLER_TARGET,
      patch: {
        file: WRANGLER_TARGET,
        kind: "wrangler-binding",
        bindingType: "d1_databases",
        entry: { binding: "DB", database_name: "app-db" },
      },
    };
    const both = applyPatch(
      applyPatch(PRISTINE, theirs.patch, WRANGLER_TARGET).content,
      mine.patch,
      WRANGLER_TARGET
    );
    const abs = await writeWrangler(both.content);

    const manifest = emptyManifest();
    manifest.patches.push(mine, theirs);

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare", "database-d1"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    await executeRemovePlan(plan, { root, config, manifest, lock });

    const after = await readFile(abs, "utf-8");
    expect(after).not.toContain("EMAIL");
    expect(after).toContain("app-db");
    expect(after).toContain("// Cloudflare Worker config");
    expect(manifest.patches).toStrictEqual([theirs]);
  });

  it("warns and skips a binding the user edited since it was applied", async () => {
    const edited = `{
  "name": "api",
  "send_email": [
    { "name": "EMAIL", "destination_address": "me@mine.dev" }
  ]
}
`;
    const abs = await writeWrangler(edited);

    const manifest = emptyManifest();
    const patch = bindingPatch("email-cloudflare");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    expect(plan.patches[0]?.action).toBe("refused");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    // The entry is the user's now, so it survives — but the record still goes.
    await expect(readFile(abs, "utf-8")).resolves.toBe(edited);
    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchRefusals).toHaveLength(1);
    expect(result.patchRefusals[0]?.reason).toContain("send_email[name=EMAIL]");
    expect(manifest.patches).toStrictEqual([]);
  });

  it("reports a hand-reverted binding as gone rather than refused", async () => {
    await writeWrangler(PRISTINE);

    const manifest = emptyManifest();
    manifest.patches.push(bindingPatch("email-cloudflare"));

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    expect(plan.patches[0]?.action).toBe("gone");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });
    expect(result.patchRefusals).toStrictEqual([]);
    expect(result.patchesDropped).toHaveLength(1);
  });
});

describe("executeRemovePlan — plugin-array reversal", () => {
  const EMAIL_TARGET = "packages/email/src/index.ts";

  // What the `email` capability ships before any provider module patches it — including
  // the empty `providers` array, which it writes itself and which must survive the undo.
  const PRISTINE = `import { createEmail } from "./create.js";

export const email = createEmail({
  from: "noreply@example.com",
  providers: [],
});
`;

  function pluginPatch(module: string): ManifestPatch {
    return {
      module,
      file: EMAIL_TARGET,
      patch: {
        file: EMAIL_TARGET,
        kind: "plugin-array",
        exportName: "email",
        arrayProp: "providers",
        call: "cloudflare",
        import: { name: "cloudflare", from: "./providers/cloudflare.js" },
      },
    };
  }

  async function writeEmail(content: string): Promise<string> {
    const abs = join(root, ...EMAIL_TARGET.split("/"));
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, "utf-8");
    return abs;
  }

  it("restores the pre-patch file, import and all, when nothing touched it since", async () => {
    const patched = applyPatch(
      PRISTINE,
      pluginPatch("email-cloudflare").patch,
      EMAIL_TARGET
    );
    expect(patched.content).toContain("cloudflare()");
    const abs = await writeEmail(patched.content);

    const manifest = emptyManifest();
    const patch = pluginPatch("email-cloudflare");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    expect(plan.patches[0]?.action).toBe("revert");
    expect(plan.patches[0]?.diff).toContain("cloudflare");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(readFile(abs, "utf-8")).resolves.toBe(PRISTINE);
    expect(result.patchesReversed).toStrictEqual([patch]);
    expect(manifest.patches).toStrictEqual([]);
  });

  it("warns and skips a call the user configured since it was applied", async () => {
    const edited = `import { createEmail } from "./create.js";
import { cloudflare } from "./providers/cloudflare.js";

export const email = createEmail({
  providers: [cloudflare({ retries: 3 })],
});
`;
    const abs = await writeEmail(edited);

    const manifest = emptyManifest();
    manifest.patches.push(pluginPatch("email-cloudflare"));

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    expect(plan.patches[0]?.action).toBe("refused");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(readFile(abs, "utf-8")).resolves.toBe(edited);
    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchRefusals[0]?.reason).toContain("cloudflare()");
    expect(manifest.patches).toStrictEqual([]);
  });

  it("previews the reversal without writing, so --dry-run and --diff are honest", async () => {
    const patched = applyPatch(
      PRISTINE,
      pluginPatch("email-cloudflare").patch,
      EMAIL_TARGET
    );
    const abs = await writeEmail(patched.content);

    const manifest = emptyManifest();
    manifest.patches.push(pluginPatch("email-cloudflare"));

    const plan = await build(
      "email-cloudflare",
      { aliases: {}, installed: ["email-cloudflare"] },
      manifest,
      emptyLock()
    );

    expect(plan.patches[0]?.diff).toContain("-");
    expect(plan.patches[0]?.diff).toContain(EMAIL_TARGET);
    // Building a plan is pure: the file and the manifest are exactly as they were.
    await expect(readFile(abs, "utf-8")).resolves.toBe(patched.content);
    expect(manifest.patches).toHaveLength(1);
  });

  // A target whose syntax a hand edit broke is still a hand-edited target, so it takes
  // the same warn-and-skip route as a drifted one. The parser throws where the codemods
  // can't catch it without giving up their pure `string => string` contract, so the
  // remover catches it and names the file — a bare `Unexpected token (5:20)` abort tells
  // a user nothing about which of the workspace's files to open.
  it("refuses a target whose syntax is broken instead of aborting the whole remove", async () => {
    const broken = `import { createEmail } from "./create.js";
import { cloudflare } from "./providers/cloudflare.js";

export const email = createEmail({
  providers: [cloudflare()],
});

function alsoBroken( {{{
`;
    const abs = await writeEmail(broken);

    const manifest = emptyManifest();
    const patch = pluginPatch("email-cloudflare");
    manifest.patches.push(patch);

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["email-cloudflare"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("email-cloudflare", config, manifest, lock);
    expect(plan.patches[0]?.action).toBe("refused");
    expect(plan.patches[0]?.reason).toContain(EMAIL_TARGET);
    expect(plan.patches[0]?.reason).toContain("does not parse");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(readFile(abs, "utf-8")).resolves.toBe(broken);
    expect(result.patchesReversed).toStrictEqual([]);
    expect(result.patchesDropped).toStrictEqual([patch]);
    expect(result.patchRefusals[0]?.reason).toContain(EMAIL_TARGET);
    expect(manifest.patches).toStrictEqual([]);
  });
});

describe("executeRemovePlan — empty-dir pruning", () => {
  it("prunes a capability's scaffolded workspace once every file under it is gone", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/reports/package.json",
      "{}\n",
      "reports"
    );
    await writeManaged(
      manifest,
      "apps/reports/src/index.ts",
      "export default {};\n",
      "reports"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["reports"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(pathExists(join(root, "apps/reports"))).resolves.toBeFalsy();
    // `apps/` itself was only holding this one workspace, so it empties out too —
    // pruning climbs until the first non-empty ancestor, never past the project root.
    expect(result.prunedDirs.toSorted()).toStrictEqual(
      ["apps", "apps/reports", "apps/reports/src"].toSorted()
    );
    await expect(pathExists(root)).resolves.toBeTruthy();
  });

  it("stops at the first non-empty ancestor and never prunes the project root", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/reports/src/index.ts",
      "export default {};\n",
      "reports"
    );
    // A sibling file under apps/reports/ that isn't ours — keeps the workspace dir alive.
    await writeFile(join(root, "apps/reports/README.md"), "hi\n", "utf-8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["reports"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(pathExists(join(root, "apps/reports"))).resolves.toBeTruthy();
    await expect(
      pathExists(join(root, "apps/reports/README.md"))
    ).resolves.toBeTruthy();
    // `apps/reports/src` emptied out and is pruned, but README.md keeps its parent alive.
    expect(result.prunedDirs).toStrictEqual(["apps/reports/src"]);
  });
});

describe("executeRemovePlan — dangling aliases", () => {
  it("drops an alias whose prefix directory vanished with the workspace", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/reports/src/index.ts",
      "export default {};\n",
      "reports"
    );

    const config: SaasaloyConfig = {
      aliases: { "@reports": "apps/reports/src" },
      installed: ["reports"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(config.aliases["@reports"]).toBeUndefined();
    expect(result.droppedAliases).toStrictEqual(["@reports"]);
  });

  it("keeps an alias whose prefix directory still exists", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/reports/src/index.ts",
      "export default {};\n",
      "reports"
    );
    // Another file under the alias prefix that isn't ours keeps it alive.
    await writeFile(join(root, "apps/reports/src/keep.ts"), "keep\n", "utf-8");

    const config: SaasaloyConfig = {
      aliases: { "@reports": "apps/reports/src" },
      installed: ["reports"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(config.aliases["@reports"]).toBe("apps/reports/src");
    expect(result.droppedAliases).toStrictEqual([]);
  });
});

describe("executeRemovePlan — state reconciliation", () => {
  it("drops the module from installed[] and deletes its lock entry", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );

    const config: SaasaloyConfig = {
      aliases: {},
      installed: ["auth", "billing"],
    };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) },
        billing: { source: "s/r", ref: "main", resolved: "b".repeat(40) },
      },
    };
    const plan = await build("auth", config, manifest, lock);
    await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(config.installed).toStrictEqual(["billing"]);
    expect(lock.modules.auth).toBeUndefined();
    expect(lock.modules.billing).toBeDefined();
  });

  it("carries stored warnings into the plan and deletes them after removal", async () => {
    const manifest = emptyManifest();
    manifest.removeWarnings.auth = ["The auth tables survive removal."];
    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock = emptyLock();

    const plan = await build("auth", config, manifest, lock);
    expect(plan.warnings).toStrictEqual(["The auth tables survive removal."]);

    await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(manifest.removeWarnings.auth).toBeUndefined();
  });
});

// Regression cover for two findings on PR #37. Both are about trusting stale
// inputs: the manifest's own keys, and the plan's view of disk once interactive
// confirms have held it open.

describe("buildRemovePlan — path containment", () => {
  // The manifest is persisted JSON, so a corrupt or hand-edited key could point
  // anywhere; `join()` would normalize the `..` away and the delete would land
  // outside the project.
  it.each([
    ["parent traversal", "../../../etc/passwd"],
    ["traversal mid-path", "apps/../../outside.ts"],
    ["absolute posix path", "/etc/passwd"],
    ["backslash separator", "apps\\api\\x.ts"],
    ["windows drive path", "C:/Windows/system32/x.ts"],
  ])("refuses a managed key with %s", async (_label, badTarget) => {
    const manifest = emptyManifest();
    manifest.managed[badTarget] = { module: "auth", hash: "0".repeat(64) };
    await expect(
      build("auth", emptyConfig(), manifest, emptyLock())
    ).rejects.toThrow(/Refusing to resolve/);
  });

  it("refuses a link path that escapes the project root", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      ".agents/skills/saasaloy-auth/SKILL.md",
      "s\n",
      "auth"
    );
    manifest.links[".agents/skills/saasaloy-auth"] = "../../../tmp/evil-link";
    await expect(
      build("auth", emptyConfig(), manifest, emptyLock())
    ).rejects.toThrow(/Refusing to resolve/);
  });

  it("still accepts an ordinary nested project-relative key", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files[0]).toMatchObject({ action: "delete" });
  });
});

describe("executeRemovePlan — revalidation between plan and execute", () => {
  // The per-file drift confirms are interactive and can sit open indefinitely.
  // Anything edited in that window is user-owned content, whatever the plan said.
  it("spares a clean file edited after planning, instead of deleting it", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    expect(plan.files[0]).toMatchObject({ action: "delete" });

    // The user edits while the confirm prompt is up.
    await writeFile(
      join(root, "apps/api/src/routes/auth.ts"),
      "edited during prompt\n",
      "utf-8"
    );

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(
      readFile(join(root, "apps/api/src/routes/auth.ts"), "utf-8")
    ).resolves.toBe("edited during prompt\n");
    expect(result.deleted).toHaveLength(0);
    expect(result.driftSurvivors.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
  });

  it("spares a confirmed drift file whose content changed again after the confirm", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );
    await writeFile(
      join(root, "apps/api/src/routes/auth.ts"),
      "hand-edited\n",
      "utf-8"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    expect(plan.files[0]).toMatchObject({ action: "drift" });

    // Confirmed deleting "hand-edited\n" — then it changed again.
    await writeFile(
      join(root, "apps/api/src/routes/auth.ts"),
      "edited yet again\n",
      "utf-8"
    );

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
      deleteDrifted: new Set(["apps/api/src/routes/auth.ts"]),
    });

    await expect(
      readFile(join(root, "apps/api/src/routes/auth.ts"), "utf-8")
    ).resolves.toBe("edited yet again\n");
    expect(result.deleted).toHaveLength(0);
    expect(result.driftSurvivors.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
  });

  it("reports a file deleted after planning as missing rather than failing", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    await rm(join(root, "apps/api/src/routes/auth.ts"));

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    expect(result.deleted).toHaveLength(0);
    expect(result.missingUntracked.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
  });

  it("still deletes a file left untouched between plan and execute", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      "apps/api/src/routes/auth.ts",
      "auth\n",
      "auth"
    );

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(
      pathExists(join(root, "apps/api/src/routes/auth.ts"))
    ).resolves.toBeFalsy();
    expect(result.deleted.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.ts",
    ]);
  });

  it("leaves a link replaced by a real file after planning untouched, as a conflict", async () => {
    const manifest = emptyManifest();
    await writeManaged(
      manifest,
      ".agents/skills/saasaloy-auth/SKILL.md",
      "skill\n",
      "auth"
    );
    const targetAbs = join(root, ".agents/skills/saasaloy-auth");
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(dirname(linkAbs), { recursive: true });
    await symlink(targetAbs, linkAbs, "dir");
    manifest.links[".agents/skills/saasaloy-auth"] =
      ".claude/skills/saasaloy-auth";

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    expect(plan.links[0]).toMatchObject({ action: "remove" });

    // The user swaps the symlink for a real file of their own after planning.
    await rm(linkAbs);
    await writeFile(linkAbs, "mine now\n", "utf-8");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
    });

    await expect(readFile(linkAbs, "utf-8")).resolves.toBe("mine now\n");
    expect(result.linksRemoved).toHaveLength(0);
    expect(result.linkConflicts.map((l) => l.path)).toStrictEqual([
      ".claude/skills/saasaloy-auth",
    ]);
    expect((await lstat(linkAbs)).isSymbolicLink()).toBeFalsy();
  });
});
