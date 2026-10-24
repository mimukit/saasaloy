import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  backfillTargets,
  isEmptyBackfill,
  originFor,
  planBackfill,
  runBackfill,
} from "./backfill.js";
import type { SourceOpener } from "./backfill.js";
import { hashContent, pathExists } from "./fs-utils.js";
import { emptyLock } from "./lock.js";
import type { Lockfile } from "./lock.js";
import { emptyManifest, loadManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";
import { LocalRegistrySource, REGISTRY_ENV } from "./registry.js";
import type { RegistryItem, SaasaloyConfig } from "./schema.js";

// #242 Phase 2. Backfill writes each gated entry of an installed module whose `when` is
// now true and whose target is untracked, through `buildPlan` with a selector.

let root: string;
let registry: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-backfill-root-"));
  registry = await mkdtemp(join(tmpdir(), "saasaloy-backfill-reg-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(registry, { recursive: true, force: true });
});

async function writeModule(
  name: string,
  item: Omit<RegistryItem, "name">,
  files: Record<string, string>
): Promise<void> {
  const dir = join(registry, name);
  await mkdir(dir, { recursive: true });
  await writeFile(
    join(dir, "registry-item.json"),
    JSON.stringify({ name, ...item })
  );
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), content);
  }
}

async function authModule(): Promise<void> {
  await writeModule(
    "auth",
    {
      type: "saasaloy:capability",
      dependencies: ["zod@4.4.3"],
      files: [
        { path: "files/auth.ts", target: "@api/routes/auth.ts" },
        {
          path: "files/auth.vitest.ts",
          target: "@api/routes/auth.test.ts",
          when: { testing: true },
        },
        {
          path: "files/auth.spec.ts",
          target: "@api/e2e/auth.spec.ts",
          when: { installed: ["e2e"] },
        },
      ],
      patches: [
        {
          file: "package.json",
          kind: "package-json-script",
          name: "test:auth",
          value: "vitest run auth",
          when: { testing: true },
        },
      ],
    },
    {
      "files/auth.ts": "auth\n",
      "files/auth.vitest.ts": "test\n",
      "files/auth.spec.ts": "spec\n",
    }
  );
}

interface State {
  config: SaasaloyConfig;
  manifest: Manifest;
  lock: Lockfile;
}

async function installedAuth(mode: "off" | "tests-after"): Promise<State> {
  await authModule();
  await mkdir(join(root, "apps/api/src/routes"), { recursive: true });
  await writeFile(join(root, "apps/api/src/routes/auth.ts"), "auth\n");
  await writeFile(join(root, "package.json"), '{ "name": "app" }\n');
  const manifest = emptyManifest();
  manifest.managed["apps/api/src/routes/auth.ts"] = {
    from: "files/auth.ts",
    hash: hashContent("auth\n"),
    module: "auth",
  };
  return {
    config: {
      aliases: { "@api": "apps/api/src" },
      installed: ["auth"],
      testing: { mode },
    },
    lock: emptyLock(),
    manifest,
  };
}

const env = (): NodeJS.ProcessEnv => ({ [REGISTRY_ENV]: registry });

describe(originFor, () => {
  const entry = {
    ref: "main",
    resolved: "c".repeat(40),
    source: "acme/registry",
  };

  it("reads a module at its locked SHA from its locked source", () => {
    expect(originFor("auth", entry, {})).toStrictEqual({
      kind: "remote",
      owner: "acme",
      repo: "registry",
      sha: "c".repeat(40),
    });
  });

  it("reads the working copy when the override is set", () => {
    expect(
      originFor("auth", entry, { [REGISTRY_ENV]: "/tmp/mods" })
    ).toStrictEqual({ dir: "/tmp/mods", kind: "local" });
  });

  it("skips a working-copy install with no override, naming the variable", () => {
    const origin = originFor(
      "auth",
      { ref: "local", resolved: "local", source: "local" },
      {}
    );

    expect(origin.kind).toBe("skip");
    expect(origin.kind === "skip" && origin.reason).toContain(REGISTRY_ENV);
  });

  it("skips a module with no lock entry", () => {
    expect(originFor("auth", undefined, {}).kind).toBe("skip");
  });
});

