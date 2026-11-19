import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { absolutizeMarkdown, rewriteDocLink } from "./docs-links.ts";
import type { LinkContext } from "./docs-links.ts";

const PAGES = new Set([
  "docs/wiki/index.md",
  "docs/wiki/getting-started.md",
  "docs/wiki/reference.md",
  "docs/wiki/how-to/add-a-module.md",
  "docs/wiki/generated/modules.md",
  "docs/wiki/generated/modules/email.md",
]);

function context(fromFile: string): LinkContext {
  return {
    fromFile,
    version: "0.9.0",
    hasPage: (path) => PAGES.has(path),
  };
}

describe("rewriteDocLink", () => {
  const from = context("docs/wiki/how-to/add-a-module.md");

  it("leaves a URL, an anchor and a root path alone", () => {
    assert.equal(
      rewriteDocLink("https://example.com/x", from),
      "https://example.com/x"
    );
    assert.equal(rewriteDocLink("#install-one", from), "#install-one");
    assert.equal(rewriteDocLink("/docs/env", from), "/docs/env");
    assert.equal(rewriteDocLink("mailto:a@b.test", from), "mailto:a@b.test");
  });

  it("turns a link to another wiki page into its /docs URL, keeping the anchor", () => {
    assert.equal(
      rewriteDocLink("../reference.md#saasaloy-add", from),
      "/docs/reference#saasaloy-add"
    );
    assert.equal(
      rewriteDocLink("../getting-started.md", from),
      "/docs/getting-started"
    );
    assert.equal(rewriteDocLink("../index.md", from), "/docs");
  });

  it("drops the generated folder and maps the catalog", () => {
    assert.equal(
      rewriteDocLink("../generated/modules/email.md", from),
      "/docs/modules/email"
    );
    assert.equal(
      rewriteDocLink("../generated/modules.md", from),
      "/docs/modules"
    );
  });

  it("resolves a link written from a generated page", () => {
    const generated = context("docs/wiki/generated/modules.md");
    assert.equal(
      rewriteDocLink("modules/email.md", generated),
      "/docs/modules/email"
    );
    assert.equal(
      rewriteDocLink("../reference.md", generated),
      "/docs/reference"
    );
  });

  it("points another repo file at GitHub at the release tag", () => {
    assert.equal(
      rewriteDocLink("../../../CONTEXT.md#module", from),
      "https://github.com/mimukit/saasaloy/blob/v0.9.0/CONTEXT.md#module"
    );
    assert.equal(
      rewriteDocLink("../../adr/0033-x.md", from),
      "https://github.com/mimukit/saasaloy/blob/v0.9.0/docs/adr/0033-x.md"
    );
  });

  it("fails on a link to a wiki page that does not exist", () => {
    assert.throws(
      () => rewriteDocLink("../missing.md", from),
      /docs\/wiki\/missing\.md is not a wiki page/
    );
  });

  it("fails on a link out of the repository", () => {
    assert.throws(
      () => rewriteDocLink("../../../../x.md", from),
      /outside the repository/
    );
  });
});

describe("absolutizeMarkdown", () => {
  const from = context("docs/wiki/how-to/add-a-module.md");

  it("makes each link absolute and points a wiki link at the raw Markdown", () => {
    const out = absolutizeMarkdown(
      "See [the reference](../reference.md#x), [home](../index.md) and [the glossary](../../../CONTEXT.md).",
      from,
      "https://saasaloy.com"
    );
    assert.equal(
      out,
      "See [the reference](https://saasaloy.com/docs/reference.md#x), [home](https://saasaloy.com/docs/index.md) and [the glossary](https://github.com/mimukit/saasaloy/blob/v0.9.0/CONTEXT.md)."
    );
  });

  it("leaves a link inside a code fence as written", () => {
    const fenced = "```md\n[x](../reference.md)\n```";
    assert.equal(
      absolutizeMarkdown(fenced, from, "https://saasaloy.com"),
      fenced
    );
  });
});
