import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pathExists } from "./fs-utils.js";
import { emptyLock, type Lockfile } from "./lock.js";
import { emptyManifest, type Manifest, type ManifestPatch } from "./manifest.js";
import { buildRemovePlan, executeRemovePlan, type RemovePlan } from "./remover.js";
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
  module = "auth",
): Promise<void> {
  const abs = join(root, ...target.split("/"));
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, "utf8");
  const { hashContent } = await import("./fs-utils.js");
  manifest.managed[target] = { module, hash: hashContent(content) };
}

async function build(
  name: string,
  config: SaasaloyConfig,
  manifest: Manifest,
  lock: Lockfile,
): Promise<RemovePlan> {
  return buildRemovePlan({ root, name, config, manifest, lock });
}

describe("buildRemovePlan — file classification", () => {
  it("classifies a hash-clean managed file as delete", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "export const x = 1;\n");
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files).toHaveLength(1);
    expect(plan.files[0]).toMatchObject({ target: "apps/api/src/routes/auth.ts", action: "delete" });
  });

  it("classifies a hand-edited managed file as drift", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "export const x = 1;\n");
    // Hand-edit after the manifest hash was recorded.
    await writeFile(join(root, "apps/api/src/routes/auth.ts"), "export const x = 2; // hand-edited\n", "utf8");
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files[0]?.action).toBe("drift");
  });

  it("classifies an already-gone managed file as missing", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "export const x = 1;\n");
    await rm(join(root, "apps/api/src/routes/auth.ts"));
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files[0]?.action).toBe("missing");
  });

  it("only picks up files owned by the named module — unmanaged/other-module files untouched", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    await writeManaged(manifest, "apps/api/src/routes/billing.ts", "billing\n", "billing");
    // A file the manifest never tracked at all.
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await writeFile(join(root, "apps/api/src/hand-written.ts"), "hand\n", "utf8");

    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
  });
});

describe("buildRemovePlan — dependents", () => {
  it("refuses via named dependents when an installed module's lock dependsOn names this one", async () => {
    const config: SaasaloyConfig = { aliases: {}, installed: ["auth", "billing"] };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) },
        billing: { source: "s/r", ref: "main", resolved: "b".repeat(40), dependsOn: ["auth"] },
      },
    };
    const plan = await build("auth", config, emptyManifest(), lock);
    expect(plan.dependents).toEqual(["billing"]);
  });

  it("has no dependents when nothing installed depends on the module", async () => {
    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: { auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) } },
    };
    const plan = await build("auth", config, emptyManifest(), lock);
    expect(plan.dependents).toEqual([]);
  });

  it("warns (missingLockEntries) when an installed module has no lock entry", async () => {
    const config: SaasaloyConfig = { aliases: {}, installed: ["auth", "mystery"] };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: { auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) } },
    };
    const plan = await build("auth", config, emptyManifest(), lock);
    expect(plan.missingLockEntries).toEqual(["mystery"]);
  });
});

describe("buildRemovePlan — links", () => {
  async function skillManifest(module = "auth"): Promise<Manifest> {
    const manifest = emptyManifest();
    await writeManaged(manifest, ".agents/skills/saasaloy-auth/SKILL.md", "# runbook\n", module);
    manifest.links[".agents/skills/saasaloy-auth"] = ".claude/skills/saasaloy-auth";
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
    await writeFile(join(linkAbs, "SKILL.md"), "hand-written\n", "utf8");

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
  it("collects only this module's manifest.patches entries (report-only)", async () => {
    const manifest = emptyManifest();
    const authPatch: ManifestPatch = {
      module: "auth",
      file: "apps/api/wrangler.jsonc",
      patch: { file: "apps/api/wrangler.jsonc", kind: "wrangler-binding", bindingType: "kv_namespaces", entry: { binding: "SESSIONS" } },
    };
    const billingPatch: ManifestPatch = {
      module: "billing",
      file: "apps/api/wrangler.jsonc",
      patch: { file: "apps/api/wrangler.jsonc", kind: "wrangler-binding", bindingType: "kv_namespaces", entry: { binding: "INVOICES" } },
    };
    manifest.patches.push(authPatch, billingPatch);

    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.patches).toEqual([authPatch]);
  });
});

