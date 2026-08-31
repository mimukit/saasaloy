import { describe, expect, it } from "vitest";
import {
  insertIntoPluginArray,
  pluginArrayRemoveRefusal,
  removeFromPluginArray,
} from "./ts-module.js";

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
});

const NO_PLUGINS = `import { betterAuth } from "better-auth";

export const auth = betterAuth({
  database: db,
});
`;

describe(removeFromPluginArray, () => {
  it("round-trips: insert then remove restores the source byte-for-byte", () => {
    const patched = insertIntoPluginArray(AUTH, STRIPE);
    expect(patched).not.toBe(AUTH);
    expect(removeFromPluginArray(patched, STRIPE)).toBe(AUTH);
  });

  it("round-trips the shipping case: the emptied array stays an empty array", () => {
    // Every capability that owns a plugin-array target ships the property already there
    // and empty (`defineEmail({ providers: [] })`), with a comment saying never to omit
    // it — the forward codemod has nothing to push into otherwise. So emptying it is the
    // pre-patch state, and deleting it would be a file the capability never shipped.
    const empty = `import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";

export const auth = betterAuth({
  plugins: [],
});
`;
    const patched = insertIntoPluginArray(empty, STRIPE);
    expect(patched).toContain("stripe()");
    expect(removeFromPluginArray(patched, STRIPE)).toBe(empty);
  });

  it("leaves behind an array the insert created, since it cannot tell it created it", () => {
    // No module ships this shape, and the manifest records no pre-patch state to tell it
    // apart from the case above. An empty array literal is the harmless side of the guess.
    const patched = insertIntoPluginArray(NO_PLUGINS, STRIPE);
    expect(patched).toContain("plugins: [stripe()]");
    expect(removeFromPluginArray(patched, STRIPE)).toContain("plugins: []");
  });

  it("keeps a sibling plugin it did not add", () => {
    const out = removeFromPluginArray(insertIntoPluginArray(AUTH, STRIPE), {
      ...STRIPE,
    });
    expect(out).toContain("organization()");
    expect(out).not.toContain("stripe");
  });

  it("is idempotent: removing a call that is already gone returns the source", () => {
    expect(removeFromPluginArray(AUTH, STRIPE)).toBe(AUTH);
    const once = removeFromPluginArray(
      insertIntoPluginArray(AUTH, STRIPE),
      STRIPE
    );
    expect(removeFromPluginArray(once, STRIPE)).toBe(once);
  });

  it("never reverse-patches a call the user gave arguments", () => {
    const edited = `import { betterAuth } from "better-auth";
import { stripe } from "@better-auth/stripe";

export const auth = betterAuth({
  plugins: [stripe({ apiKey: env.STRIPE_KEY })],
});
`;
    expect(removeFromPluginArray(edited, STRIPE)).toBe(edited);
  });

  it("never reverse-patches when the local name now binds a different import", () => {
    const repointed = `import { betterAuth } from "better-auth";
import { stripe } from "./my-stripe.js";

export const auth = betterAuth({
  plugins: [stripe()],
});
`;
    expect(removeFromPluginArray(repointed, STRIPE)).toBe(repointed);
  });

  it("keeps the import when the file still references the name elsewhere", () => {
    const alsoUsed = `import { betterAuth } from "better-auth";
import { stripe } from "@better-auth/stripe";

export const plans = stripe.plans;

export const auth = betterAuth({
  plugins: [stripe()],
});
`;
    const out = removeFromPluginArray(alsoUsed, STRIPE);
    expect(out).toContain('import { stripe } from "@better-auth/stripe";');
    expect(out).toContain("export const plans = stripe.plans;");
    expect(out).not.toContain("stripe()");
  });

  it("leaves an unrecognised export shape alone", () => {
    const other = `export const notAuth = 1;\n`;
    expect(removeFromPluginArray(other, STRIPE)).toBe(other);
  });

  it("emits Prettier-compatible output: keeps the file's final newline", () => {
    const out = removeFromPluginArray(
      insertIntoPluginArray(AUTH, STRIPE),
      STRIPE
    );
    expect(out.endsWith("\n")).toBeTruthy();
  });
});

describe(pluginArrayRemoveRefusal, () => {
  it("reports a call the user gave arguments", () => {
    const edited = `import { stripe } from "@better-auth/stripe";
export const auth = betterAuth({ plugins: [stripe({ apiKey: k })] });
`;
    expect(pluginArrayRemoveRefusal(edited, STRIPE)).toContain("stripe");
  });

  it("reports a local name repointed at a different import", () => {
    const repointed = `import { stripe } from "./my-stripe.js";
export const auth = betterAuth({ plugins: [stripe()] });
`;
    expect(pluginArrayRemoveRefusal(repointed, STRIPE)).toContain(
      "./my-stripe.js"
    );
  });

  it("says nothing when the call is already gone — that is not a refusal", () => {
    expect(pluginArrayRemoveRefusal(AUTH, STRIPE)).toBeUndefined();
  });

  it("says nothing when the call on disk is the one that was applied", () => {
    expect(
      pluginArrayRemoveRefusal(insertIntoPluginArray(AUTH, STRIPE), STRIPE)
    ).toBeUndefined();
  });
});
