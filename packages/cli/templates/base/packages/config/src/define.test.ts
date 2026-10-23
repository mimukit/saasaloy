import { describe, expect, it } from "vitest";
import { defineConfig, defineSection, defineSections } from "./define";

// The merge rules `@repo/config` has to keep, and the two it has to refuse (#154).
//
// It runs on Vitest. In a scaffolded project the root `vitest.config.ts` collects it as the
// `packages/config` project; in the saasaloy repo `pnpm test:tooling` runs it from the
// template, and `pnpm test:base` (which is `node --test`) skips this package.

const app = () =>
  defineSection("app", {
    name: "Acme",
    locale: "en",
    legal: { termsPath: "/terms", privacyPath: "/privacy" },
    tags: ["one", "two"],
  });

const tiers = () => defineSection("tiers", { free: { id: "free" } });

describe(defineConfig, () => {
  it("composes one property per section key", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app(), tiers()] }),
    });
    expect(config.app.name).toBe("Acme");
    expect(config.tiers).toStrictEqual({ free: { id: "free" } });
  });

  it("an override replaces a leaf and keeps its siblings", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app()] }),
      overrides: { app: { name: "Ledgerly" } },
    });
    expect(config.app.name).toBe("Ledgerly");
    expect(config.app.locale).toBe("en");
  });

  it("an override replaces a nested record whole", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app()] }),
      overrides: {
        app: { legal: { termsPath: "/legal", privacyPath: "/legal/privacy" } },
      },
    });
    expect(config.app.legal).toStrictEqual({
      termsPath: "/legal",
      privacyPath: "/legal/privacy",
    });
  });

  it("an override replaces an array whole", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app()] }),
      overrides: { app: { tags: ["three"] } },
    });
    expect(config.app.tags).toStrictEqual(["three"]);
  });

  it("an explicit undefined keeps the seeded value", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app()] }),
      overrides: { app: { name: undefined } },
    });
    expect(config.app.name).toBe("Acme");
  });

  it("the result and every section are frozen", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app()] }),
    });
    expect(Object.isFrozen(config)).toBeTruthy();
    expect(Object.isFrozen(config.app)).toBeTruthy();
    expect(() => {
      (config.app as { name: string }).name = "nope";
    }).toThrow(TypeError);
  });

  it("freezes nested records and arrays too", () => {
    const config = defineConfig({
      sections: defineSections({ sections: [app()] }),
    });
    expect(Object.isFrozen(config.app.legal)).toBeTruthy();
    expect(Object.isFrozen(config.app.tags)).toBeTruthy();
    expect(() => {
      (config.app.legal as { termsPath: string }).termsPath = "/nope";
    }).toThrow(TypeError);
  });

  it("shares no object with the declared section or the overrides", () => {
    const section = app();
    const legal = { termsPath: "/legal", privacyPath: "/legal/privacy" };
    const config = defineConfig({
      sections: defineSections({ sections: [section] }),
      overrides: { app: { legal } },
    });
    expect(config.app.legal).not.toBe(legal);
    expect(config.app.tags).not.toBe(section.values.tags);
    expect(Object.isFrozen(section.values.legal)).toBeFalsy();
    expect(Object.isFrozen(legal)).toBeFalsy();
    legal.termsPath = "/changed";
    expect(config.app.legal.termsPath).toBe("/legal");
  });

  it("a section never mutates the values it was declared with", () => {
    const section = app();
    defineConfig({
      sections: defineSections({ sections: [section] }),
      overrides: { app: { name: "Ledgerly" } },
    });
    expect(section.values.name).toBe("Acme");
  });

  it("two sections claiming one key throw, naming the key", () => {
    expect(() =>
      defineConfig({
        sections: defineSections({
          sections: [app(), defineSection("app", { name: "Other" })],
        }),
      })
    ).toThrow(/claim the key "app"/);
  });

  it("an override of a section nothing defines throws", () => {
    expect(() =>
      defineConfig({
        sections: defineSections({ sections: [app()] }),
        // Only reachable by hand-editing: `ProjectOverride` rejects this at typecheck, so
        // the cast is the only way to reach the runtime guard.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        overrides: { billing: { appName: "Acme" } } as never,
      })
    ).toThrow(/overrides the section "billing"/);
  });
});
