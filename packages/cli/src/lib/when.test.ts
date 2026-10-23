import { describe, expect, it } from "vitest";
import { emptyManifest } from "./manifest.js";
import type { RegistryPatch, When } from "./schema.js";
import { isPatchTracked, whenHolds } from "./when.js";

// #242 Phase 2: one predicate decides whether a gated descriptor entry ships. The keys
// combine with AND, `testing` asks for any mode but `off`, and every `installed` name
// has to be present.

const none = new Set<string>();

describe(whenHolds, () => {
  it("holds for an entry with no condition, in every mode", () => {
    expect(
      whenHolds(undefined, { installed: none, testingMode: "off" })
    ).toBeTruthy();
  });

  it("holds testing only when the mode is not off", () => {
    const when = { testing: true } as const;

    expect(
      whenHolds(when, { installed: none, testingMode: "off" })
    ).toBeFalsy();
    expect(
      whenHolds(when, { installed: none, testingMode: "tests-after" })
    ).toBeTruthy();
    expect(
      whenHolds(when, { installed: none, testingMode: "tdd" })
    ).toBeTruthy();
  });

  it("holds installed only when every name is present", () => {
    const when = { installed: ["e2e", "ci"] };

    expect(
      whenHolds(when, { installed: new Set(["e2e"]), testingMode: "tdd" })
    ).toBeFalsy();
    expect(
      whenHolds(when, {
        installed: new Set(["ci", "e2e"]),
        testingMode: "off",
      })
    ).toBeTruthy();
  });

  it("combines the two keys with AND", () => {
    const when: When = { installed: ["e2e"], testing: true };
    const installed = new Set(["e2e"]);

    expect(whenHolds(when, { installed, testingMode: "off" })).toBeFalsy();
    expect(
      whenHolds(when, { installed: none, testingMode: "tdd" })
    ).toBeFalsy();
    expect(whenHolds(when, { installed, testingMode: "tdd" })).toBeTruthy();
  });
});

describe(isPatchTracked, () => {
  const op: RegistryPatch = {
    file: "package.json",
    kind: "package-json-script",
    name: "db:check",
    value: "drizzle-kit check",
    when: { testing: true },
  };

  it("finds a structurally equal entry recorded by the same module", () => {
    const manifest = emptyManifest();
    manifest.patches.push({
      file: "package.json",
      module: "database",
      patch: { ...op },
      when: { testing: true },
    });

    expect(isPatchTracked(manifest, "database", op)).toBeTruthy();
    expect(isPatchTracked(manifest, "auth", op)).toBeFalsy();
  });

  it("does not match an entry with a different payload", () => {
    const manifest = emptyManifest();
    manifest.patches.push({
      file: "package.json",
      module: "database",
      patch: { ...op, value: "other" },
    });

    expect(isPatchTracked(manifest, "database", op)).toBeFalsy();
  });
});
