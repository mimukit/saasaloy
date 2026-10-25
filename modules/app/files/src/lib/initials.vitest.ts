// Tests for ./initials.ts. `add app` ships this file as `initials.test.ts` when the
// project's testing mode is on. In the saasaloy repo `pnpm test:modules` runs it in place
// on Vitest, and its import resolves by the project path, as it would in a project.

import { describe, expect, it } from "vitest";
import { initialsOf } from "./initials";

describe(initialsOf, () => {
  it("takes the first letter of the first two words", () => {
    expect(initialsOf("Ada Lovelace")).toBe("AL");
  });

  it("takes one letter from a single-word name", () => {
    expect(initialsOf("ada")).toBe("A");
  });

  it("stops at two letters however many words there are", () => {
    expect(initialsOf("Ada Byron King Lovelace")).toBe("AB");
  });

  it("collapses padding and runs of whitespace", () => {
    expect(initialsOf("  a   b  c ")).toBe("AB");
  });

  it("falls back to a question mark for an empty name", () => {
    expect(initialsOf("")).toBe("?");
    expect(initialsOf("   ")).toBe("?");
  });
});
