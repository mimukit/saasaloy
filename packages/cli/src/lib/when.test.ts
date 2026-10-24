import { describe, expect, it } from "vitest";
import { emptyManifest } from "./manifest.js";
import type { RegistryPatch, When } from "./schema.js";
import { isPatchTracked, sameWhen, whenHolds } from "./when.js";

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

// A new revision of an applied gated op is tracked by its slot: the container it writes
// into and the item it names, not only its file and kind (#242).
describe("isPatchTracked — revisions (#242)", () => {
  const plugin = (arrayProp: string, call: string): RegistryPatch => ({
    arrayProp,
    call,
    exportName: "auth",
    file: "packages/auth/src/auth.ts",
    import: { from: "./plugins", name: call },
    kind: "plugin-array",
    when: { testing: true },
  });

  function recorded(patch: RegistryPatch) {
    const manifest = emptyManifest();
    manifest.patches.push({
      file: patch.file,
      module: "auth",
      patch,
      when: { testing: true },
    });
    return manifest;
  }

  it("tracks a revision aimed at the same array", () => {
    const next = plugin("plugins", "testPluginV2()");

    expect(
      isPatchTracked(
        recorded(plugin("plugins", "testPlugin()")),
        "auth",
        next,
        [next]
      )
    ).toBeTruthy();
  });

  it("does not track an op aimed at another array of the same file", () => {
    const next = plugin("hooks", "testHook()");

    expect(
      isPatchTracked(
        recorded(plugin("plugins", "testPlugin()")),
        "auth",
        next,
        [next]
      )
    ).toBeFalsy();
  });

  it("falls back to the exact op when two ops share one array", () => {
    const ops = [plugin("plugins", "a()"), plugin("plugins", "b()")];

    expect(
      isPatchTracked(recorded(plugin("plugins", "old()")), "auth", ops[0]!, ops)
    ).toBeFalsy();
  });
});

describe(sameWhen, () => {
  it("ignores the order of the installed names", () => {
    expect(
      sameWhen({ installed: ["a", "b"] }, { installed: ["b", "a"] })
    ).toBeTruthy();
  });

  it("tells a testing condition from an empty one", () => {
    expect(sameWhen({ testing: true }, {})).toBeFalsy();
  });
});
