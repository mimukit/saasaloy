// Checks the product spec's fixed headings (plan 0109, issue #347).
//
// `docs/product-spec.md` is written by the `saasaloy-setup` interview and read by
// `saasaloy-build` and `saasaloy-feature`. The template beside the setup skill is the one
// source of its `##` headings and of the row names of an entity table
// (`scripts/product-spec.ts` reads them). This test holds the three skills to it: each
// one names the headings and the rows it relies on, and a rename in one place fails here
// until the others follow.
//
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  SPEC_TEMPLATE,
  headings,
  specEntities,
  specProblems,
  specShape,
  templateShape,
} from "./product-spec.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILLS = join(ROOT, "packages/cli/templates/base/_agents/skills");

function skill(name: string): string {
  return readFileSync(join(SKILLS, name, "SKILL.md"), "utf-8");
}

/** The first line of `markdown` that holds `marker`, from the marker on. */
function lineAfter(markdown: string, marker: string): string {
  const line = markdown.split("\n").find((entry) => entry.includes(marker));
  assert.ok(line, `no line holds "${marker}"`);
  return line.slice(line.indexOf(marker));
}

/** `text` up to the end of its first sentence. */
function firstSentence(text: string): string {
  return text.split(/\.(?:\s|$)/)[0] ?? "";
}

/** The `## <name>` headings the first sentence of `text` names in code spans, in order. */
function namedHeadings(text: string): string[] {
  return [...firstSentence(text).matchAll(/`## ([^`]+)`/g)].map(
    (match) => match[1] ?? ""
  );
}

/** The code spans of the first sentence of `text` that are not headings, in order. */
function namedSpans(text: string): string[] {
  return [...firstSentence(text).matchAll(/`([^`#][^`]*)`/g)].map(
    (match) => match[1] ?? ""
  );
}

/** The first cell of each body row of the first table after the line holding `marker`. */
function tableAfter(markdown: string, marker: string): string[] {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.includes(marker));
  assert.ok(start !== -1, `no line holds "${marker}"`);
  const rows: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "" && rows.length === 0) {
      continue;
    }
    if (!line.startsWith("|")) {
      break;
    }
    rows.push(line.split("|")[1]?.trim() ?? "");
  }
  return rows.slice(2);
}

const SPEC = `# Product spec

## Modules

| Module | Stage | Why |
|--------|-------|-----|
| \`teams\` | \`teams\` | a team pays |

## Database driver

\`database-d1\`: no pick needs Postgres.

## Entities

### 1. Books

| Part | Value |
|------|-------|
| Table | \`books\` |
| Fields | \`title\` text, required |
| Actions | \`list\`, \`create\`, \`update\` |

### 2. Notes

| Part | Value |
|------|-------|
| Table | \`notes\` |

## Not in this build

- None.
`;

describe("the spec reader", () => {
  it("reads the headings of one level, and skips a code fence", () => {
    assert.deepEqual(
      headings("## A\n\n```md\n## not one\n```\n\n### B\n## C\n", 2),
      ["A", "C"]
    );
  });

  it("reads each entity's table under Entities, in order", () => {
    const entities = specEntities(SPEC);
    assert.deepEqual(
      entities.map((entity) => entity.heading),
      ["1. Books", "2. Notes"]
    );
    assert.equal(entities[0]?.parts.get("Table"), "`books`");
    assert.deepEqual([...(entities[1]?.parts.keys() ?? [])], ["Table"]);
  });

  it("names each missing heading and each missing row", () => {
    const shape = {
      headings: [
        "Modules",
        "Database driver",
        "Entities",
        "Not in this build",
        "Left for the owner",
      ],
      parts: ["Table", "Fields", "Actions"],
    };
    assert.deepEqual(specProblems(SPEC, shape), [
      'no "## Left for the owner" heading',
      '"2. Notes" has no Fields row',
      '"2. Notes" has no Actions row',
    ]);
  });

  it("names an extra heading, a wrong order, and a spec with no entity", () => {
    const shape = { headings: ["A", "Entities"], parts: [] };
    assert.deepEqual(specProblems("## Entities\n\n## A\n\n## B\n", shape), [
      'an extra "## B" heading',
      "the headings are out of order: Entities, A",
      'no entity under "## Entities"',
    ]);
  });
});

describe("the spec template", () => {
  const template = readFileSync(join(ROOT, SPEC_TEMPLATE), "utf-8");
  const shape = templateShape(ROOT);

  it("ships beside the saasaloy-setup skill", () => {
    assert.ok(existsSync(join(ROOT, SPEC_TEMPLATE)));
  });

  it("has fixed headings and one entity table to copy", () => {
    assert.ok(shape.headings.includes("Entities"), "no ## Entities heading");
    assert.ok(shape.headings.length >= 4, "too few headings");
    assert.ok(shape.parts.length >= 4, "the entity table has too few rows");
  });

  it("is itself a spec with the fixed shape", () => {
    assert.deepEqual(specProblems(template, specShape(template)), []);
  });

  it("is the shape saasaloy-setup tells the agent to write", () => {
    const setup = skill("saasaloy-setup");
    assert.deepEqual(
      namedHeadings(lineAfter(setup, "Its `##` headings are fixed")),
      shape.headings
    );
    assert.deepEqual(
      namedSpans(lineAfter(setup, "with one table whose rows are")),
      shape.parts
    );
  });

  it("is the shape saasaloy-setup's entity proposal uses", () => {
    assert.deepEqual(
      tableAfter(skill("saasaloy-setup"), "Each table has the five rows of"),
      shape.parts
    );
  });

  it("is the shape saasaloy-build checks at Intake", () => {
    const build = skill("saasaloy-build");
    assert.deepEqual(
      namedHeadings(lineAfter(build, "it must hold each `##` heading")),
      shape.headings
    );
    assert.deepEqual(
      namedSpans(lineAfter(build, "must have a table with the rows")),
      shape.parts
    );
  });

  it("is the shape saasaloy-feature reads", () => {
    const feature = skill("saasaloy-feature");
    const rows = lineAfter(feature, "Its table has five rows");
    assert.deepEqual(
      namedSpans(rows.slice(rows.indexOf(":") + 1)),
      shape.parts
    );
    for (const part of ["Fields", "Actions", "Screens"]) {
      assert.ok(shape.parts.includes(part), `the template has no ${part} row`);
      assert.ok(
        feature.includes(`### \`${part}\` becomes`),
        `saasaloy-feature has no "### \`${part}\` becomes" section`
      );
    }
  });
});
