import { describe, expect, it } from "vitest";
import { uiBlockFiles, uiBlocksPrefix } from "./ui-blocks.js";

// The `@ui/blocks/` target prefix is the whole signal that a module ships UI a human has
// to place. It is checked against the *resolved* target, so the project's own alias map
// decides where that folder is.

describe("the ui blocks prefix", () => {
  it("resolves the blocks folder through the project's @ui alias", () => {
    expect(uiBlocksPrefix({ "@ui": "packages/design/src" })).toBe(
      "packages/design/src/blocks/"
    );
  });

  it("falls back to the base layout when the project registers no @ui alias", () => {
    expect(uiBlocksPrefix({ "@web": "apps/web/src" })).toBe(
      "packages/ui/src/blocks/"
    );
  });
});

describe("picking the ui blocks out of a plan", () => {
  const aliases = { "@ui": "packages/ui/src", "@web": "apps/web/src" };

  it("keeps only the files that land in the blocks folder", () => {
    const files = [
      { target: "packages/ui/src/blocks/waitlist.tsx" },
      { target: "packages/ui/src/types/waitlist-env.d.ts" },
      { target: "apps/web/src/pages/index.astro" },
    ];

    expect(uiBlockFiles(files, aliases)).toStrictEqual([
      { target: "packages/ui/src/blocks/waitlist.tsx" },
    ]);
  });

  it("does not match a sibling folder that merely starts the same way", () => {
    const files = [{ target: "packages/ui/src/blocks-legacy/waitlist.tsx" }];

    expect(uiBlockFiles(files, aliases)).toStrictEqual([]);
  });

  it("carries the caller's own file shape through", () => {
    const files = [
      { target: "packages/ui/src/blocks/waitlist.tsx", module: "waitlist" },
    ];

    expect(uiBlockFiles(files, aliases)[0]?.module).toBe("waitlist");
  });
});
