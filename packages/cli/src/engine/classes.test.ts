import { describe, expect, it } from "vitest";
import { classOf } from "./classes.js";

const declaration = {
  ownedFiles: ["packages/ui/src/blocks/**", "apps/web/public/favicon.*"],
  retiredSeedFiles: [],
  seedFiles: ["README.md", "saasaloy.json"],
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

  // Plan 0116, Phase 7: the tables moved to generated files, so the four owned files that
  // held one are `once` like any other owned file.
  it("writes the owned files that held a table once", () => {
    const owned = {
      ownedFiles: [
        "packages/env/src/services.ts",
        "packages/env/src/sources.ts",
        "packages/tooling/src/targets.ts",
        "packages/ui/src/blocks/**",
      ],
      retiredSeedFiles: [],
      seedFiles: [],
    };
    for (const path of [
      "packages/env/src/services.ts",
      "packages/env/src/sources.ts",
      "packages/tooling/src/targets.ts",
      "packages/ui/src/blocks/navbar.tsx",
    ]) {
      expect(classOf({ declaration: owned, module: "base", path })).toBe(
        "once"
      );
    }
  });

  // Re-grill Q2 to Q4: the declaration lists neither, so both are `merged` by the rule for
  // any other base file.
  it("reads saasaloy.json and the key list as merged once the declaration leaves them out", () => {
    const shipped = {
      ownedFiles: ["packages/ui/src/blocks/**"],
      retiredSeedFiles: [],
      seedFiles: ["README.md"],
    };
    for (const path of ["saasaloy.json", "packages/env/.env.example"]) {
      expect(classOf({ declaration: shipped, module: "base", path })).toBe(
        "merged"
      );
    }
    expect(
      classOf({ declaration, module: "base", path: "saasaloy.json" })
    ).toBe("once");
  });
});
