// Fixed-input tests for the version-selection policy (ADR 0016). No network, no clock:
// every case hands `evaluateDependency` a packument, a `nowMs`, and the flags, then
// asserts the whole decision — the resolved versions, the status, and the candidates.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIONABLE,
  classifySpec,
  cmp,
  evaluateDependency,
  isUnorderableExact,
} from "./dependency-policy.ts";
import type {
  Packument,
  PolicyOptions,
  VersionSpec,
} from "./dependency-policy.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MIN = 3 * 24 * 60;
const NOW = Date.parse("2026-09-07T00:00:00Z");

const defaults: PolicyOptions = {
  allowFresh: false,
  minimumReleaseAgeMinutes: THREE_DAYS_MIN,
  nowMs: NOW,
};

/** A packument from `version → days before NOW`; a null age omits the publish time. */
function packument(ages: Record<string, number | null>): Packument {
  const time: Record<string, string> = {};
  const versions: Record<string, unknown> = {};
  for (const [v, days] of Object.entries(ages)) {
    versions[v] = {};
    if (days !== null) {
      time[v] = new Date(NOW - days * DAY_MS).toISOString();
    }
  }
  return { time, versions };
}

function dep(spec: string): VersionSpec {
  return { kind: classifySpec(spec), spec };
}

describe("cooldown", () => {
  it("skips a version published inside the cooldown and pins the last one outside it", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.1.0": 10, "1.2.0": 1 }),
      defaults
    );
    assert.equal(e.resolved.target, "1.1.0");
    assert.equal(e.resolved.highestWithinMajor, "1.2.0");
    assert.equal(e.status, "outdated");
    assert.deepEqual(e.candidates, [{ kind: "primary", target: "1.1.0" }]);
  });

  it("treats a publish exactly at the boundary as eligible", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.1.0": 3 }),
      defaults
    );
    assert.equal(e.resolved.target, "1.1.0");
    assert.equal(e.status, "outdated");
  });

  it("treats a publish one millisecond inside the boundary as too fresh", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.1.0": 3 }),
      { ...defaults, nowMs: NOW - 1 }
    );
    assert.equal(e.resolved.target, "1.0.0");
    assert.equal(e.status, "within-cooldown");
    assert.deepEqual(e.candidates, []);
  });

  it("reports within-cooldown with no candidate when every version is too fresh", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 1, "1.1.0": 0 }),
      defaults
    );
    assert.equal(e.resolved.target, null);
    assert.equal(e.status, "within-cooldown");
    assert.deepEqual(e.candidates, []);
  });

  it("never clears a version with no publish time", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.1.0": null }),
      defaults
    );
    assert.equal(e.resolved.target, "1.0.0");
    assert.equal(e.status, "within-cooldown");
  });

  it("never clears a version whose publish time does not parse", () => {
    const doc = packument({ "1.0.0": 30, "1.1.0": 30 });
    doc.time["1.1.0"] = "not a date";
    const e = evaluateDependency(dep("1.0.0"), doc, defaults);
    assert.equal(e.resolved.target, "1.0.0");
    assert.equal(e.status, "within-cooldown");
  });

  it("allowFresh lifts the cooldown, including for a version with no publish time", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.1.0": 0, "1.2.0": null }),
      { ...defaults, allowFresh: true }
    );
    assert.equal(e.resolved.target, "1.2.0");
    assert.deepEqual(e.candidates, [{ kind: "primary", target: "1.2.0" }]);
  });

  it("a zero cooldown makes every dated version eligible", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.1.0": 0 }),
      { ...defaults, minimumReleaseAgeMinutes: 0 }
    );
    assert.equal(e.resolved.target, "1.1.0");
  });
});

describe("version selection", () => {
  it("drops prereleases and ignores insertion order", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.2.0": 30, "2.0.0-beta.1": 30, "1.10.0": 30, "1.9.0": 30 }),
      defaults
    );
    assert.equal(e.resolved.target, "1.10.0");
    assert.equal(e.resolved.highestOverall, "1.10.0");
    assert.equal(e.resolved.newerMajor, false);
  });

  it("caps the primary target at the current major", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "1.0.0": 30, "1.5.0": 30, "2.0.0": 30, "2.1.0": 30 }),
      defaults
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
    const e = evaluateDependency(
      dep("1.5.0"),
      packument({ "1.5.0": 30, "2.0.0": 30 }),
      defaults
    );
    assert.equal(e.status, "major-available");
    assert.deepEqual(e.candidates, [{ kind: "major", target: "2.0.0" }]);
  });

  it("offers no major candidate while the only newer major is inside the cooldown", () => {
    const e = evaluateDependency(
      dep("1.5.0"),
      packument({ "1.5.0": 30, "2.0.0": 1 }),
      defaults
    );
    assert.equal(e.resolved.newerMajor, true);
    assert.equal(e.resolved.targetOverall, "1.5.0");
    assert.equal(e.status, "major-available");
    assert.deepEqual(e.candidates, []);
  });

  it("reports up-to-date with no candidates when nothing newer exists", () => {
    const e = evaluateDependency(
      dep("1.5.0"),
      packument({ "1.0.0": 60, "1.5.0": 30 }),
      defaults
    );
    assert.equal(e.status, "up-to-date");
    assert.deepEqual(e.candidates, []);
  });

  it("reports within-cooldown when the registry has no stable versions at all", () => {
    const e = evaluateDependency(
      dep("1.0.0"),
      packument({ "2.0.0-rc.1": 30 }),
      defaults
    );
    assert.deepEqual(e.resolved, {
      highestOverall: null,
      highestWithinMajor: null,
      newerMajor: false,
      target: null,
      targetOverall: null,
    });
    assert.equal(e.status, "within-cooldown");
  });
});

describe("spec kinds", () => {
  it("migrates a range to the highest eligible version within its major", () => {
    const e = evaluateDependency(
      dep("^1.2.0"),
      packument({ "1.2.0": 30, "1.4.0": 30, "2.0.0": 30 }),
      defaults
    );
    assert.equal(e.status, "range→exact");
    assert.deepEqual(e.candidates, [
      { kind: "primary", target: "1.4.0" },
      { kind: "major", target: "2.0.0" },
    ]);
  });

  it("pins a bare spec to the highest eligible version across every major", () => {
    const e = evaluateDependency(
      dep(""),
      packument({ "1.4.0": 30, "2.0.0": 30, "2.1.0": 1 }),
      defaults
    );
    assert.equal(e.status, "bare→pinned");
    assert.equal(e.resolved.newerMajor, false);
    assert.deepEqual(e.candidates, [{ kind: "primary", target: "2.0.0" }]);
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
    const e = evaluateDependency(
      spec,
      packument({ "1.2.0": 30, "1.3.0": 30, "2.0.0": 30 }),
      defaults
    );
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
