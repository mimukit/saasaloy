// Guards how the `e2e` module picks between dev servers and built apps.
//
// `serveMode` decides what every `webServer` entry runs, and a wrong default fails
// silently: CI would go back to dev servers and run out of memory, or a local run would
// build every app before each spec. An unknown value must throw, or a typo in
// `E2E_SERVE` runs the mode nobody asked for. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { serveMode } from "../modules/e2e/files/lib/project.ts";

describe("e2e serveMode", () => {
  it("serves dev servers off CI when E2E_SERVE is unset", () => {
    assert.equal(serveMode({}), "dev");
    assert.equal(serveMode({ E2E_SERVE: "", CI: "" }), "dev");
  });

  it("serves built apps on CI when E2E_SERVE is unset", () => {
    assert.equal(serveMode({ CI: "true" }), "built");
    assert.equal(serveMode({ CI: "1", E2E_SERVE: "" }), "built");
  });

  it("takes an explicit value over the CI default", () => {
    assert.equal(serveMode({ E2E_SERVE: "dev", CI: "true" }), "dev");
    assert.equal(serveMode({ E2E_SERVE: "built" }), "built");
  });

  it("throws on any other value and names both modes", () => {
    assert.throws(
      () => serveMode({ E2E_SERVE: "prod" }),
      /E2E_SERVE is "prod"\. Set it to dev or built/
    );
    assert.throws(() => serveMode({ E2E_SERVE: "Built" }), /dev or built/);
  });
});
