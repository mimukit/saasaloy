import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseRecord } from "./base.js";
import {
  checkBase,
  checkConfigValues,
  checkDeploy,
  checkModule,
  checkPartialInstalls,
  checkEnv,
  checkPolicyBindings,
  checkProject,
  checkRetiredInfra,
  checkTarget,
  checkUnmetRequirements,
  KV_INDEX_FILE,
  readConfigState,
  readPolicyState,
  registryModuleNames,
  resolveDoctorTarget,
  WRANGLER_FILE,
  hasRetiredInfra,
  INFRA_RUNBOOK,
  readEnvState,
  readDeployState,
  DEPLOY_TARGETS_FILE,
  RELEASE_WRAPPER,
} from "./doctor.js";
import type { Finding, ModuleReport } from "./doctor.js";
import { hashContent } from "./fs-utils.js";
import { emptyLock } from "./lock.js";
import { emptyManifest } from "./manifest.js";
import type { Manifest } from "./manifest.js";

// The fixtures live outside `src/` on purpose: several are invalid by design, one is not
// parseable JSON at all, and the type-aware lint pass and the build both ignore anything
// under `test/`.

const CLEAN = fileURLToPath(
  new URL("../../test/fixtures/registry-clean", import.meta.url)
);
const BROKEN = fileURLToPath(
  new URL("../../test/fixtures/registry-broken", import.meta.url)
);

async function check(dir: string, name?: string): Promise<ModuleReport[]> {
  const target = await resolveDoctorTarget(
    name === undefined ? dir : `${dir}/${name}`
  );
  return checkTarget(target);
}

async function findingsFor(name: string): Promise<string[]> {
  const [report] = await check(BROKEN, name);
  return (report?.findings ?? []).map(
    (found) => `${found.where} ${found.message}`
  );
}

describe("registryModuleNames — what counts as a module", () => {
  it("counts a folder as a module when it carries a descriptor", async () => {
    await expect(registryModuleNames(CLEAN)).resolves.toStrictEqual([
      "alpha",
      "beta",
    ]);
  });

  it("ignores a folder with no descriptor", async () => {
    const names = await registryModuleNames(BROKEN);

    expect(names).not.toContain("no-descriptor");
    expect(names).toContain("bad-json");
  });
});

describe("resolveDoctorTarget — one module or a whole registry", () => {
  it("reads a folder with a descriptor as one module", async () => {
    const target = await resolveDoctorTarget(`${CLEAN}/beta`);

    expect(target.names).toStrictEqual(["beta"]);
    expect(target.registryDir).toBe(CLEAN);
  });

  it("reads a folder of module folders as a whole registry", async () => {
    const target = await resolveDoctorTarget(CLEAN);

    expect(target.names).toStrictEqual(["alpha", "beta"]);
    expect(target.registryDir).toBe(CLEAN);
  });
});

describe("doctor — a registry with nothing wrong", () => {
  it("reports no finding against either module", async () => {
    const reports = await check(CLEAN);

    expect(reports.map((r) => r.module)).toStrictEqual(["alpha", "beta"]);
    expect(reports.flatMap((r) => r.findings)).toStrictEqual([]);
  });

  it("accepts a target aliased by a sibling's scaffold, not just a base alias", async () => {
    // beta targets `@api`, which only exists because alpha's scaffold registers it.
    const [report] = await check(CLEAN, "beta");

    expect(report?.findings).toStrictEqual([]);
  });
});

