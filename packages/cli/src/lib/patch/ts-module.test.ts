import { describe, expect, it } from "vitest";
import { insertIntoPluginArray } from "./ts-module.js";

const AUTH = `import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [organization()],
});
`;

const STRIPE = {
  exportName: "auth",
  arrayProp: "plugins",
  call: "stripe",
  import: { name: "stripe", from: "@better-auth/stripe" },
} as const;

describe("insertIntoPluginArray", () => {
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

  it("creates the array when the target property is absent", () => {
    const noPlugins = `export const auth = betterAuth({
  database: db,
});
`;
    const out = insertIntoPluginArray(noPlugins, STRIPE);
    expect(out).toContain("plugins: [stripe()]");
    expect(out).toContain("database: db");
  });
});
