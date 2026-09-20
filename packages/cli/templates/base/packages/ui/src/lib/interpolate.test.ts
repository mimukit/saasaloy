import { describe, expect, test } from "vitest";

import { interpolate } from "./interpolate";

// The project's example unit test, and the pattern to copy.
//
// Four things it shows. A test file sits beside the source it covers, named
// `<source>.test.ts`. It imports `vitest` directly rather than relying on globals, so the
// import says where `test` and `expect` came from. Every case sits inside one `describe`,
// which the lint gate requires. And it covers a real exported function, so `pnpm test`
// reports a real result from the first run.
//
// The `describe` title is not the function's name: the linter reads a title that matches an
// imported binding as a copy of the import rather than a description. Say what the group is
// about instead.
//
// `pnpm test` collects every `*.test.ts` under `apps/*` and `packages/*`; see
// `vitest.config.ts` at the repo root. Delete this file once you have tests of your own.

describe("token interpolation", () => {
  test("replaces a token with its value", () => {
    expect(
      interpolate("Set up {siteName} in a minute.", { siteName: "Acme" })
    ).toBe("Set up Acme in a minute.");
  });

  test("leaves an unknown token exactly as written", () => {
    expect(interpolate("Your {plan} plan.", {})).toBe("Your {plan} plan.");
  });

  test("does not read through the prototype chain", () => {
    expect(interpolate("{constructor}", {})).toBe("{constructor}");
  });

  test("renders a number as its string form", () => {
    expect(interpolate("{count} seats", { count: 12 })).toBe("12 seats");
  });
});
