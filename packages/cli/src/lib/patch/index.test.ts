import { describe, expect, it } from "vitest";
import { applyPatch, isReversibleKind, reversePatch } from "./index.js";
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

describe(reversePatch, () => {
  it("undoes a chained-route patch, reporting changed=true and a diff", () => {
    const applied = applyPatch(API_ENTRY, ROUTE_PATCH, "index.ts");
    const reversed = reversePatch(applied.content, ROUTE_PATCH, "index.ts");
    expect(reversed?.changed).toBeTruthy();
    expect(reversed?.content).not.toContain("waitlist");
    expect(reversed?.diff).toContain("index.ts");
    expect(reversed?.diff).toContain("-");
  });

  it("reports changed=false when the patch is already reversed", () => {
    const reversed = reversePatch(API_ENTRY, ROUTE_PATCH, "index.ts");
    expect(reversed?.changed).toBeFalsy();
    expect(reversed?.diff).toBe("");
    expect(reversed?.content).toBe(API_ENTRY);
    // Already gone is not a refusal — the remover reports the two differently.
    expect(reversed?.reason).toBeUndefined();
  });

  it("reports a reason when the inverse refuses a route the user repointed", () => {
    const repointed = `import { Hono } from "hono";
import { myWaitlist } from "./mine.js";

const app = new Hono().route("/waitlist", myWaitlist);

export default app;
`;
    const reversed = reversePatch(repointed, ROUTE_PATCH, "index.ts");
    expect(reversed?.changed).toBeFalsy();
    expect(reversed?.content).toBe(repointed);
    expect(reversed?.reason).toContain("myWaitlist");
  });

  it("undoes a wrangler-binding patch, restoring the pre-patch content", () => {
    const applied = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    const reversed = reversePatch(
      applied.content,
      BINDING_PATCH,
      "wrangler.jsonc"
    );
    expect(reversed?.changed).toBeTruthy();
    expect(reversed?.content).not.toContain("app-db");
    expect(reversed?.diff).toContain("wrangler.jsonc");
    expect(reversed?.diff).toContain("-");
  });

  it("undoes a plugin-array patch, restoring the pre-patch content byte-for-byte", () => {
    const applied = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    const reversed = reversePatch(applied.content, PLUGIN_PATCH, "auth.ts");
    expect(reversed?.changed).toBeTruthy();
    // The whole point of the issue: what `add` wrote, `remove` takes back out exactly.
    expect(reversed?.content).toBe(AUTH);
    expect(reversed?.diff).toContain("auth.ts");
  });

  it("reports changed=false when a wrangler-binding is already reversed", () => {
    const reversed = reversePatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    expect(reversed?.changed).toBeFalsy();
    expect(reversed?.content).toBe(WRANGLER);
    expect(reversed?.reason).toBeUndefined();
  });

  it("reports changed=false when a plugin-array call is already reversed", () => {
    const reversed = reversePatch(AUTH, PLUGIN_PATCH, "auth.ts");
    expect(reversed?.changed).toBeFalsy();
    expect(reversed?.content).toBe(AUTH);
    expect(reversed?.reason).toBeUndefined();
  });

  it("reports a reason when the inverse refuses a binding the user edited", () => {
    const edited = `{
  "name": "api",
  "d1_databases": [
    { "binding": "DB", "database_name": "app-db", "database_id": "9f2c-real" }
  ]
}
`;
    const reversed = reversePatch(edited, BINDING_PATCH, "wrangler.jsonc");
    expect(reversed?.changed).toBeFalsy();
    expect(reversed?.content).toBe(edited);
    expect(reversed?.reason).toContain("d1_databases[binding=DB]");
  });

  it("reports a reason when the inverse refuses a plugin the user configured", () => {
    const configured = `import { betterAuth } from "better-auth";
import { stripe } from "@better-auth/stripe";

export const auth = betterAuth({
  plugins: [organization(), stripe({ apiKey: env.STRIPE_KEY })],
});
`;
    const reversed = reversePatch(configured, PLUGIN_PATCH, "auth.ts");
    expect(reversed?.changed).toBeFalsy();
    expect(reversed?.content).toBe(configured);
    expect(reversed?.reason).toContain("stripe");
  });

  it("returns undefined for the package.json kinds, which stay drop-and-warn", () => {
    // Uninstalling an npm dependency is not derivable offline and other code may use it
    // (plan-remove-command-2026-07-25.md, non-goals); no scope line asks for scripts.
    expect(
      reversePatch(API_PACKAGE_JSON, SCRIPT_PATCH, "package.json")
    ).toBeUndefined();
    expect(
      reversePatch(API_PACKAGE_JSON, DEPENDENCY_PATCH, "package.json")
    ).toBeUndefined();
  });

  it("isReversibleKind agrees with what reversePatch will undo", () => {
    expect(isReversibleKind("chained-route")).toBeTruthy();
    expect(isReversibleKind("const-array")).toBeTruthy();
    expect(isReversibleKind("plugin-array")).toBeTruthy();
    expect(isReversibleKind("wrangler-binding")).toBeTruthy();
    expect(isReversibleKind("package-json-script")).toBeFalsy();
    expect(isReversibleKind("package-json-dependency")).toBeFalsy();
  });

  it("reverses plugin-array and const-array patches", () => {
    const pluginApplied = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    expect(
      reversePatch(pluginApplied.content, PLUGIN_PATCH, "auth.ts")?.content
    ).toBe(AUTH);

    const navApplied = applyPatch(NAV, CONST_ARRAY_PATCH, "app-shell.tsx");
    expect(
      reversePatch(navApplied.content, CONST_ARRAY_PATCH, "app-shell.tsx")
        ?.content
    ).toBe(NAV);
  });
});

// `changed` alone can't tell "already applied" from "the user edited the value we
// wanted" — both are no-ops. `matched` separates them so `update` can report the
// second into the merge plan (issue #48, decision 1).
describe("applyPatch — matched", () => {
  it("reports no match when the patch actually applies", () => {
    expect(
      applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc").matched
    ).toBeUndefined();
  });

  it("reports no match when the entry is byte-identical (a true idempotent re-run)", () => {
    const first = applyPatch(WRANGLER, BINDING_PATCH, "wrangler.jsonc");
    expect(
      applyPatch(first.content, BINDING_PATCH, "wrangler.jsonc").matched
    ).toBeUndefined();
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
    expect(result.changed).toBeFalsy();
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
    expect(result.changed).toBeFalsy();
    expect(result.matched).toMatchObject({
      key: "dependencies[@repo/db]",
      current: "workspace:^",
      wanted: "workspace:*",
    });
  });

  it("reports nothing for a plugin-array patch — it has no identity key", () => {
    const first = applyPatch(AUTH, PLUGIN_PATCH, "auth.ts");
    expect(
      applyPatch(first.content, PLUGIN_PATCH, "auth.ts").matched
    ).toBeUndefined();
  });
});
