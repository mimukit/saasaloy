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

  it("keeps the seed saasaloy.json and the owned key list once", () => {
    expect(
      classOf({ declaration, module: "base", path: "saasaloy.json" })
    ).toBe("once");
    expect(
      classOf({
        declaration,
        module: "base",
        path: "packages/env/.env.example",
      })
    ).toBe("once");
  });
});
