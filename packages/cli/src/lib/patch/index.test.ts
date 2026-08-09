import { describe, expect, it } from "vitest";
import { applyPatch } from "./index.js";
import type { Patch } from "./index.js";

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
  bindingType: "d1_databases",
  entry: { binding: "DB", database_id: "abc", database_name: "app-db" },
  kind: "wrangler-binding",
};

const DEPENDENCY_PATCH: Patch = {
  kind: "package-json-dependency",
  name: "@repo/db",
  range: "workspace:*",
  section: "dependencies",
};

const PLUGIN_PATCH: Patch = {
  arrayProp: "plugins",
  call: "stripe",
  exportName: "auth",
  import: { from: "@better-auth/stripe", name: "stripe" },
  kind: "plugin-array",
};

describe(applyPatch, () => {
  it("applies a wrangler-binding patch, reporting changed=true and a diff", () => {
    const result = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    expect(result.changed).toBeTruthy();
    expect(result.content).toContain("DB");
    expect(result.diff).toContain("wrangler.jsonc");
    expect(result.diff).toContain("+");
  });

  it("applies a package-json-dependency patch, reporting changed=true and a diff", () => {
    const result = applyPatch(
      API_PACKAGE_JSON,
      DEPENDENCY_PATCH,
      "package.json"
    );
    expect(result.changed).toBeTruthy();
    expect(result.content).toContain("@repo/db");
    expect(result.diff).toContain("package.json");
    expect(result.diff).toContain("+");
  });

  it("applies a plugin-array patch via magicast", () => {
    const result = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    expect(result.changed).toBeTruthy();
    expect(result.content).toContain("stripe()");
    expect(result.diff).toContain("auth.ts");
  });

  it("re-running any patch is a no-op: changed=false, empty diff, identical content", () => {
    const first = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    const again = applyPatch(first.content, BINDING_PATCH, "wrangler.jsonc");
    expect(again.changed).toBeFalsy();
    expect(again.diff).toBe("");
    expect(again.content).toBe(first.content);
  });

  it("re-running a plugin-array patch is likewise a clean no-op", () => {
    const first = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    const again = applyPatch(first.content, PLUGIN_PATCH, "auth.ts");
    expect(again.changed).toBeFalsy();
    expect(again.diff).toBe("");
  });

  it("re-running a package-json-dependency patch is likewise a clean no-op", () => {
    const first = applyPatch(
      API_PACKAGE_JSON,
      DEPENDENCY_PATCH,
      "package.json"
    );
    const again = applyPatch(first.content, DEPENDENCY_PATCH, "package.json");
    expect(again.changed).toBeFalsy();
    expect(again.diff).toBe("");
  });
});
