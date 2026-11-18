// Reading a product spec, `docs/product-spec.md` in a generated project (plan 0109).
//
// The `saasaloy-setup` interview writes the spec from a template that ships beside the
// skill, `packages/cli/templates/base/_agents/skills/saasaloy-setup/product-spec-template.md`,
// and `saasaloy-build` and `saasaloy-feature` read it by its headings. The template is the
// one source of those headings: its `##` headings, in order, and the row names of its
// entity table. Nothing else lists them, so this file reads them out of the template.
//
// `scripts/product-spec.test.ts` checks that the three skills name exactly what the
// template holds. A benchmark scorer can call `specProblems` and `specEntities` on the
// spec an agent wrote.
//
// Imports node: builtins only. Node 24 strips the types, so there is no build step.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The template, relative to the repo root. */
export const SPEC_TEMPLATE = join(
  "packages",
  "cli",
  "templates",
  "base",
  "_agents",
  "skills",
  "saasaloy-setup",
  "product-spec-template.md"
);

/** The `##` heading under which each entity is a `###` section. */
export const ENTITIES_HEADING = "Entities";

/** The lines of `markdown` outside code fences and HTML comments. */
function proseLines(markdown: string): string[] {
  const lines: string[] = [];
  let fenced = false;
  for (const line of markdown.replaceAll(/<!--[\s\S]*?-->/g, "").split("\n")) {
    if (line.trimStart().startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (!fenced) {
      lines.push(line);
    }
  }
  return lines;
}

/** The text of each heading of `level` (2 for `##`), in order. */
export function headings(markdown: string, level: 2 | 3): string[] {
  const prefix = `${"#".repeat(level)} `;
  return proseLines(markdown)
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length).trim());
}

/** The cells of a Markdown table row, or `undefined` for a line that is not one. */
function cells(line: string): string[] | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) {
    return undefined;
  }
  return trimmed
    .replaceAll(/^\||\|$/g, "")
    .split("|")
    .map((cell) => cell.trim());
}

/** One entity of a spec: its `###` heading and its table, row name to value. */
export interface SpecEntity {
  heading: string;
  parts: Map<string, string>;
}

/** Each entity under `## Entities`, in the spec's order. */
export function specEntities(markdown: string): SpecEntity[] {
  const entities: SpecEntity[] = [];
  let inEntities = false;
  let current: SpecEntity | undefined;
  let tableRow = 0;
  for (const line of proseLines(markdown)) {
    if (line.startsWith("## ")) {
      inEntities = line.slice(3).trim() === ENTITIES_HEADING;
      current = undefined;
      continue;
    }
    if (!inEntities) {
      continue;
    }
    if (line.startsWith("### ")) {
      current = { heading: line.slice(4).trim(), parts: new Map() };
      entities.push(current);
      tableRow = 0;
      continue;
    }
    const row = cells(line);
    if (!current || !row) {
      tableRow = 0;
      continue;
    }
    tableRow += 1;
    // Row 1 is the header and row 2 the separator.
    const [name = "", value = ""] = row;
    if (tableRow > 2 && name !== "") {
      current.parts.set(name, value);
    }
  }
  return entities;
}

/** The fixed shape a spec takes: its `##` headings and the row names of an entity table. */
export interface SpecShape {
  headings: string[];
  parts: string[];
}

/** The shape the template gives. */
export function specShape(template: string): SpecShape {
  return {
    headings: headings(template, 2),
    parts: [...(specEntities(template)[0]?.parts.keys() ?? [])],
  };
}

/** The shape of the template in the repo at `root`. */
export function templateShape(root: string): SpecShape {
  return specShape(readFileSync(join(root, SPEC_TEMPLATE), "utf-8"));
}

/**
 * Why `spec` does not have the fixed shape, one line each; empty when it has. A spec must
 * hold the shape's `##` headings in order and no other, at least one entity, and every
 * row of the shape in each entity's table.
 */
export function specProblems(spec: string, shape: SpecShape): string[] {
  const problems: string[] = [];
  const found = headings(spec, 2);
  for (const heading of shape.headings) {
    if (!found.includes(heading)) {
      problems.push(`no "## ${heading}" heading`);
    }
  }
  for (const heading of found) {
    if (!shape.headings.includes(heading)) {
      problems.push(`an extra "## ${heading}" heading`);
    }
  }
  const order = found.filter((heading) => shape.headings.includes(heading));
  const expected = shape.headings.filter((heading) => order.includes(heading));
  if (order.join("\n") !== expected.join("\n")) {
    problems.push(`the headings are out of order: ${order.join(", ")}`);
  }
  const entities = specEntities(spec);
  if (shape.headings.includes(ENTITIES_HEADING) && entities.length === 0) {
    problems.push(`no entity under "## ${ENTITIES_HEADING}"`);
  }
  for (const entity of entities) {
    for (const part of shape.parts) {
      if (!entity.parts.has(part)) {
        problems.push(`"${entity.heading}" has no ${part} row`);
      }
    }
  }
  return problems;
}