describe("executeRemovePlan — file deletion", () => {
  it("deletes hash-clean files and untracks them, leaving unmanaged files untouched", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await writeFile(join(root, "apps/api/src/hand-written.ts"), "hand\n", "utf8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await pathExists(join(root, "apps/api/src/routes/auth.ts"))).toBe(false);
    expect(manifest.managed["apps/api/src/routes/auth.ts"]).toBeUndefined();
    expect(result.deleted.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
    // The hand-written file the manifest never attributed to us survives untouched.
    expect(await readFile(join(root, "apps/api/src/hand-written.ts"), "utf8")).toBe("hand\n");
  });

  it("leaves a drifted file on disk and untracked when not confirmed for deletion", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    await writeFile(join(root, "apps/api/src/routes/auth.ts"), "hand-edited\n", "utf8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await pathExists(join(root, "apps/api/src/routes/auth.ts"))).toBe(true);
    expect(await readFile(join(root, "apps/api/src/routes/auth.ts"), "utf8")).toBe("hand-edited\n");
    expect(manifest.managed["apps/api/src/routes/auth.ts"]).toBeUndefined();
    expect(result.driftSurvivors.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
    expect(result.deleted).toHaveLength(0);
  });

  it("deletes a drifted file when the caller confirms it via deleteDrifted", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    await writeFile(join(root, "apps/api/src/routes/auth.ts"), "hand-edited\n", "utf8");

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

    expect(await pathExists(join(root, "apps/api/src/routes/auth.ts"))).toBe(false);
    expect(result.deleted.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
    expect(result.driftSurvivors).toHaveLength(0);
  });

  it("untracks a missing file without erroring", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    await rm(join(root, "apps/api/src/routes/auth.ts"));

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(result.missingUntracked.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
    expect(manifest.managed["apps/api/src/routes/auth.ts"]).toBeUndefined();
  });
});

describe("executeRemovePlan — links", () => {
  it("removes a correct symlink and drops its manifest entry", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, ".agents/skills/saasaloy-auth/SKILL.md", "# runbook\n", "auth");
    manifest.links[".agents/skills/saasaloy-auth"] = ".claude/skills/saasaloy-auth";
    const targetAbs = join(root, ".agents/skills/saasaloy-auth");
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(dirname(linkAbs), { recursive: true });
    await symlink(targetAbs, linkAbs, "dir");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await pathExists(linkAbs)).toBe(false);
    expect(manifest.links[".agents/skills/saasaloy-auth"]).toBeUndefined();
    expect(result.linksRemoved).toHaveLength(1);
  });

  it("leaves a conflicting symlink path untouched but still drops the manifest entry", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, ".agents/skills/saasaloy-auth/SKILL.md", "# runbook\n", "auth");
    manifest.links[".agents/skills/saasaloy-auth"] = ".claude/skills/saasaloy-auth";
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(linkAbs, { recursive: true });
    await writeFile(join(linkAbs, "SKILL.md"), "hand-written\n", "utf8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect((await lstat(linkAbs)).isDirectory()).toBe(true);
    expect(manifest.links[".agents/skills/saasaloy-auth"]).toBeUndefined();
    expect(result.linkConflicts).toHaveLength(1);
  });
});

