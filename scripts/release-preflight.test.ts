// Tests for `scripts/release-preflight.ts` (issue #46). The preflight runs the whole CI
// gate and the tarball smoke, so the script end to end is a several-minute job. Two
// decisions inside it are worth pinning cheaply.
//
// The skip flag is one of them. `SAASALOY_RELEASE_SKIP_GATE=1` is the only way to pass a
// choice into a release-it hook, because hooks are fixed strings, and a flag that reads as
// "on" for any non-empty value would silently skip the gate for `SAASALOY_RELEASE_SKIP_GATE=0`.
//
// The staleness message is the other. A release cut from a `main` that is behind origin
// publishes code nobody reviewed at that tag, and the maintainer needs to read what to do,
// not just that a comparison failed.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GATE_SCRIPTS,
  shouldSkipGate,
  staleMainMessage,
} from "./release-preflight.ts";

describe("shouldSkipGate", () => {
  it("is off when the variable is unset", () => {
    assert.equal(shouldSkipGate({}), false);
  });

  it("is on for exactly 1", () => {
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "1" }), true);
  });

  // "0" and "" read as off to anyone who writes them, and a truthiness check would read
  // both as on.
  it("is off for 0 and for the empty string", () => {
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "0" }), false);
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "" }), false);
  });

  it("is off for any other value", () => {
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "yes" }), false);
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "true" }), false);
  });
});

describe("GATE_SCRIPTS", () => {
  // The preflight exists so a release never depends on GitHub's view of CI. That only
  // holds while this list is the same one ci.yml runs.
  it("is the four scripts ci.yml runs, in the same order", () => {
    assert.deepEqual(
      [...GATE_SCRIPTS],
      ["lint", "typecheck", "test", "verify:content"]
    );
  });
});

describe("staleMainMessage", () => {
  const message = staleMainMessage("abc1234", "def5678");

  it("names both commits", () => {
    assert.match(message, /abc1234/);
    assert.match(message, /def5678/);
  });

  it("tells the maintainer how to recover", () => {
    assert.match(message, /git pull/);
  });
});
