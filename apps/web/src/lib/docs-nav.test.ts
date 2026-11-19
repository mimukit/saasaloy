import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildDocsPages,
  firstHeading,
  groupPages,
  neighbours,
} from "./docs-nav.ts";

const WIKIMAP = `
pages:
  - path: index.md
    title: Overview
    section: Start
  - path: how-to/add.md
    title: Add a module
    section: Guides
  - path: generated/modules.md
    title: Module catalog
    section: Modules
  - path: generated/modules/*.md
    title: Module pages
    section: Modules
`;

const SOURCES = [
  { path: "index.md", heading: "Saasaloy" },
  { path: "how-to/add.md", heading: "How to add" },
  { path: "generated/modules.md", heading: "Module catalog" },
  { path: "generated/modules/email.md", heading: "email" },
  { path: "generated/modules/api.md", heading: "api" },
];

describe("buildDocsPages", () => {
  it("takes a title from the wikimap and a glob entry's titles from each H1, in name order", () => {
    const pages = buildDocsPages(WIKIMAP, SOURCES);
    assert.deepEqual(
      pages.map((page) => [page.url, page.title, page.isModule]),
      [
        ["/docs", "Overview", false],
        ["/docs/how-to/add", "Add a module", false],
        ["/docs/modules", "Module catalog", false],
        ["/docs/modules/api", "api", true],
        ["/docs/modules/email", "email", true],
      ]
    );
  });

  it("fails on a page that has no wikimap entry", () => {
    assert.throws(
      () =>
        buildDocsPages(WIKIMAP, [
          ...SOURCES,
          { path: "new.md", heading: "New" },
        ]),
      /new\.md has no entry/
    );
  });

  it("fails on an entry with no page", () => {
    assert.throws(
      () =>
        buildDocsPages(
          WIKIMAP,
          SOURCES.filter((source) => source.path !== "how-to/add.md")
        ),
      /lists how-to\/add\.md/
    );
  });

  it("fails on an unknown section", () => {
    assert.throws(
      () => buildDocsPages(WIKIMAP.replace("Guides", "Misc"), SOURCES),
      /unknown section "Misc"/
    );
  });
});

describe("groupPages and neighbours", () => {
  const pages = buildDocsPages(WIKIMAP, SOURCES);

  it("groups by section in the sidebar order and drops an empty section", () => {
    assert.deepEqual(
      groupPages(pages).map((group) => group.section),
      ["Start", "Modules", "Guides"]
    );
  });

  it("names the previous and next page in sidebar order", () => {
    const page = pages.find((candidate) => candidate.slug === "how-to/add");
    assert.ok(page);
    // Modules sit before Guides in the sidebar, though the wikimap lists Guides first.
    const { previous, next } = neighbours(pages, page);
    assert.equal(previous?.slug, "modules/email");
    assert.equal(next, undefined);
    const first = pages.at(0);
    assert.ok(first);
    assert.equal(neighbours(pages, first).previous, undefined);
  });
});

describe("firstHeading", () => {
  it("skips a heading inside a code fence", () => {
    assert.equal(firstHeading("```\n# not me\n```\n# me\n"), "me");
  });
});
