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

const SCRIPT_PATCH: Patch = {
  kind: "package-json-script",
  name: "db:generate",
  value: "drizzle-kit generate",
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

  it("applies a package-json-script patch, reporting changed=true and a diff", () => {
    const result = applyPatch(API_PACKAGE_JSON, SCRIPT_PATCH, "package.json");
    expect(result.changed).toBe(true);
    expect(result.content).toContain("db:generate");
    expect(result.content).toContain("drizzle-kit generate");
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

  it("re-running a package-json-script patch is likewise a clean no-op", () => {
    const first = applyPatch(API_PACKAGE_JSON, SCRIPT_PATCH, "package.json");
    const again = applyPatch(first.content, SCRIPT_PATCH, "package.json");
    expect(again.changed).toBe(false);
    expect(again.diff).toBe("");
    expect(again.content).toBe(first.content);
  });
});