describe("doctor — schema violations", () => {
  it("reports every violation, not only the first", async () => {
    const findings = await findingsFor("bad-schema");

    expect(findings).toHaveLength(4);
  });

  it("names an unexpected property", async () => {
    await expect(findingsFor("bad-schema")).resolves.toContainEqual(
      expect.stringContaining('unexpected property "unexpected"')
    );
  });

  it("names a missing required property and where it belongs", async () => {
    await expect(findingsFor("bad-schema")).resolves.toContainEqual(
      expect.stringContaining('/files/0 missing required property "target"')
    );
  });

  it("lists the allowed values for a bad enum", async () => {
    await expect(findingsFor("bad-schema")).resolves.toContainEqual(
      expect.stringContaining("saasaloy:capability, saasaloy:feature")
    );
  });

  it("reports a descriptor with no description, which the schema allows (#223)", async () => {
    const findings = await findingsFor("no-description");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatch(/^\/description missing — add a one-line/);
  });

  it("reports an empty description once, as the schema's finding", async () => {
    const dir = await mkdtemp(join(tmpdir(), "saasaloy-doctor-desc-"));
    try {
      await mkdir(join(dir, "empty"));
      await writeFile(
        join(dir, "empty", "registry-item.json"),
        JSON.stringify({
          description: "",
          name: "empty",
          type: "saasaloy:feature",
        }),
        "utf-8"
      );
      const [report] = await check(dir);

      expect(report?.findings.map((found) => found.where)).toStrictEqual([
        "/description",
      ]);
    } finally {
      await rm(dir, { force: true, recursive: true });
    }
  });

  it("reports a descriptor that is not valid JSON, and stops there", async () => {
    const findings = await findingsFor("bad-json");

    expect(findings).toHaveLength(1);
    expect(findings[0]).toContain("not valid JSON");
  });

  it("reports a folder with no descriptor at all", async () => {
    const report = await checkModule({
      aliases: { base: {}, fromScaffolds: {} },
      dir: `${BROKEN}/no-descriptor`,
      siblings: [],
    });

    expect(report.findings[0]?.message).toContain("no registry-item.json");
  });

  it("reports a wrong-shaped field instead of crashing the whole run", async () => {
    // `"scaffolds": {}` used to throw inside collectAliases/checkModule, taking every
    // sibling's report down with it. The schema names each wrong-shaped field.
    const findings = await findingsFor("wrong-shape");

    expect(findings.length).toBeGreaterThan(0);
    expect(findings).toContainEqual(expect.stringContaining("/scaffolds"));
  });

  it("still reports the siblings when one descriptor is wrong-shaped", async () => {
    const findings = await findingsFor("missing-file");

    expect(findings).toContainEqual(
      expect.stringContaining("no such file: files/gone.ts")
    );
  });

  it("finds no module in a folder that is neither a module nor a registry", async () => {
    // The command turns this into "No module folders in <path>", which is the more
    // useful message than guessing which of the two the author meant.
    const target = await resolveDoctorTarget(`${BROKEN}/no-descriptor`);

    expect(target.names).toStrictEqual([]);
  });
});

describe("doctor — the conventions the schema cannot check", () => {
  it("reports a declared file that is not on disk, and only that one", async () => {
    const findings = await findingsFor("missing-file");

    expect(findings).toStrictEqual([
      "/files/1/path no such file: files/gone.ts",
    ]);
  });

  it("reports a target whose alias nothing in the registry defines", async () => {
    const findings = await findingsFor("unknown-alias");

    expect(findings[0]).toContain('unknown alias "@nowhere"');
    // The message names what the author may use instead.
    expect(findings[0]).toContain("@web");
  });

  it("reports a dependsOn name the registry does not offer", async () => {
    await expect(findingsFor("ghost-dep")).resolves.toStrictEqual([
      '/dependsOn/0 names "ghost", which this registry does not offer',
    ]);
  });

  // #242. A `when.installed` name the registry does not offer makes an entry that never
  // ships, and `when.testing` takes `true` alone.
  it("reports a when that names an unknown module or a testing value other than true", async () => {
    await expect(findingsFor("bad-when")).resolves.toStrictEqual([
      '/files/0/when/installed/0 names "ghost", which this registry does not offer, so the entry never ships',
      "/files/1/when/testing is false — the only value is true; leave the key out for an entry that ships in every mode",
      '/patches/0/when/installed/0 names "phantom", which this registry does not offer, so the entry never ships',
    ]);
  });

  it("reports a descriptor whose name does not match its folder", async () => {
    const findings = await findingsFor("name-mismatch");

    expect(findings[0]).toContain('/name declares name "something-else"');
  });

  it("reports a dependency that is not exact-pinned, in either bucket", async () => {
    const findings = await findingsFor("unpinned-dep");

    expect(findings).toHaveLength(3);
    expect(findings[0]).toContain('"zod" is not exact-pinned');
    expect(findings[1]).toContain('"hono@^4.0.0" is not exact-pinned');
    expect(findings[2]).toContain("/devDependencies/0");
  });

  it("says the rule rather than the regex the schema matched on", async () => {
    const findings = await findingsFor("unpinned-dep");

    expect(findings.join("\n")).not.toContain("must match pattern");
    expect(findings.join("\n")).toContain("name@1.2.3");
  });

  it("reports a source path that escapes the module folder", async () => {
    // A bare `join` would resolve `../outside.ts` outside the module and report it
    // present when the file exists there; the applier refuses that descriptor.
    await expect(findingsFor("escape-path")).resolves.toContainEqual(
      expect.stringContaining(
        '/files/0/path "../outside.ts" escapes the module folder'
      )
    );
  });

  it("reports a skill path that escapes the module folder", async () => {
    await expect(findingsFor("escape-path")).resolves.toContainEqual(
      expect.stringContaining(
        '/agent/skills/0 "../saasaloy-outside" escapes the module folder'
      )
    );
  });

  it("reports a devVars key that no envVars entry describes", async () => {
    await expect(findingsFor("orphan-devvar")).resolves.toStrictEqual([
      "/devVars/ORPHAN_URL has no matching entry in envVars, so nothing describes it",
    ]);
  });

  it("reports a requires.saasaloy range it cannot parse", async () => {
    const findings = await findingsFor("bad-requires");

    expect(findings).toStrictEqual([
      '/requires/saasaloy ">=nope" isn\'t a semver range — write one like ">=0.3", ">=0.3 <2", "^1.2.0" or "1.x"',
    ]);
  });

  it("reports a non-string requires.saasaloy once, not twice", async () => {
    // The schema rejects it too, at the same path. The dedupe by `where` keeps the
    // sentence and drops the raw type error under it.
    const findings = await findingsFor("nonstring-requires");

    expect(findings).toStrictEqual([
      "/requires/saasaloy must be a semver range string, not number",
    ]);
  });

  it("passes a descriptor whose requires.saasaloy is a valid range", async () => {
    // `registry-clean/alpha` carries one. doctor never compares it against the running
    // CLI: an author's version is not the consumer's.
    const [report] = await check(CLEAN, "alpha");

    expect(report?.findings).toStrictEqual([]);
  });

  it("reports a skill folder that lacks the saasaloy- prefix (ADR 0014)", async () => {
    const findings = await findingsFor("bad-skill");

    expect(findings[0]).toContain('skill folder "helper"');
    expect(findings[0]).toContain("saasaloy-");
  });

  it("reports a declared skill folder that is not on disk", async () => {
    const findings = await findingsFor("bad-skill");

    expect(findings[1]).toContain("no such folder: saasaloy-absent");
  });
});

