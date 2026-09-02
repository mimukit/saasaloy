import { describe, expect, it } from "vitest";
import {
  compareVersions,
  isValidRange,
  parseVersion,
  satisfies,
} from "./semver.js";

/** `compareVersions` over two version strings, for the ordering table below. */
const cmp = (a: string, b: string): number =>
  compareVersions(parseVersion(a)!, parseVersion(b)!);

describe(parseVersion, () => {
  it("reads major, minor, patch", () => {
    expect(parseVersion("1.2.3")).toStrictEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: [],
    });
  });

  it("reads a prerelease as dot-separated identifiers, numeric where numeric", () => {
    expect(parseVersion("1.2.3-beta.11")).toStrictEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ["beta", 11],
    });
  });

  it("ignores build metadata", () => {
    expect(parseVersion("1.2.3+build.7")?.patch).toBe(3);
  });

  it("accepts a leading v", () => {
    expect(parseVersion("v0.4.0")?.minor).toBe(4);
  });

  it.each(["1.2", "1", "", "x.y.z", "1.2.3.4", "01.2.3"])(
    "rejects the partial or malformed version %j",
    (bad) => {
      expect(parseVersion(bad)).toBeUndefined();
    }
  );
});

describe(compareVersions, () => {
  it("orders by major, then minor, then patch", () => {
    expect(cmp("1.0.0", "2.0.0")).toBeLessThan(0);
    expect(cmp("1.2.0", "1.1.9")).toBeGreaterThan(0);
    expect(cmp("1.1.1", "1.1.1")).toBe(0);
  });

  it("orders a prerelease below its release", () => {
    expect(cmp("1.0.0-alpha", "1.0.0")).toBeLessThan(0);
    expect(cmp("1.0.0", "1.0.0-alpha")).toBeGreaterThan(0);
  });

  it("orders prerelease identifiers by the semver rules", () => {
    expect(cmp("1.0.0-alpha", "1.0.0-alpha.1")).toBeLessThan(0);
    expect(cmp("1.0.0-alpha.1", "1.0.0-alpha.beta")).toBeLessThan(0);
    expect(cmp("1.0.0-beta.2", "1.0.0-beta.11")).toBeLessThan(0);
    expect(cmp("1.0.0-rc.1", "1.0.0")).toBeLessThan(0);
  });
});

describe(isValidRange, () => {
  it.each([
    "*",
    "",
    "x",
    "1.x",
    "1.2.x",
    "0.3",
    "1.2.3",
    "=1.2.3",
    ">=0.3",
    ">=0.3 <2",
    "^1.2.0",
    "~1.2",
    ">0.1.0",
    "<=2.0.0",
    "1.2.3 - 2.3.4",
    ">=1 <2 || >=3",
    "  >=0.3  ",
  ])("accepts %j, a shape a descriptor may use", (range) => {
    expect(isValidRange(range)).toBeTruthy();
  });

  it.each([">=abc", "1.2.3.4", ">==1.0.0", "^", "1.2.3 -", "||"])(
    "rejects %j, which it cannot parse",
    (range) => {
      expect(isValidRange(range)).toBeFalsy();
    }
  );
});

const SATISFIES_CASES: [string, string, boolean][] = [
  ["0.3.0", ">=0.3", true],
  ["0.2.9", ">=0.3", false],
  ["0.0.0", ">=0.3", false],
  ["1.9.0", ">=0.3 <2", true],
  ["2.0.0", ">=0.3 <2", false],
  ["1.2.0", "^1.2.0", true],
  ["1.9.9", "^1.2.0", true],
  ["2.0.0", "^1.2.0", false],
  ["1.1.9", "^1.2.0", false],
  ["0.2.5", "^0.2.3", true],
  ["0.3.0", "^0.2.3", false],
  ["1.4.0", "1.x", true],
  ["2.0.0", "1.x", false],
  ["1.2.9", "~1.2", true],
  ["1.3.0", "~1.2", false],
  ["1.2.3", "1.2.3", true],
  ["1.2.4", "=1.2.3", false],
  ["5.0.0", "*", true],
  ["5.0.0", "", true],
  ["2.0.0", "1.2.3 - 2.3.4", true],
  ["2.4.0", "1.2.3 - 2.3.4", false],
  ["3.1.0", ">=1 <2 || >=3", true],
  ["2.5.0", ">=1 <2 || >=3", false],
];

describe(satisfies, () => {
  it.each(SATISFIES_CASES)(
    "%j against %j is %j",
    (version, range, expected) => {
      expect(satisfies(version, range)).toBe(expected);
    }
  );

  it("is false for a version it cannot parse", () => {
    expect(satisfies("unknown", "*")).toBeFalsy();
  });

  it("is false for a range it cannot parse", () => {
    expect(satisfies("1.0.0", ">=nope")).toBeFalsy();
  });

  it("admits a prerelease only inside the comparator's own version tuple", () => {
    expect(satisfies("1.2.3-beta.1", ">=1.2.3-alpha <2")).toBeTruthy();
    expect(satisfies("2.0.0-beta.1", ">=1.2.3-alpha <3")).toBeFalsy();
    expect(satisfies("1.0.0-rc.1", "*")).toBeFalsy();
  });
});
