import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertUniqueSlugs, pageSlug, pageUrl } from "./docs-slug.ts";

describe("pageSlug", () => {
  it("gives index.md the empty slug", () => {
    assert.equal(pageSlug("index.md"), "");
    assert.equal(pageUrl("index.md"), "/docs");
  });

  it("keeps a hand-written page's folder and drops the extension", () => {
    assert.equal(pageSlug("getting-started.md"), "getting-started");
    assert.equal(pageSlug("how-to/add-a-module.md"), "how-to/add-a-module");
    assert.equal(
      pageUrl("runbooks/bad-descriptor-on-main.md"),
      "/docs/runbooks/bad-descriptor-on-main"
    );
  });

  it("drops the generated folder from a URL", () => {
    assert.equal(pageSlug("generated/env.md"), "env");
    assert.equal(pageSlug("generated/modules/email.md"), "modules/email");
    assert.equal(pageUrl("generated/cli.md"), "/docs/cli");
  });

  it("moves the hand-written modules page so the generated catalog owns /docs/modules", () => {
    assert.equal(pageSlug("generated/modules.md"), "modules");
    assert.equal(pageSlug("modules.md"), "modules/overview");
  });
});

describe("assertUniqueSlugs", () => {
  it("accepts the real page set shape", () => {
    assert.doesNotThrow(() =>
      assertUniqueSlugs([
        "index.md",
        "modules.md",
        "generated/modules.md",
        "generated/modules/api.md",
      ])
    );
  });

  it("fails when two pages claim one slug", () => {
    assert.throws(
      () => assertUniqueSlugs(["env.md", "generated/env.md"]),
      /both map to \/docs\/env/
    );
  });
});
