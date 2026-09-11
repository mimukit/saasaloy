import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { baseRecord } from "./base.js";
import {
  checkBase,
  checkModule,
  checkPartialInstalls,
  checkPolicyBindings,
  checkProject,
  checkTarget,
  KV_INDEX_FILE,
  readPolicyState,
  registryModuleNames,
  resolveDoctorTarget,
  WRANGLER_FILE,
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
