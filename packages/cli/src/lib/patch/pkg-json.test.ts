import { describe, expect, it } from "vitest";
import { upsertPackageJsonDependency } from "./pkg-json.js";

const PACKAGE_JSON = `{
  "name": "@repo/api",
  "dependencies": {
    "hono": "4.12.31"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
`;

describe("upsertPackageJsonDependency", () => {
  it("adds a new dependency to an existing section, keeping prior entries", () => {
    const out = upsertPackageJsonDependency(PACKAGE_JSON, {
      section: "dependencies",
      name: "@repo/db",
      range: "workspace:*",
    });
    expect(out).toContain("@repo/db");
    expect(out).toContain("workspace:*");
    expect(out).toContain("hono");
    const parsed = JSON.parse(out) as { dependencies: Record<string, string> };
    expect(parsed.dependencies).toEqual({ hono: "4.12.31", "@repo/db": "workspace:*" });
  });

  it("creates the section fresh when it doesn't exist yet", () => {
    const out = upsertPackageJsonDependency(PACKAGE_JSON, {
      section: "peerDependencies",
      name: "react",
      range: "^19",
    });
    const parsed = JSON.parse(out) as { peerDependencies: Record<string, string> };
    expect(parsed.peerDependencies).toEqual({ react: "^19" });
  });

  it("is idempotent: re-inserting an already-present dependency returns the source byte-for-byte", () => {
    const once = upsertPackageJsonDependency(PACKAGE_JSON, {
      section: "dependencies",
      name: "@repo/db",
      range: "workspace:*",
    });
    const twice = upsertPackageJsonDependency(once, {
      section: "dependencies",
      name: "@repo/db",
      range: "workspace:*",
    });
    expect(twice).toBe(once);
  });

  it("never clobbers: a dependency already present at a different range is left untouched", () => {
    const out = upsertPackageJsonDependency(PACKAGE_JSON, {
      section: "dependencies",
      name: "hono",
      range: "5.0.0",
    });
    expect(out).toBe(PACKAGE_JSON);
    expect(out).not.toContain("5.0.0");
  });

  it("preserves formatting (2-space indent) of the surrounding document", () => {
    const out = upsertPackageJsonDependency(PACKAGE_JSON, {
      section: "dependencies",
      name: "@repo/db",
      range: "workspace:*",
    });
    expect(out).toContain('  "dependencies"');
    expect(out).toContain('    "@repo/db"');
  });
});
