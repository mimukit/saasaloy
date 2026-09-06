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
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  GATE_SCRIPTS,
  hasGitHubToken,
  missingTokenMessage,
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

/**
 * The `pnpm <script>` steps of ci.yml's gate job, in file order, minus the install.
 *
 * A regex and not a YAML parse: the repo has no YAML dependency, and adding one to read
 * five lines costs more than it returns. It reads `- run: pnpm x` steps only, so a gate
 * step written any other way goes missing rather than mismatching. The comment in ci.yml
 * points back here for that reason.
 */
function gateStepsInCi(yaml: string): string[] {
  return [...yaml.matchAll(/^\s*- run: pnpm ([\w:]+)(?: .*)?$/gm)]
    .map((match) => match[1]!)
    .filter((script) => script !== "install");
}

describe("GATE_SCRIPTS", () => {
  // The preflight exists so a release never depends on GitHub's view of CI. That only
  // holds while this list is the same one ci.yml runs, so read ci.yml rather than
  // restating it: a step added, dropped or reordered there fails here.
  it("is the scripts ci.yml runs, in the same order", async () => {
    const yaml = await readFile(
      join(import.meta.dirname, "../.github/workflows/ci.yml"),
      "utf-8"
    );
    assert.deepEqual([...GATE_SCRIPTS], gateStepsInCi(yaml));
  });
});

describe("hasGitHubToken", () => {
  it("is false when the variable is unset", () => {
    assert.equal(hasGitHubToken({}), false);
  });

  // `gh auth token` prints nothing and exits non-zero when gh is not logged in, so the
  // root script hands the hook an empty string rather than no variable at all.
  it("is false when the variable is empty or blank", () => {
    assert.equal(hasGitHubToken({ GITHUB_TOKEN: "" }), false);
    assert.equal(hasGitHubToken({ GITHUB_TOKEN: "  \n" }), false);
  });

  it("is true when the variable holds a token", () => {
    assert.equal(hasGitHubToken({ GITHUB_TOKEN: "gho_example" }), true);
  });
});

describe("missingTokenMessage", () => {
  it("tells the maintainer how to recover", () => {
    assert.match(missingTokenMessage(), /gh auth login/);
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
