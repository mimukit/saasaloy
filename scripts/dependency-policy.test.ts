// Fixed-input tests for the version-selection policy (ADR 0016). No network: every case
// hands `evaluateDependency` a dep and a packument, then asserts the whole decision — the
// resolved versions, the status, and the candidates.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIONABLE,
  classifySpec,
  cmp,
  evaluateDependency,
  isUnorderableExact,
} from "./dependency-policy.ts";
import type { Packument, VersionSpec } from "./dependency-policy.ts";

/** A packument that lists the given versions. */
function packument(versions: string[]): Packument {
  return { versions: Object.fromEntries(versions.map((v) => [v, {}])) };
}

function dep(spec: string): VersionSpec {
  return { kind: classifySpec(spec), spec };
}

describe("version selection", () => {
  it("drops prereleases and ignores insertion order", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument(["1.2.0", "2.0.0-beta.1", "1.10.0", "1.9.0"])
    );
    assert.equal(e.resolved.target, "1.10.0");
    assert.equal(e.resolved.targetOverall, "1.10.0");
    assert.equal(e.resolved.newerMajor, false);
  });

  it("caps the primary target at the current major", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument(["1.0.0", "1.5.0", "2.0.0", "2.1.0"])
    );
    assert.equal(e.resolved.target, "1.5.0");
    assert.equal(e.resolved.targetOverall, "2.1.0");
    assert.equal(e.resolved.newerMajor, true);
    assert.equal(e.status, "outdated");
    assert.deepEqual(e.candidates, [
      { kind: "primary", target: "1.5.0" },
      { kind: "major", target: "2.1.0" },
    ]);
  });

  it("reports major-available with only a major candidate when the current major is current", () => {
    const e = evaluateDependency(dep("1.5.0"), packument(["1.5.0", "2.0.0"]));
    assert.equal(e.status, "major-available");
    assert.deepEqual(e.candidates, [{ kind: "major", target: "2.0.0" }]);
  });

  it("reports up-to-date with no candidates when nothing newer exists", () => {
    const e = evaluateDependency(dep("1.5.0"), packument(["1.0.0", "1.5.0"]));
    assert.equal(e.status, "up-to-date");
    assert.deepEqual(e.candidates, []);
  });

  it("pins the newest stable version with no release-age hold", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument(["1.0.0", "1.1.0", "1.2.0"])
    );
    assert.equal(e.resolved.target, "1.2.0");
    assert.equal(e.status, "outdated");
    assert.deepEqual(e.candidates, [{ kind: "primary", target: "1.2.0" }]);
  });

  it("reports unresolved when the registry has no stable versions at all", () => {
    const e = evaluateDependency(dep("1.0.0"), packument(["2.0.0-rc.1"]));
    assert.deepEqual(e.resolved, {
      newerMajor: false,
      target: null,
      targetOverall: null,
    });
    assert.equal(e.status, "unresolved");
    assert.deepEqual(e.candidates, []);
  });
});

describe("spec kinds", () => {
  it("migrates a range to the highest stable version within its major", () => {
    const e = evaluateDependency(
      dep("^1.2.0"),
      packument(["1.2.0", "1.4.0", "2.0.0"])
    );
    assert.equal(e.status, "range→exact");
    assert.deepEqual(e.candidates, [
      { kind: "primary", target: "1.4.0" },
      { kind: "major", target: "2.0.0" },
    ]);
  });

  it("pins a bare spec to the highest stable version across every major", () => {
    const e = evaluateDependency(
      dep(""),
      packument(["1.4.0", "2.0.0", "2.1.0"])
    );
    assert.equal(e.status, "bare→pinned");
    assert.equal(e.resolved.newerMajor, false);
    assert.deepEqual(e.candidates, [{ kind: "primary", target: "2.1.0" }]);
  });

  it("treats `latest` and `*` as bare", () => {
    assert.equal(classifySpec("latest"), "bare");
    assert.equal(classifySpec("*"), "bare");
    assert.equal(classifySpec("~1.2"), "range");
    assert.equal(classifySpec("1.2.3"), "exact");
    assert.equal(classifySpec("1.2.3-rc.1"), "exact");
  });

  it("reports an unorderable exact pin as unresolved and writes nothing, not even a major", () => {
    const spec = dep("1.3.0-rc.1");
    assert.equal(isUnorderableExact(spec), true);
    const e = evaluateDependency(spec, packument(["1.2.0", "1.3.0", "2.0.0"]));
    assert.equal(e.status, "unresolved");
    assert.equal(ACTIONABLE.has(e.status), false);
    assert.deepEqual(e.candidates, []);
  });
});

describe("cmp", () => {
  it("orders stable triples numerically, not lexically", () => {
    assert.ok(cmp("1.10.0", "1.9.0") > 0);
    assert.ok(cmp("2.0.0", "1.99.99") > 0);
    assert.equal(cmp("1.2.3", "1.2.3"), 0);
  });

  it("sorts an unparseable version below every stable one", () => {
    assert.ok(cmp("1.0.0", "9.9.9-rc.1") > 0);
    assert.equal(cmp("1.0.0-a", "9.0.0-b"), 0);
  });
});

describe("actionable statuses", () => {
  it("are exactly the three a default deps:update writes", () => {
    assert.deepEqual([...ACTIONABLE].toSorted(), [
      "bare→pinned",
      "outdated",
      "range→exact",
    ]);
  });
});
