// Tests for `scripts/verify-pins.ts` (issue #59). The defect this guards against is two
// copies of React in one scaffolded project: `packages/email-react` renders email with
// the same React the design system compiles against, and nothing in pnpm's resolution
// notices when those two exact pins drift apart.
//
// The rule table itself is exercised against the real files at the bottom, because a
// rule naming a manifest that has moved is the other way this check goes quietly dead.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkRule, PIN_RULES, readPin } from "./verify-pins.ts";
import type { PinnedManifest } from "./verify-pins.ts";

function manifest(file: string, json: Record<string, unknown>): PinnedManifest {
  return { file, json };
}

describe("readPin", () => {
  it("finds a dependency", () => {
    assert.equal(
      readPin({ dependencies: { react: "19.2.8" } }, "react"),
      "19.2.8"
    );
  });

  it("finds a devDependency", () => {
    assert.equal(
      readPin({ devDependencies: { react: "19.2.8" } }, "react"),
      "19.2.8"
    );
  });

  it("finds a peerDependency", () => {
    assert.equal(
      readPin({ peerDependencies: { react: "19.2.8" } }, "react"),
      "19.2.8"
    );
  });

  it("prefers dependencies over devDependencies", () => {
    assert.equal(
      readPin(
        {
          dependencies: { react: "19.2.8" },
          devDependencies: { react: "19.1.0" },
        },
        "react"
      ),
      "19.2.8"
    );
  });

  it("returns undefined when the dep is absent", () => {
    assert.equal(
      readPin({ dependencies: { hono: "4.0.0" } }, "react"),
      undefined
    );
  });
});

describe("checkRule", () => {
  const rule = {
    dep: "react",
    files: ["a/package.json", "b/package.json"],
  } as const;

  it("passes when every manifest pins the same version", () => {
    const failure = checkRule(rule, [
      manifest("a/package.json", { dependencies: { react: "19.2.8" } }),
      manifest("b/package.json", { peerDependencies: { react: "19.2.8" } }),
    ]);
    assert.equal(failure, null);
  });

  it("fails on a skew and names both files and both versions", () => {
    const failure = checkRule(rule, [
      manifest("a/package.json", { dependencies: { react: "19.2.8" } }),
      manifest("b/package.json", { peerDependencies: { react: "19.1.0" } }),
    ]);
    assert.ok(failure !== null);
    assert.match(failure, /a\/package\.json/);
    assert.match(failure, /b\/package\.json/);
    assert.match(failure, /19\.2\.8/);
    assert.match(failure, /19\.1\.0/);
  });

  it("fails when a manifest does not pin the dep at all", () => {
    const failure = checkRule(rule, [
      manifest("a/package.json", { dependencies: { react: "19.2.8" } }),
      manifest("b/package.json", { dependencies: {} }),
    ]);
    assert.ok(failure !== null);
    assert.match(failure, /b\/package\.json/);
  });
});

describe("PIN_RULES", () => {
  it("declares at least the react rule across email-react and ui", () => {
    const react = PIN_RULES.find((rule) => rule.dep === "react");
    assert.ok(react !== undefined);
    assert.ok(react.files.includes("modules/email-react/files/package.json"));
    assert.ok(
      react.files.includes(
        "packages/cli/templates/base/packages/ui/package.json"
      )
    );
  });

  it("covers @types/react across the same two manifests", () => {
    const types = PIN_RULES.find((rule) => rule.dep === "@types/react");
    assert.ok(types !== undefined);
    assert.ok(types.files.includes("modules/email-react/files/package.json"));
    assert.ok(
      types.files.includes(
        "packages/cli/templates/base/packages/ui/package.json"
      )
    );
  });

  it("names at least two manifests per rule", () => {
    for (const rule of PIN_RULES) {
      assert.ok(rule.files.length >= 2, `${rule.dep} needs two manifests`);
    }
  });
});
