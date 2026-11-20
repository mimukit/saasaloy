import { describe, expect, it } from "vitest";
import { classOf } from "./classes.js";

const declaration = {
  ownedFiles: ["packages/ui/src/blocks/**", "apps/web/public/favicon.*"],
  retiredSeedFiles: [],
  seedFiles: ["README.md", "saasaloy.json", "packages/env/.env.example"],
};

describe(classOf, () => {
  it("maps the base's seedFiles and ownedFiles to once", () => {
    expect(classOf({ declaration, module: "base", path: "README.md" })).toBe(
      "once"
    );
    expect(
      classOf({
        declaration,
        module: "base",
        path: "packages/ui/src/blocks/nav/navbar.tsx",
      })
    ).toBe("once");
    expect(
      classOf({
        declaration,
        module: "base",
        path: "apps/web/public/favicon.svg",
      })
    ).toBe("once");
  });

  it("merges every other base file", () => {
    expect(classOf({ declaration, module: "base", path: "turbo.json" })).toBe(
      "merged"
    );
  });

  it("maps a module's seed flag to once, and merges its other files", () => {
    expect(
      classOf({
        declaration,
        entry: { seed: true },
        module: "auth",
        path: "packages/auth/src/plugins.ts",
      })
    ).toBe("once");
    expect(
      classOf({
        declaration,
        entry: {},
        module: "auth",
        path: "packages/auth/src/auth.ts",
      })
    ).toBe("merged");
  });

  it("leaves a module file under an owned glob to the module", () => {
    expect(
      classOf({
        declaration,
        module: "waitlist",
        path: "packages/ui/src/blocks/waitlist.tsx",
      })
    ).toBe("merged");
  });

  it("merges saasaloy.json, the key list and the owned table files (re-grill Q1 to Q3)", () => {
    const owned = {
      ownedFiles: [
        "packages/env/.env.example",
        "packages/env/src/services.ts",
        "packages/env/src/sources.ts",
        "packages/tooling/src/targets.ts",
        "packages/ui/src/blocks/**",
      ],
      retiredSeedFiles: [],
      seedFiles: ["saasaloy.json"],
    };
    for (const path of [
      "saasaloy.json",
      "packages/env/.env.example",
      "packages/env/src/services.ts",
      "packages/env/src/sources.ts",
      "packages/tooling/src/targets.ts",
      "packages/ui/src/blocks/navbar.tsx",
    ]) {
      expect(classOf({ declaration: owned, module: "base", path })).toBe(
        "merged"
      );
    }
    expect(
      classOf({
        declaration: owned,
        module: "base",
        path: "packages/ui/src/blocks/hero.tsx",
      })
    ).toBe("once");
  });
});
