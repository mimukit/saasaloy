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

const CONST_ARRAY_PATCH: Patch = {
  kind: "const-array",
  constName: "NAV_ITEMS",
  key: "to",
  entry: { to: "/teams", label: "Teams" },
};

const NAV = `const NAV_ITEMS = [
  { to: "/", label: "Overview" },
] as const;
`;

const API_ENTRY = `import { Hono } from "hono";

const app = new Hono();

export default app;
`;

const ROUTE_PATCH: Patch = {
  kind: "chained-route",
  exportName: "default",
  path: "/waitlist",
  call: "waitlist",
  import: { name: "waitlist", from: "./routes/waitlist.js" },
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

  it("applies a package-json-script patch, reporting changed=true and a diff", () => {
    const result = applyPatch(API_PACKAGE_JSON, SCRIPT_PATCH, "package.json");
    expect(result.changed).toBeTruthy();
    expect(result.content).toContain("db:generate");
    expect(result.content).toContain("drizzle-kit generate");
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

  it("applies and idempotently re-runs a const-array patch", () => {
    const first = applyPatch(NAV, CONST_ARRAY_PATCH, "app-shell.tsx");
    expect(first.changed).toBeTruthy();
    expect(first.content).toContain('to: "/teams"');
    const again = applyPatch(first.content, CONST_ARRAY_PATCH, "app-shell.tsx");
    expect(again.changed).toBeFalsy();
    expect(again.content).toBe(first.content);
  });

  it("reports why a const-array target shape is absent", () => {
    const result = applyPatch(
      "const OTHER = [];\n",
      CONST_ARRAY_PATCH,
      "app-shell.tsx"
    );
    expect(result.changed).toBeFalsy();
    expect(result.reason).toContain("NAV_ITEMS");
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

  it("re-running a package-json-script patch is likewise a clean no-op", () => {
    const first = applyPatch(API_PACKAGE_JSON, SCRIPT_PATCH, "package.json");
    const again = applyPatch(first.content, SCRIPT_PATCH, "package.json");
    expect(again.changed).toBeFalsy();
    expect(again.diff).toBe("");
    expect(again.content).toBe(first.content);
  });

  it("applies a chained-route patch via magicast", () => {
    const result = applyPatch(API_ENTRY, ROUTE_PATCH, "index.ts");
    expect(result.changed).toBeTruthy();
    expect(result.content).toContain('.route("/waitlist", waitlist)');
    expect(result.diff).toContain("index.ts");
    expect(result.diff).toContain("+");
  });

  it("re-running a chained-route patch is likewise a clean no-op", () => {
    const first = applyPatch(API_ENTRY, ROUTE_PATCH, "index.ts");
    const again = applyPatch(first.content, ROUTE_PATCH, "index.ts");
    expect(again.changed).toBeFalsy();
    expect(again.diff).toBe("");
    expect(again.content).toBe(first.content);
    // An idempotent no-op is not a refusal, so there is nothing to report.
    expect(again.reason).toBeUndefined();
  });

  it("reports a reason when the codemod refuses instead of no-op'ing", () => {
    const conflicting = `import { Hono } from "hono";
import { waitlist } from "./legacy.js";

const app = new Hono();

export default app;
`;
    const result = applyPatch(conflicting, ROUTE_PATCH, "index.ts");
    expect(result.changed).toBeFalsy();
    expect(result.content).toBe(conflicting);
    expect(result.reason).toContain("./legacy.js");
  });

  it("carries no reason for the kinds that can only ever no-op", () => {
    const applied = applyPatch(API_PACKAGE_JSON, SCRIPT_PATCH, "package.json");
    expect(
      applyPatch(applied.content, SCRIPT_PATCH, "package.json").reason
    ).toBeUndefined();
    const bound = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    expect(
      applyPatch(bound.content, BINDING_PATCH, "wrangler.jsonc").reason
    ).toBeUndefined();
  });
});

// #242. A descriptor op may carry `when`, and the manifest keeps the op as authored, so
// the render sees it on apply. It may not read it as payload.
describe("an op carrying when (#242)", () => {
  const gate = { when: { testing: true } };

  it.each([
    ["wrangler-binding", WRANGLER, BINDING_PATCH, "wrangler.jsonc"],
    [
      "package-json-dependency",
      API_PACKAGE_JSON,
      DEPENDENCY_PATCH,
      "package.json",
    ],
    ["package-json-script", API_PACKAGE_JSON, SCRIPT_PATCH, "package.json"],
    ["plugin-array", AUTH, PLUGIN_PATCH, "auth.ts"],
    ["const-array", NAV, CONST_ARRAY_PATCH, "nav.ts"],
    ["chained-route", API_ENTRY, ROUTE_PATCH, "index.ts"],
  ] as const)(
    "applies %s as if when were absent",
    (_kind, source, patch, file) => {
      const withWhen = applyPatch(source, { ...patch, ...gate }, file);

      expect(withWhen.content).toBe(applyPatch(source, patch, file).content);
      expect(withWhen.changed).toBeTruthy();
    }
  );
});
