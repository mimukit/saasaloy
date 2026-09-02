import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  checkModule,
  checkProject,
  checkTarget,
  registryModuleNames,
  resolveDoctorTarget,
} from "./doctor.js";
import type { ModuleReport } from "./doctor.js";
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