describe("executeRemovePlan — patches", () => {
  it("drops the module's patch entries and reports them for the command to warn about", async () => {
    const manifest = emptyManifest();
    const authPatch: ManifestPatch = {
      module: "auth",
      file: "apps/api/wrangler.jsonc",
      patch: { file: "apps/api/wrangler.jsonc", kind: "wrangler-binding", bindingType: "kv_namespaces", entry: { binding: "SESSIONS" } },
    };
    const billingPatch: ManifestPatch = {
      module: "billing",
      file: "apps/api/wrangler.jsonc",
      patch: { file: "apps/api/wrangler.jsonc", kind: "wrangler-binding", bindingType: "kv_namespaces", entry: { binding: "INVOICES" } },
    };
    manifest.patches.push(authPatch, billingPatch);

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(result.patchesDropped).toEqual([authPatch]);
    expect(manifest.patches).toEqual([billingPatch]);
  });
});

describe("executeRemovePlan — empty-dir pruning", () => {
  it("prunes a capability's scaffolded workspace once every file under it is gone", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/reports/package.json", "{}\n", "reports");
    await writeManaged(manifest, "apps/reports/src/index.ts", "export default {};\n", "reports");

    const config: SaasaloyConfig = { aliases: {}, installed: ["reports"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await pathExists(join(root, "apps/reports"))).toBe(false);
    // `apps/` itself was only holding this one workspace, so it empties out too —
    // pruning climbs until the first non-empty ancestor, never past the project root.
    expect(result.prunedDirs.sort()).toEqual(["apps", "apps/reports", "apps/reports/src"].sort());
    expect(await pathExists(root)).toBe(true);
  });

  it("stops at the first non-empty ancestor and never prunes the project root", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/reports/src/index.ts", "export default {};\n", "reports");
    // A sibling file under apps/reports/ that isn't ours — keeps the workspace dir alive.
    await writeFile(join(root, "apps/reports/README.md"), "hi\n", "utf8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["reports"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await pathExists(join(root, "apps/reports"))).toBe(true);
    expect(await pathExists(join(root, "apps/reports/README.md"))).toBe(true);
    // `apps/reports/src` emptied out and is pruned, but README.md keeps its parent alive.
    expect(result.prunedDirs).toEqual(["apps/reports/src"]);
  });
});

describe("executeRemovePlan — dangling aliases", () => {
  it("drops an alias whose prefix directory vanished with the workspace", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/reports/src/index.ts", "export default {};\n", "reports");

    const config: SaasaloyConfig = {
      aliases: { "@reports": "apps/reports/src" },
      installed: ["reports"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(config.aliases["@reports"]).toBeUndefined();
    expect(result.droppedAliases).toEqual(["@reports"]);
  });

  it("keeps an alias whose prefix directory still exists", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/reports/src/index.ts", "export default {};\n", "reports");
    // Another file under the alias prefix that isn't ours keeps it alive.
    await writeFile(join(root, "apps/reports/src/keep.ts"), "keep\n", "utf8");

    const config: SaasaloyConfig = {
      aliases: { "@reports": "apps/reports/src" },
      installed: ["reports"],
    };
    const lock: Lockfile = emptyLock();
    const plan = await build("reports", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(config.aliases["@reports"]).toBe("apps/reports/src");
    expect(result.droppedAliases).toEqual([]);
  });
});

describe("executeRemovePlan — state reconciliation", () => {
  it("drops the module from installed[] and deletes its lock entry", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth", "billing"] };
    const lock: Lockfile = {
      ...emptyLock(),
      modules: {
        auth: { source: "s/r", ref: "main", resolved: "a".repeat(40) },
        billing: { source: "s/r", ref: "main", resolved: "b".repeat(40) },
      },
    };
    const plan = await build("auth", config, manifest, lock);
    await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(config.installed).toEqual(["billing"]);
    expect(lock.modules.auth).toBeUndefined();
    expect(lock.modules.billing).toBeDefined();
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
    await expect(build("auth", emptyConfig(), manifest, emptyLock())).rejects.toThrow(
      /Refusing to resolve/,
    );
  });

  it("refuses a link path that escapes the project root", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, ".agents/skills/saasaloy-auth/SKILL.md", "s\n", "auth");
    manifest.links[".agents/skills/saasaloy-auth"] = "../../../tmp/evil-link";
    await expect(build("auth", emptyConfig(), manifest, emptyLock())).rejects.toThrow(
      /Refusing to resolve/,
    );
  });

  it("still accepts an ordinary nested project-relative key", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    const plan = await build("auth", emptyConfig(), manifest, emptyLock());
    expect(plan.files[0]).toMatchObject({ action: "delete" });
  });
});

