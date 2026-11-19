// The docs sidebar, the previous and next links and every page title, built from
// `docs/wiki/.wikimap.yaml`. The wikimap holds each page's `title` and `section`, in reading
// order, and one glob entry (`generated/modules/*.md`) stands for every module page. A glob
// entry expands to the pages it matches, in name order, and each page takes its title from its
// own H1, because a new module needs no wikimap edit.
//
// The build fails when the wikimap and the wiki disagree: a page with no entry, an entry
// with no page, a glob that matches nothing, or a section the sidebar does not know. A page
// cannot reach the site unlisted, and the sidebar cannot link a page that is gone.
//
// Pure functions over strings, so a node:test file holds them. docs.ts feeds them from the
// content collection.

import { parse } from "yaml";

import {
  GENERATED_DIR,
  assertUniqueSlugs,
  pageSlug,
  pageUrl,
} from "./docs-slug.ts";

/** The sidebar groups, in order. The approved mockup (plan 0114, round 1) settled them. */
export const SECTIONS = [
  "Start",
  "Build with an agent",
  "Modules",
  "Guides",
  "Runbooks",
  "Reference",
  "Decisions",
] as const;

export type Section = (typeof SECTIONS)[number];

/** One wiki page as the site knows it. */
export interface DocsPage {
  /** Path under `docs/wiki/`, such as `generated/modules/email.md`. */
  path: string;
  /** The URL slug, empty for the docs root. */
  slug: string;
  /** The site path, `/docs` or `/docs/<slug>`. */
  url: string;
  title: string;
  section: Section;
  /** True for a page `pnpm docs:generate` writes. */
  generated: boolean;
  /** True for a page under `generated/modules/`. */
  isModule: boolean;
}

/** What the loader knows about a page on disk: its path and the first H1 of its body. */
export interface PageSource {
  path: string;
  heading: string | undefined;
}

interface WikimapEntry {
  path: string;
  title: string;
  section: string;
}

/** The text of the first `# ` heading outside a code fence, or undefined. */
export function firstHeading(markdown: string): string | undefined {
  let fenced = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
    } else if (!fenced && line.startsWith("# ")) {
      return line.slice(2).trim();
    }
  }
  return undefined;
}

function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
    .replaceAll("**/", "(?:.*/)?")
    .replaceAll("*", "[^/]*");
  return new RegExp(`^${escaped}$`);
}

function readEntries(wikimap: string): WikimapEntry[] {
  const parsed = parse(wikimap) as { pages?: unknown };
  if (!Array.isArray(parsed.pages)) {
    throw new TypeError("docs: .wikimap.yaml has no `pages` list.");
  }
  return parsed.pages.map((raw: Record<string, unknown>) => {
    const { path, title, section } = raw;
    if (
      typeof path !== "string" ||
      typeof title !== "string" ||
      typeof section !== "string"
    ) {
      throw new TypeError(
        `docs: a .wikimap.yaml page needs a string path, title and section: ${JSON.stringify(raw)}`
      );
    }
    return { path, title, section };
  });
}

/**
 * Every page, in reading order: the wikimap's order, with a glob entry expanded in name
 * order. Throws when the wikimap and `sources` disagree.
 */
export function buildDocsPages(
  wikimap: string,
  sources: readonly PageSource[]
): DocsPage[] {
  assertUniqueSlugs(sources.map((source) => source.path));
  const known = new Set<string>(SECTIONS);
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const claimed = new Set<string>();
  const pages: DocsPage[] = [];

  for (const entry of readEntries(wikimap)) {
    if (!known.has(entry.section)) {
      throw new Error(
        `docs: .wikimap.yaml puts ${entry.path} in the unknown section "${entry.section}". Known: ${SECTIONS.join(", ")}.`
      );
    }
    const isGlob = entry.path.includes("*");
    const matched = isGlob
      ? sources
          .map((source) => source.path)
          .filter((path) => globToRegExp(entry.path).test(path))
          .toSorted()
      : [entry.path];
    if (matched.length === 0) {
      throw new Error(
        `docs: .wikimap.yaml entry ${entry.path} matches no page.`
      );
    }
    for (const path of matched) {
      const source = byPath.get(path);
      if (source === undefined) {
        throw new Error(
          `docs: .wikimap.yaml lists ${path}, but docs/wiki/ has no such page.`
        );
      }
      if (claimed.has(path)) {
        throw new Error(`docs: .wikimap.yaml lists ${path} twice.`);
      }
      claimed.add(path);
      const title = isGlob ? source.heading : entry.title;
      if (title === undefined || title === "") {
        throw new Error(`docs: ${path} has no H1 to take its title from.`);
      }
      pages.push({
        path,
        slug: pageSlug(path),
        url: pageUrl(path),
        title,
        section: entry.section as Section,
        generated: path.startsWith(`${GENERATED_DIR}/`),
        isModule: path.startsWith(`${GENERATED_DIR}/modules/`),
      });
    }
  }

  for (const source of sources) {
    if (!claimed.has(source.path)) {
      throw new Error(
        `docs: docs/wiki/${source.path} has no entry in .wikimap.yaml. Add one with a title and a section.`
      );
    }
  }
  return pages;
}

/** One sidebar group: a section and its pages, in reading order. */
export interface DocsGroup {
  section: Section;
  pages: DocsPage[];
}

/** The pages grouped by section, in sidebar order. A section with no page is dropped. */
export function groupPages(pages: readonly DocsPage[]): DocsGroup[] {
  return SECTIONS.map((section) => ({
    section,
    pages: pages.filter((page) => page.section === section),
  })).filter((group) => group.pages.length > 0);
}

/**
 * The page before and the page after `page` in sidebar order, which is the order of
 * `groupPages` and not of the wikimap, so Previous and Next follow what the reader sees.
 */
export function neighbours(
  pages: readonly DocsPage[],
  page: DocsPage
): { previous: DocsPage | undefined; next: DocsPage | undefined } {
  const ordered = groupPages(pages).flatMap((group) => group.pages);
  const index = ordered.findIndex((candidate) => candidate.path === page.path);
  return { previous: ordered[index - 1], next: ordered[index + 1] };
}