function manifestWith(managed: Record<string, string>): Manifest {
  const manifest = emptyManifest();
  for (const [target, module] of Object.entries(managed)) {
    manifest.managed[target] = { hash: "sha256:x", module };
  }
  return manifest;
}

function messages(findings: Finding[]): string[] {
  return findings.map((found) => `${found.where} ${found.message}`);
}

describe("checkPartialInstalls — a partial install (#49)", () => {
  it("flags a module whose files are tracked but which is not installed", () => {
    const findings = checkPartialInstalls({
      installed: ["api"],
      manifest: manifestWith({
        "apps/api/src/routes/waitlist.ts": "waitlist",
        "packages/api/src/index.ts": "api",
      }),
    });

    expect(messages(findings)).toStrictEqual([
      "/installed/waitlist partial install — re-run `saasaloy add waitlist`",
    ]);
    expect(findings[0]?.module).toBe("waitlist");
  });

  it("says nothing when every tracked module is installed", () => {
    expect(
      checkPartialInstalls({
        installed: ["api", "waitlist"],
        manifest: manifestWith({
          "apps/api/src/routes/waitlist.ts": "waitlist",
          "packages/api/src/index.ts": "api",
        }),
      })
    ).toStrictEqual([]);
  });

  it("reports one finding per module, whatever its file count, in name order", () => {
    const findings = checkPartialInstalls({
      installed: [],
      manifest: manifestWith({
        "a.ts": "waitlist",
        "b.ts": "waitlist",
        "c.ts": "api",
      }),
    });

    expect(findings.map((found) => found.module)).toStrictEqual([
      "api",
      "waitlist",
    ]);
  });

  it("counts a tracked patch and a tracked skill link, not only a written file", () => {
    const manifest = emptyManifest();
    manifest.patches.push({
      file: "apps/api/package.json",
      module: "waitlist",
      patch: {
        kind: "package-json-dependency",
        file: "apps/api/package.json",
        name: "hono",
        range: "4.0.0",
        section: "dependencies",
      },
    });

    expect(
      messages(checkPartialInstalls({ installed: [], manifest }))
    ).toStrictEqual([
      "/installed/waitlist partial install — re-run `saasaloy add waitlist`",
    ]);
  });

  it("says nothing about an empty project", () => {
    expect(
      checkPartialInstalls({ installed: [], manifest: emptyManifest() })
    ).toStrictEqual([]);
  });
});

