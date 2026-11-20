import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  insertIntoPluginArray,
  pluginArrayInsertRefusal,
} from "./ts-module.js";

// The real file `subscription` and `teams` patch, read off disk rather than restated here.
// The synthetic fixture below cannot catch an edit to `modules/auth` that hoists
// `plugins` to a named const or moves `auth` out of module scope, and #99 rewrote that
// file around this exact call.
const SHIPPED_AUTH = fileURLToPath(
  new URL("../../../../../modules/auth/files/src/auth.ts", import.meta.url)
);

// The handler table in `api`'s Worker entry, read off disk for the same reason: a
// `queue` provider patches this literal array, and a refactor that hoists `handlers`
// out of the `defineWorker` call would break every one of them.
const SHIPPED_WORKER = fileURLToPath(
  new URL("../../../../../modules/api/files/src/worker.ts", import.meta.url)
);

const AUTH = `import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [organization()],
});
`;

const STRIPE = {
  arrayProp: "plugins",
  call: "stripe",
  exportName: "auth",
  import: { from: "@better-auth/stripe", name: "stripe" },
} as const;

describe(insertIntoPluginArray, () => {
  it("pushes the call into the array and adds its named import", () => {
    const out = insertIntoPluginArray(AUTH, STRIPE);
    expect(out).toContain("stripe()");
    expect(out).toContain('from "@better-auth/stripe"');
    // Existing plugin and the surrounding call are preserved.
    expect(out).toContain("organization()");
    expect(out).toContain("betterAuth({");
  });

  it("is idempotent and formatting-safe: a second run equals the first byte-for-byte", () => {
    const once = insertIntoPluginArray(AUTH, STRIPE);
    const twice = insertIntoPluginArray(once, STRIPE);
    expect(twice).toBe(once);
  });

  it("leaves the source untouched when the call is already present", () => {
    const already = `import { stripe } from "@better-auth/stripe";
export const auth = betterAuth({ plugins: [stripe()] });
`;
    expect(insertIntoPluginArray(already, STRIPE)).toBe(already);
  });

  it("does not duplicate an import that already exists", () => {
    const out = insertIntoPluginArray(AUTH, STRIPE);
    const imports = out.match(/@better-auth\/stripe/g) ?? [];
    expect(imports).toHaveLength(1);
  });

  it("emits Prettier-compatible output: spaced import braces and a final newline", () => {
    // The scaffolded project runs `prettier --check .` as part of its own `pnpm lint`,
    // so recast's defaults (`{stripe}` and no trailing newline) would make every
    // `saasaloy add` leave the project failing its gate.
    const out = insertIntoPluginArray(AUTH, STRIPE);
    expect(out).toContain('import { stripe } from "@better-auth/stripe";');
    expect(out.endsWith("\n")).toBeTruthy();
  });

  it("creates the array when the target property is absent", () => {
    const noPlugins = `export const auth = betterAuth({
  database: db,
});
`;
    const out = insertIntoPluginArray(noPlugins, STRIPE);
    expect(out).toContain("plugins: [stripe()]");
    expect(out).toContain("database: db");
  });

  it("still finds the patch point in the shipped modules/auth `auth.ts`", async () => {
    const source = await readFile(SHIPPED_AUTH, "utf-8");
    const out = insertIntoPluginArray(source, STRIPE);

    expect(out).not.toBe(source);
    // The shipped array is multi-line, so assert on the appended element and on the
    // element that was already there rather than on one printed line. Pinning the whole
    // line made this test fail every time `modules/auth` changed an option.
    expect(out).toContain("adminRoles: [...ADMIN_ROLES]");
    expect(out).toContain("stripe()");
    expect(out).toContain('import { stripe } from "@better-auth/stripe";');
    // The module-scope export is what the codemod anchors on; a refactor that wraps it
    // in a factory would break every feature capability that patches it.
    expect(out).toContain("export const auth = betterAuth({");
  });

  it("finds the handler table in the shipped modules/api `worker.ts`", async () => {
    const source = await readFile(SHIPPED_WORKER, "utf-8");
    const patch = {
      arrayProp: "handlers",
      call: "cloudflareQueueHandlers",
      exportName: "worker",
      import: {
        from: "@repo/queue/providers/cloudflare",
        name: "cloudflareQueueHandlers",
      },
    };
    const out = insertIntoPluginArray(source, patch);

    expect(out).toContain("handlers: [cloudflareQueueHandlers()]");
    // The table is `api`'s registration point for every non-`fetch` export (ADR 0033),
    // so the anchor is part of its contract.
    expect(out).toContain("export const worker: ExportedHandler<never> =");
  });
});

describe(pluginArrayInsertRefusal, () => {
  it("names a missing export, which the forward direction leaves alone", () => {
    const missing = { ...STRIPE, exportName: "adminAuth" };

    expect(insertIntoPluginArray(AUTH, missing)).toBe(AUTH);
    expect(pluginArrayInsertRefusal(AUTH, missing)).toMatch(
      /export const adminAuth = <fn>\(\{ plugins: \[\.\.\.\] \}\)` is not in this file, so `stripe\(\)` was not added/
    );
  });

  it("has no objection when the export is there, added or already present", () => {
    expect(pluginArrayInsertRefusal(AUTH, STRIPE)).toBeUndefined();
    const added = insertIntoPluginArray(AUTH, STRIPE);
    expect(pluginArrayInsertRefusal(added, STRIPE)).toBeUndefined();
  });
});
