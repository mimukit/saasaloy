import { describe, expect, it } from "vitest";
import { applyPatch, type Patch } from "./index.js";

const WRANGLER = `{
  "name": "api",
  "d1_databases": []
}
`;

const API_PACKAGE_JSON = `{
  "name": "@repo/api",
  "dependencies": {}
}
`;

const AUTH = `import { betterAuth } from "better-auth";

export const auth = betterAuth({
  plugins: [organization()],
});
`;

const BINDING_PATCH: Patch = {
  kind: "wrangler-binding",
  bindingType: "d1_databases",
  entry: { binding: "DB", database_name: "app-db", database_id: "abc" },
};

const DEPENDENCY_PATCH: Patch = {
  kind: "package-json-dependency",
  section: "dependencies",
  name: "@repo/db",
  range: "workspace:*",
};

const PLUGIN_PATCH: Patch = {
  kind: "plugin-array",
  exportName: "auth",
  arrayProp: "plugins",
  call: "stripe",
  import: { name: "stripe", from: "@better-auth/stripe" },
};

describe("applyPatch", () => {
  it("applies a wrangler-binding patch, reporting changed=true and a diff", () => {
    const result = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("DB");
    expect(result.diff).toContain("wrangler.jsonc");
    expect(result.diff).toContain("+");
  });

  it("applies a package-json-dependency patch, reporting changed=true and a diff", () => {
    const result = applyPatch(API_PACKAGE_JSON, DEPENDENCY_PATCH, "package.json");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("@repo/db");
    expect(result.diff).toContain("package.json");
    expect(result.diff).toContain("+");
  });

  it("applies a plugin-array patch via magicast", () => {
    const result = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("stripe()");
    expect(result.diff).toContain("auth.ts");
  });

  it("re-running any patch is a no-op: changed=false, empty diff, identical content", () => {
    const first = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    const again = applyPatch(first.content, BINDING_PATCH, "wrangler.jsonc");
    expect(again.changed).toBe(false);
    expect(again.diff).toBe("");
    expect(again.content).toBe(first.content);
  });

  it("re-running a plugin-array patch is likewise a clean no-op", () => {
    const first = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    const again = applyPatch(first.content, PLUGIN_PATCH, "auth.ts");
    expect(again.changed).toBe(false);
    expect(again.diff).toBe("");
  });

  it("re-running a package-json-dependency patch is likewise a clean no-op", () => {
    const first = applyPatch(API_PACKAGE_JSON, DEPENDENCY_PATCH, "package.json");
    const again = applyPatch(first.content, DEPENDENCY_PATCH, "package.json");
    expect(again.changed).toBe(false);
    expect(again.diff).toBe("");
  });
});

// `changed` alone can't tell "already applied" from "the user edited the value we
// wanted" — both are no-ops. `matched` separates them so `update` can report the
// second into the merge plan (issue #48, decision 1).
describe("applyPatch — matched", () => {
  it("reports no match when the patch actually applies", () => {
    expect(applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc").matched).toBeUndefined();
  });

  it("reports no match when the entry is byte-identical (a true idempotent re-run)", () => {
    const first = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    expect(applyPatch(first.content, BINDING_PATCH, "wrangler.jsonc").matched).toBeUndefined();
  });

  it("reports a wrangler-binding whose matchOn key holds an edited entry", () => {
    // The live case: `database` ships `database_id: "local"` and every real user edits it.
    const edited = `{
  "name": "api",
  "d1_databases": [
    { "binding": "DB", "database_name": "app-db", "database_id": "9f2c-real-id" }
  ]
}
`;
    const result = applyPatch(edited, BINDING_PATCH, "wrangler.jsonc");
    expect(result.changed).toBe(false);
    expect(result.matched).toMatchObject({
      key: "d1_databases[binding=DB]",
      current: { binding: "DB", database_id: "9f2c-real-id" },
      wanted: { binding: "DB", database_id: "abc" },
    });
  });

  it("reports a package-json-dependency already present at a different range", () => {
    const edited = `{
  "name": "@repo/api",
  "dependencies": { "@repo/db": "workspace:^" }
}
`;
    const result = applyPatch(edited, DEPENDENCY_PATCH, "package.json");
    expect(result.changed).toBe(false);
    expect(result.matched).toMatchObject({
      key: "dependencies[@repo/db]",
      current: "workspace:^",
      wanted: "workspace:*",
    });
  });

  it("reports nothing for a plugin-array patch — it has no identity key", () => {
    const first = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    expect(applyPatch(first.content, PLUGIN_PATCH, "auth.ts").matched).toBeUndefined();
  });
});