describe("checkBase — the base's record and drift (#120)", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-doctor-base-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function tracked(files: Record<string, string>) {
    const manifest = emptyManifest();
    for (const [target, content] of Object.entries(files)) {
      await writeFile(join(root, target), content, "utf-8");
      manifest.managed[target] = { module: "base", hash: hashContent(content) };
    }
    const lock = { ...emptyLock(), base: baseRecord("0.0.0", "f".repeat(64)) };
    return { lock, manifest };
  }

  it("reports an unrecorded project as untracked, with the seed list", async () => {
    const report = await checkBase({
      root,
      lock: emptyLock(),
      manifest: emptyManifest(),
      seedFiles: ["README.md"],
    });

    expect(report.status).toBe("untracked");
    expect(report.seed).toStrictEqual(["README.md"]);
  });

  it("counts matching files, names drifted and missing ones, and lists seed files unchecked", async () => {
    const state = await tracked({
      "AGENTS.md": "a\n",
      "CLAUDE.md": "c\n",
      "README.md": "seed\n",
      "gone.md": "g\n",
    });
    await writeFile(join(root, "CLAUDE.md"), "edited\n", "utf-8");
    await writeFile(join(root, "README.md"), "rewritten\n", "utf-8");
    await rm(join(root, "gone.md"));

    const report = await checkBase({
      root,
      ...state,
      seedFiles: ["README.md"],
    });

    expect(report).toMatchObject({
      status: "tracked",
      matching: 1,
      drifted: ["CLAUDE.md"],
      missing: ["gone.md"],
      seed: ["README.md"],
    });
    expect(report.record?.cliVersion).toBe("0.0.0");
  });

  it("reads a root package.json a release bumped as matching, and an edited one as drifted (ADR 0049)", async () => {
    const at = (version: string, build: string) =>
      `{\n  "name": "app",\n  "version": "${version}",\n  "scripts": { "build": "${build}" }\n}\n`;
    const state = await tracked({ "package.json": at("0.0.0", "turbo") });
    await writeFile(join(root, "package.json"), at("0.3.0", "turbo"), "utf-8");

    const bumped = await checkBase({
      root,
      ...state,
      seedFiles: [],
      templateVersion: "0.0.0",
    });
    await writeFile(join(root, "package.json"), at("0.3.0", "mine"), "utf-8");
    const edited = await checkBase({
      root,
      ...state,
      seedFiles: [],
      templateVersion: "0.0.0",
    });

    expect(bumped).toMatchObject({ matching: 1, drifted: [] });
    expect(edited).toMatchObject({ matching: 0, drifted: ["package.json"] });
  });

  it("never reads another module's files as base drift", async () => {
    const state = await tracked({ "AGENTS.md": "a\n" });
    await writeFile(join(root, "email.ts"), "x\n", "utf-8");
    state.manifest.managed["email.ts"] = {
      module: "email",
      hash: "0".repeat(64),
    };

    const report = await checkBase({ root, ...state, seedFiles: [] });

    expect(report.drifted).toStrictEqual([]);
    expect(report.matching).toBe(1);
  });
});

describe("checkPartialInstalls — the base is not a module (#120)", () => {
  it("never reports the base's files as a partial install", () => {
    const manifest = emptyManifest();
    manifest.managed["AGENTS.md"] = { module: "base", hash: "a".repeat(64) };

    expect(checkPartialInstalls({ installed: [], manifest })).toStrictEqual([]);
  });
});

describe("doctor — the repo's own registry", () => {
  it("passes every module this repo ships", async () => {
    const modules = fileURLToPath(
      new URL("../../../../modules", import.meta.url)
    );

    const reports = await checkTarget(await resolveDoctorTarget(modules));

    expect(reports.length).toBeGreaterThan(0);
    expect(
      reports.flatMap((report) =>
        report.findings.map((f) => `${report.module}${f.where}: ${f.message}`)
      )
    ).toStrictEqual([]);
  });
});

// #107. The project rule, run over plain objects: `saasaloy.json` says a module is
// installed, `.saasaloy/manifest.json` says it owns nothing.
function manifestOwning(...modules: string[]): Manifest {
  const manifest = emptyManifest();
  for (const [index, module] of modules.entries()) {
    manifest.managed[`src/file-${index}.ts`] = { module, hash: "abc" };
  }
  return manifest;
}