describe(planBackfill, () => {
  it("plans nothing while testing is off", async () => {
    const state = await installedAuth("off");

    const { plan, cleanup } = await planBackfill({
      ...state,
      env: env(),
      root,
    });
    await cleanup();

    expect(isEmptyBackfill(plan)).toBeTruthy();
    expect(plan.install).toStrictEqual([]);
  });

  it("selects the gated test file and patch once testing is on, and nothing else", async () => {
    const state = await installedAuth("tests-after");

    const { plan, cleanup } = await planBackfill({
      ...state,
      env: env(),
      root,
    });
    await cleanup();

    expect(plan.files.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.test.ts",
    ]);
    expect(plan.patches.map((p) => p.patch.kind)).toStrictEqual([
      "package-json-script",
    ]);
    expect(plan.dependencies).toStrictEqual([]);
    expect(plan.links).toStrictEqual([]);
    expect(plan.install).toStrictEqual(["auth"]);
  });

  // `update` holds its post-apply backfill to what it listed and backed up (#242 A4).
  it("keeps only the paths `within` names, and reports them", async () => {
    const state = await installedAuth("tests-after");

    const { plan, cleanup } = await planBackfill({
      ...state,
      env: env(),
      root,
      within: new Set(["package.json"]),
    });
    await cleanup();

    expect(plan.files).toStrictEqual([]);
    expect(backfillTargets(plan)).toStrictEqual(["package.json"]);
  });

  it("selects an installed-gated file once the module it names is installed", async () => {
    const state = await installedAuth("off");
    state.config.installed.push("e2e");
    state.lock.modules.e2e = {
      ref: "local",
      resolved: "local",
      source: "local",
    };
    await writeModule("e2e", { type: "saasaloy:capability" }, {});

    const { plan, cleanup } = await planBackfill({
      ...state,
      env: env(),
      exclude: new Set(["e2e"]),
      root,
    });
    await cleanup();

    expect(plan.files.map((f) => f.target)).toStrictEqual([
      "apps/api/src/e2e/auth.spec.ts",
    ]);
  });

  it("leaves out a target the manifest already tracks", async () => {
    const state = await installedAuth("tests-after");
    state.manifest.managed["apps/api/src/routes/auth.test.ts"] = {
      hash: hashContent("old\n"),
      module: "auth",
    };

    const { plan, cleanup } = await planBackfill({
      ...state,
      env: env(),
      root,
    });
    await cleanup();

    expect(plan.files).toStrictEqual([]);
  });

  it("opens one source per locked SHA and reads each module there", async () => {
    const state = await installedAuth("tests-after");
    const sha = "d".repeat(40);
    state.lock.modules.auth = {
      ref: "main",
      resolved: sha,
      source: "acme/reg",
    };
    const opened: unknown[] = [];
    const open: SourceOpener = (origin) => {
      opened.push(origin);
      return new LocalRegistrySource(registry);
    };

    const { plan, cleanup } = await planBackfill({
      ...state,
      env: {},
      open,
      root,
    });
    await cleanup();

    expect(opened).toStrictEqual([
      { kind: "remote", owner: "acme", repo: "reg", sha },
    ]);
    expect(plan.files).toHaveLength(1);
  });

  it("skips a working-copy install with no override and reports it", async () => {
    const state = await installedAuth("tests-after");
    state.lock.modules.auth = {
      ref: "local",
      resolved: "local",
      source: "local",
    };

    const { plan, skipped, cleanup } = await planBackfill({
      ...state,
      env: {},
      root,
    });
    await cleanup();

    expect(isEmptyBackfill(plan)).toBeTruthy();
    expect(skipped.map((s) => s.module)).toStrictEqual(["auth"]);
  });
});

describe(runBackfill, () => {
  it("writes the gated entries, records their when, and saves the ledger", async () => {
    const state = await installedAuth("tests-after");

    const outcome = await runBackfill({ ...state, env: env(), root });

    expect(outcome.result?.written.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.test.ts",
    ]);
    await expect(
      readFile(join(root, "apps/api/src/routes/auth.test.ts"), "utf-8")
    ).resolves.toBe("test\n");
    const saved = await loadManifest(root);
    expect(
      saved.managed["apps/api/src/routes/auth.test.ts"]?.when
    ).toStrictEqual({ testing: true });
    expect(saved.patches.map((p) => p.when)).toStrictEqual([{ testing: true }]);
  });

  it("is a no-op the second time", async () => {
    const state = await installedAuth("tests-after");
    await runBackfill({ ...state, env: env(), root });

    const again = await runBackfill({ ...state, env: env(), root });

    expect(isEmptyBackfill(again.plan)).toBeTruthy();
    expect(again.result).toBeUndefined();
  });

  it("holds back an owner file at the target and leaves it untracked", async () => {
    const state = await installedAuth("tests-after");
    await writeFile(join(root, "apps/api/src/routes/auth.test.ts"), "mine\n");

    const outcome = await runBackfill({ ...state, env: env(), root });

    expect(outcome.result?.heldBack.map((f) => f.target)).toStrictEqual([
      "apps/api/src/routes/auth.test.ts",
    ]);
    await expect(
      readFile(join(root, "apps/api/src/routes/auth.test.ts"), "utf-8")
    ).resolves.toBe("mine\n");
    expect(
      state.manifest.managed["apps/api/src/routes/auth.test.ts"]
    ).toBeUndefined();
  });

  it("writes no lock change", async () => {
    const state = await installedAuth("tests-after");
    const before = JSON.stringify(state.lock);

    await runBackfill({ ...state, env: env(), root });

    expect(JSON.stringify(state.lock)).toBe(before);
    await expect(
      pathExists(join(root, "saasaloy-lock.json"))
    ).resolves.toBeTruthy();
  });
});