describe("executeRemovePlan — revalidation between plan and execute", () => {
  // The per-file drift confirms are interactive and can sit open indefinitely.
  // Anything edited in that window is user-owned content, whatever the plan said.
  it("spares a clean file edited after planning, instead of deleting it", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    expect(plan.files[0]).toMatchObject({ action: "delete" });

    // The user edits while the confirm prompt is up.
    await writeFile(join(root, "apps/api/src/routes/auth.ts"), "edited during prompt\n", "utf8");

    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await readFile(join(root, "apps/api/src/routes/auth.ts"), "utf8")).toBe(
      "edited during prompt\n",
    );
    expect(result.deleted).toHaveLength(0);
    expect(result.driftSurvivors.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
  });

  it("spares a confirmed drift file whose content changed again after the confirm", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");
    await writeFile(join(root, "apps/api/src/routes/auth.ts"), "hand-edited\n", "utf8");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    expect(plan.files[0]).toMatchObject({ action: "drift" });

    // Confirmed deleting "hand-edited\n" — then it changed again.
    await writeFile(join(root, "apps/api/src/routes/auth.ts"), "edited yet again\n", "utf8");

    const result = await executeRemovePlan(plan, {
      root,
      config,
      manifest,
      lock,
      deleteDrifted: new Set(["apps/api/src/routes/auth.ts"]),
    });

    expect(await readFile(join(root, "apps/api/src/routes/auth.ts"), "utf8")).toBe(
      "edited yet again\n",
    );
    expect(result.deleted).toHaveLength(0);
    expect(result.driftSurvivors.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
  });

  it("reports a file deleted after planning as missing rather than failing", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    await rm(join(root, "apps/api/src/routes/auth.ts"));

    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(result.deleted).toHaveLength(0);
    expect(result.missingUntracked.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
  });

  it("still deletes a file left untouched between plan and execute", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, "apps/api/src/routes/auth.ts", "auth\n", "auth");

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await pathExists(join(root, "apps/api/src/routes/auth.ts"))).toBe(false);
    expect(result.deleted.map((f) => f.target)).toEqual(["apps/api/src/routes/auth.ts"]);
  });

  it("leaves a link replaced by a real file after planning untouched, as a conflict", async () => {
    const manifest = emptyManifest();
    await writeManaged(manifest, ".agents/skills/saasaloy-auth/SKILL.md", "skill\n", "auth");
    const targetAbs = join(root, ".agents/skills/saasaloy-auth");
    const linkAbs = join(root, ".claude/skills/saasaloy-auth");
    await mkdir(dirname(linkAbs), { recursive: true });
    await symlink(targetAbs, linkAbs, "dir");
    manifest.links[".agents/skills/saasaloy-auth"] = ".claude/skills/saasaloy-auth";

    const config: SaasaloyConfig = { aliases: {}, installed: ["auth"] };
    const lock: Lockfile = emptyLock();
    const plan = await build("auth", config, manifest, lock);
    expect(plan.links[0]).toMatchObject({ action: "remove" });

    // The user swaps the symlink for a real file of their own after planning.
    await rm(linkAbs);
    await writeFile(linkAbs, "mine now\n", "utf8");

    const result = await executeRemovePlan(plan, { root, config, manifest, lock });

    expect(await readFile(linkAbs, "utf8")).toBe("mine now\n");
    expect(result.linksRemoved).toHaveLength(0);
    expect(result.linkConflicts.map((l) => l.path)).toEqual([".claude/skills/saasaloy-auth"]);
    expect((await lstat(linkAbs)).isSymbolicLink()).toBe(false);
  });
});