describe(checkProject, () => {
  it("says nothing when every installed module owns a file", () => {
    const findings = checkProject({
      config: { aliases: {}, installed: ["auth", "waitlist"] },
      manifest: manifestOwning("auth", "waitlist"),
    });

    expect(findings).toStrictEqual([]);
  });

  it("flags the installed module that owns none, naming its remove", () => {
    const findings = checkProject({
      config: { aliases: {}, installed: ["auth", "waitlist"] },
      manifest: manifestOwning("waitlist"),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.module).toBe("auth");
    expect(findings[0]?.where).toBe("/installed");
    expect(findings[0]?.message).toContain("saasaloy remove auth");
  });

  it("says nothing when nothing is installed", () => {
    expect(
      checkProject({
        config: { aliases: {}, installed: [] },
        manifest: manifestOwning("auth"),
      })
    ).toStrictEqual([]);
  });

  it("never reports the base app, which is not a module", () => {
    const findings = checkProject({
      config: { aliases: {}, base: "base", installed: ["auth"] },
      manifest: manifestOwning("auth"),
    });

    expect(findings).toStrictEqual([]);
  });

  it("ignores links and patches — managed files are the ledger", () => {
    const manifest = emptyManifest();
    manifest.links[".agents/skills/saasaloy-auth"] = ".claude/skills/x";
    const findings = checkProject({
      config: { aliases: {}, installed: ["auth"] },
      manifest,
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.module).toBe("auth");
  });
});

// #229. A core whose `requiresOneOf` nothing installed meets, such as an owner removed
// after the split. The lock carries the list, since the descriptor is gone. A lock
// written before the split has no list, so doctor stays quiet on such a project until
// the next `add` or `update` rewrites the entry; `update` is the guard there, and it
// refuses with exit 2 before it plans a delete.
function lockRequiring(
  name: string,
  requiresOneOf: string[]
): ReturnType<typeof emptyLock> {
  const lock = emptyLock();
  lock.modules[name] = {
    source: "local",
    ref: "local",
    resolved: "local",
    requiresOneOf,
  };
  return lock;
}

describe(checkUnmetRequirements, () => {
  it("flags an installed module none of whose options is installed, naming each add", () => {
    const findings = checkUnmetRequirements({
      installed: ["api-keys"],
      lock: lockRequiring("api-keys", [
        "api-keys-organization",
        "api-keys-user",
      ]),
    });

    expect(findings).toHaveLength(1);
    expect(findings[0]?.module).toBe("api-keys");
    expect(findings[0]?.where).toBe("/installed/api-keys");
    expect(findings[0]?.message).toContain(
      "saasaloy add api-keys-organization"
    );
    expect(findings[0]?.message).toContain("saasaloy add api-keys-user");
  });

  it("says nothing when one option is installed", () => {
    expect(
      checkUnmetRequirements({
        installed: ["api-keys", "api-keys-user"],
        lock: lockRequiring("api-keys", [
          "api-keys-organization",
          "api-keys-user",
        ]),
      })
    ).toStrictEqual([]);
  });

  it("ignores a lock entry for a module that is not installed", () => {
    expect(
      checkUnmetRequirements({
        installed: [],
        lock: lockRequiring("api-keys", ["api-keys-user"]),
      })
    ).toStrictEqual([]);
  });
});

// #129. The rate limit policy rule, run over plain sources: every policy the `kv`
// registry holds must have its `RL_<NAME>` binding in `wrangler.jsonc`. Names only — the
// numbers on either side are allowed to differ, and do.
const POLICY_SOURCE = `import { definePolicy } from "../define";

export function strictPolicy() {
  return definePolicy({ limit: 10, name: "strict", periodSeconds: 10 });
}

export function defaultPolicy() {
  return definePolicy({ limit: 100, name: "default", periodSeconds: 60 });
}
`;

const KV_INDEX_SOURCE = `import { defineKv } from "./define";
import { defaultPolicy, strictPolicy } from "./policies/ratelimit";

export const kv = defineKv({
  policies: [strictPolicy(), defaultPolicy()],
  providers: [],
});
`;

function wranglerWith(...names: string[]): string {
  const entries = names
    .map(
      (name, index) =>
        `    { "name": "${name}", "namespace_id": "100${index + 1}", "simple": { "limit": 10, "period": 10 } }`
    )
    .join(",\n");
  return `{\n  // a comment, because this is jsonc\n  "name": "api",\n  "ratelimits": [\n${entries}\n  ]\n}\n`;
}

function policyArgs(
  wrangler: string
): Parameters<typeof checkPolicyBindings>[0] {
  return {
    index: KV_INDEX_SOURCE,
    policySources: { "./policies/ratelimit": POLICY_SOURCE },
    wrangler,
  };
}

describe(checkPolicyBindings, () => {
  it("says nothing when every policy has its binding", () => {
    expect(
      checkPolicyBindings(policyArgs(wranglerWith("RL_STRICT", "RL_DEFAULT")))
    ).toStrictEqual([]);
  });

  it("names the missing binding, not the policy's numbers", () => {
    const findings = checkPolicyBindings(
      policyArgs(wranglerWith("RL_DEFAULT"))
    );

    expect(findings).toHaveLength(1);
    expect(findings[0]?.module).toBe("ratelimit");
    expect(findings[0]?.where).toBe("/policies/strict");
    expect(findings[0]?.message).toContain("RL_STRICT");
  });

  it("reads the name off definePolicy, not off the factory's own name", () => {
    // `defaultPolicy()` registers the policy called "default": `default` is a reserved
    // word, so the export cannot be named after it.
    const findings = checkPolicyBindings(policyArgs(wranglerWith("RL_STRICT")));

    expect(findings.map((f) => f.where)).toStrictEqual(["/policies/default"]);
    expect(findings[0]?.message).toContain("RL_DEFAULT");
  });

  it("ignores a number that drifted on either side", () => {
    const args = policyArgs(
      wranglerWith("RL_STRICT", "RL_DEFAULT").replace(
        '"limit": 10',
        '"limit": 500'
      )
    );
    args.policySources["./policies/ratelimit"] = POLICY_SOURCE.replace(
      "limit: 10",
      "limit: 3"
    );

    expect(checkPolicyBindings(args)).toStrictEqual([]);
  });

  it("reports every policy when wrangler.jsonc has no ratelimits at all", () => {
    const findings = checkPolicyBindings({
      ...policyArgs('{ "name": "api" }\n'),
    });

    expect(findings.map((f) => f.where)).toStrictEqual([
      "/policies/strict",
      "/policies/default",
    ]);
  });

  it("reads an inline definePolicy element off its own argument", () => {
    const args = policyArgs(wranglerWith("RL_STRICT", "RL_DEFAULT"));
    args.index = KV_INDEX_SOURCE.replace(
      "defaultPolicy()",
      'defaultPolicy(), definePolicy({ limit: 5, name: "burst", periodSeconds: 10 })'
    ).replace(
      'import { defineKv } from "./define";',
      'import { defineKv, definePolicy } from "./define";'
    );

    const findings = checkPolicyBindings(args);

    expect(findings.map((f) => f.where)).toStrictEqual(["/policies/burst"]);
    expect(findings[0]?.message).toContain("RL_BURST");
  });

  it("reports an element whose name it cannot read, rather than skipping it", () => {
    const args = policyArgs(wranglerWith("RL_STRICT", "RL_DEFAULT"));
    args.index = KV_INDEX_SOURCE.replace(
      "defaultPolicy()",
      "defaultPolicy(), mysteryPolicy()"
    );

    const findings = checkPolicyBindings(args);

    expect(findings.map((f) => f.where)).toStrictEqual(["/policies/2"]);
    expect(findings[0]?.message).toContain("index 2");
  });

  it("says nothing when no policy is registered", () => {
    expect(
      checkPolicyBindings({
        index: "export const kv = defineKv({ policies: [], providers: [] });\n",
        policySources: {},
        wrangler: '{ "name": "api" }\n',
      })
    ).toStrictEqual([]);
  });
});

describe(readPolicyState, () => {
  let root = "";

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-policies-"));
    await mkdir(join(root, "packages/kv/src/policies"), { recursive: true });
    await mkdir(join(root, "apps/api"), { recursive: true });
    await writeFile(join(root, KV_INDEX_FILE), KV_INDEX_SOURCE);
    await writeFile(
      join(root, "packages/kv/src/policies/ratelimit.ts"),
      POLICY_SOURCE
    );
    await writeFile(join(root, WRANGLER_FILE), wranglerWith("RL_DEFAULT"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("reads the index, the policy file and wrangler.jsonc", async () => {
    const state = await readPolicyState(root, ["kv", "kv-cloudflare"]);

    expect(state).toBeDefined();
    expect(checkPolicyBindings(state!).map((f) => f.where)).toStrictEqual([
      "/policies/strict",
    ]);
  });

  it("does not apply without kv-cloudflare — no other provider reads wrangler.jsonc", async () => {
    await expect(
      readPolicyState(root, ["kv", "kv-memory"])
    ).resolves.toBeUndefined();
  });

  it("does not apply before kv is installed", async () => {
    await rm(join(root, KV_INDEX_FILE));

    await expect(
      readPolicyState(root, ["kv-cloudflare"])
    ).resolves.toBeUndefined();
  });
});

describe(checkEnv, () => {
  it("is quiet when no leftover .dev.vars exists", () => {
    expect(checkEnv({ legacy: [], hasKeyList: true })).toStrictEqual([]);
  });

  it("names every leftover file and the command that migrates it", () => {
    const findings = checkEnv({
      legacy: ["apps/web/.dev.vars", "apps/api/.dev.vars"],
      hasKeyList: true,
    });

    expect(findings).toHaveLength(2);
    expect(findings[0]?.where).toBe("/apps/api/.dev.vars");
    expect(findings[0]?.message).toContain("apps/api/.dev.vars still exists");
    expect(findings[0]?.message).toContain("pnpm env:setup");
    expect(findings[1]?.where).toBe("/apps/web/.dev.vars");
  });

  it("adds a second finding when there is no key list to migrate into", () => {
    const findings = checkEnv({
      legacy: ["apps/api/.dev.vars"],
      hasKeyList: false,
    });

    expect(findings).toHaveLength(2);
    expect(findings[1]?.message).toContain(
      "packages/env/.env.example is missing"
    );
  });

  it("says nothing about a missing key list on its own", () => {
    expect(checkEnv({ legacy: [], hasKeyList: false })).toStrictEqual([]);
  });
});

describe(readEnvState, () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-env-state-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("finds a leftover file under any service workspace", async () => {
    await mkdir(join(root, "apps", "api"), { recursive: true });
    await writeFile(join(root, "apps", "api", ".dev.vars"), "A=1\n", "utf-8");

    await expect(readEnvState(root)).resolves.toStrictEqual({
      legacy: ["apps/api/.dev.vars"],
      hasKeyList: false,
    });
  });

  it("sees the key list when the project has one", async () => {
    await mkdir(join(root, "packages", "env"), { recursive: true });
    await writeFile(
      join(root, "packages", "env", ".env.example"),
      "# @services api\nA=1\n",
      "utf-8"
    );

    await expect(readEnvState(root)).resolves.toStrictEqual({
      legacy: [],
      hasKeyList: true,
    });
  });
});

describe(checkRetiredInfra, () => {
  it("is quiet without an infra/ directory", () => {
    expect(checkRetiredInfra(false)).toStrictEqual([]);
  });

  it("warns against pulumi destroy and points at the runbook", () => {
    const [found] = checkRetiredInfra(true);
    expect(found?.module).toBe("deploy");
    expect(found?.message).toContain("Never run pulumi destroy");
    expect(found?.message).toContain(INFRA_RUNBOOK);
  });
});

describe(hasRetiredInfra, () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-infra-state-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  it("sees an infra/ directory left from the Pulumi deploy", async () => {
    await expect(hasRetiredInfra(root)).resolves.toBeFalsy();
    await mkdir(join(root, "infra", "state"), { recursive: true });
    await expect(hasRetiredInfra(root)).resolves.toBeTruthy();
  });
});

const TARGETS = `import type { DeployTarget } from "./types.ts";

export const DEPLOY_TARGETS: DeployTarget[] = [
  { service: "web", order: 30 },
  { service: "api", order: 10 },
];
`;

describe(checkDeploy, () => {
  it("is quiet on a project that matches the engine", () => {
    expect(
      checkDeploy({
        turbo: '{ "tasks": { "deploy": { "dependsOn": ["^build"] } } }',
        deployable: ["api", "web"],
        targets: TARGETS,
      })
    ).toStrictEqual([]);
  });

  it("warns while turbo.json still names db:migrate:prod, and prints the fix", () => {
    const [found, ...rest] = checkDeploy({
      turbo:
        '{ "tasks": { "deploy": { "dependsOn": ["^build", "^db:migrate:prod"] }, "db:migrate:prod": {} } }',
      deployable: [],
      targets: undefined,
    });

    expect(rest).toStrictEqual([]);
    expect(found?.module).toBe("deploy");
    expect(found?.where).toBe("/turbo.json");
    expect(found?.message).toContain("db:migrate:prod");
    expect(found?.message).toContain(
      'Remove "^db:migrate:prod" from the deploy task\'s dependsOn'
    );
    expect(found?.message).toContain("pnpm deploy:production --migrate");
  });

  it("warns once per deployable workspace with no DEPLOY_TARGETS row", () => {
    const findings = checkDeploy({
      turbo: undefined,
      deployable: ["admin", "api", "docs", "web"],
      targets: TARGETS,
    });

    expect(findings.map((found) => found.where)).toStrictEqual([
      `/${DEPLOY_TARGETS_FILE}`,
      `/${DEPLOY_TARGETS_FILE}`,
    ]);
    expect(findings[0]?.message).toContain(
      "apps/admin deploys and has no DEPLOY_TARGETS row"
    );
    expect(findings[0]?.message).toContain(
      `Add { service: "admin", order: <number> } to ${DEPLOY_TARGETS_FILE}`
    );
    expect(findings[1]?.message).toContain("apps/docs");
  });

  it("warns when the targets file is missing, and says how to get it", () => {
    const [found, ...rest] = checkDeploy({
      turbo: undefined,
      deployable: ["web"],
      targets: undefined,
    });

    expect(rest).toStrictEqual([]);
    expect(found?.message).toContain(`${DEPLOY_TARGETS_FILE} is missing`);
    expect(found?.message).toContain("saasaloy update");
  });

  it("warns when the release wrapper exists and the root release script does not", () => {
    const [found, ...rest] = checkDeploy({
      turbo: undefined,
      deployable: [],
      targets: undefined,
      releaseWrapper: true,
      releaseScript: false,
    });

    expect(rest).toStrictEqual([]);
    expect(found?.where).toBe("/package.json");
    expect(found?.message).toContain(
      '"release": "node packages/tooling/src/release.ts"'
    );
  });

  it("says nothing about the release when the script is there, or the wrapper is not", () => {
    const none = { turbo: undefined, deployable: [], targets: undefined };
    expect(
      checkDeploy({ ...none, releaseWrapper: true, releaseScript: true })
    ).toStrictEqual([]);
    expect(
      checkDeploy({ ...none, releaseWrapper: false, releaseScript: false })
    ).toStrictEqual([]);
  });

  it("says nothing about a missing targets file when nothing deploys", () => {
    expect(
      checkDeploy({ turbo: undefined, deployable: [], targets: undefined })
    ).toStrictEqual([]);
  });

  it("warns when the targets file has no DEPLOY_TARGETS array literal", () => {
    const [found] = checkDeploy({
      turbo: undefined,
      deployable: ["web"],
      targets: "export const DEPLOY_TARGETS = load();\n",
    });

    expect(found?.message).toContain("no DEPLOY_TARGETS array literal");
  });

  it("warns when the targets file does not parse", () => {
    const [found] = checkDeploy({
      turbo: undefined,
      deployable: ["web"],
      targets: "export const DEPLOY_TARGETS = [{\n",
    });

    expect(found?.message).toContain("could not be parsed");
  });
});

describe(readDeployState, () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "saasaloy-deploy-state-"));
  });

  afterEach(async () => {
    await rm(root, { force: true, recursive: true });
  });

  async function app(
    name: string,
    pkg: Record<string, unknown>,
    wrangler?: string
  ): Promise<void> {
    const dir = join(root, "apps", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "package.json"), JSON.stringify(pkg), "utf-8");
    if (wrangler) {
      await writeFile(join(dir, wrangler), "{}", "utf-8");
    }
  }

  it("counts an apps/ workspace with a name, a deploy script and a wrangler config", async () => {
    await app(
      "web",
      { name: "@repo/web", scripts: { deploy: "env-deploy web" } },
      "wrangler.jsonc"
    );
    await app(
      "api",
      { name: "@repo/api", scripts: { deploy: "env-deploy api" } },
      "wrangler.json"
    );
    await app("docs", { name: "@repo/docs", scripts: {} }, "wrangler.jsonc");
    await app("cli", { name: "@repo/cli", scripts: { deploy: "x" } });
    await writeFile(join(root, "turbo.json"), "{}", "utf-8");

    await expect(readDeployState(root)).resolves.toStrictEqual({
      turbo: "{}",
      deployable: ["api", "web"],
      targets: undefined,
      releaseWrapper: false,
      releaseScript: false,
    });
  });

  it("reads the targets file when the project has one", async () => {
    await mkdir(join(root, "packages", "tooling", "src"), { recursive: true });
    await writeFile(join(root, DEPLOY_TARGETS_FILE), TARGETS, "utf-8");

    await expect(readDeployState(root)).resolves.toStrictEqual({
      turbo: undefined,
      deployable: [],
      targets: TARGETS,
      releaseWrapper: false,
      releaseScript: false,
    });
  });

  it("reads whether the release wrapper and the root release script exist", async () => {
    await mkdir(join(root, "packages", "tooling", "src"), { recursive: true });
    await writeFile(join(root, RELEASE_WRAPPER), "", "utf-8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ scripts: { release: "node x" } }),
      "utf-8"
    );

    await expect(readDeployState(root)).resolves.toMatchObject({
      releaseWrapper: true,
      releaseScript: true,
    });
  });
});

// ---------------------------------------------------------------------------
// The `config` rule (#154): the env var `config.app.name` superseded.
// ---------------------------------------------------------------------------

describe(checkConfigValues, () => {
  it("passes a project that does not set it", () => {
    expect(
      checkConfigValues({
        envFiles: { "apps/api/.env": "BILLING_APP_URL=https://ledger.ly" },
      })
    ).toStrictEqual([]);
  });

  it("says nothing when it has nothing to read", () => {
    expect(checkConfigValues({})).toStrictEqual([]);
  });

  it("reports a set BILLING_APP_NAME, naming the file", () => {
    const [found] = checkConfigValues({
      envFiles: { "apps/api/.env": 'BILLING_APP_NAME="Acme"' },
    });
    expect(found?.module).toBe("billing");
    expect(found?.where).toBe("/env/BILLING_APP_NAME");
    expect(found?.message).toContain("apps/api/.env");
  });

  it("ignores a commented or empty assignment", () => {
    expect(
      checkConfigValues({
        envFiles: {
          "apps/api/.env": "# BILLING_APP_NAME=Acme\nBILLING_APP_NAME=\n",
        },
      })
    ).toStrictEqual([]);
  });

  it("reports the values file once, not each copy env:setup made of it", () => {
    const found = checkConfigValues({
      envFiles: {
        "packages/env/.env": "BILLING_APP_NAME=Acme",
        "apps/api/.env": "BILLING_APP_NAME=Acme",
      },
    });
    expect(found.map((f) => f.message.split(" ")[0])).toStrictEqual([
      "packages/env/.env",
    ]);
  });

  it("reports each service file, in path order, when the values file is clean", () => {
    const found = checkConfigValues({
      envFiles: {
        "packages/env/.env": "BILLING_APP_URL=x",
        "apps/web/.env": "BILLING_APP_NAME=Acme",
        "apps/api/.env": "BILLING_APP_NAME=Acme",
      },
    });
    expect(found.map((f) => f.message.split(" ")[0])).toStrictEqual([
      "apps/api/.env",
      "apps/web/.env",
    ]);
  });
});

describe(readConfigState, () => {
  it("reads the values file and every service .env", async () => {
    const root = await mkdtemp(join(tmpdir(), "saasaloy-config-state-"));
    try {
      await mkdir(join(root, "packages/env"), { recursive: true });
      await mkdir(join(root, "apps/api"), { recursive: true });
      await writeFile(join(root, "packages/env/.env"), "BILLING_APP_NAME=Acme");
      await writeFile(join(root, "apps/api/.env"), "BILLING_APP_URL=x");
      await writeFile(
        join(root, "apps/api/.dev.vars"),
        "BILLING_APP_NAME=Acme"
      );
      const state = await readConfigState(root);
      expect(Object.keys(state.envFiles ?? {}).toSorted()).toStrictEqual([
        "apps/api/.env",
        "packages/env/.env",
      ]);
      expect(checkConfigValues(state)).toHaveLength(1);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
