// Small readers over a wiki page's raw Markdown: the meta description, and the tier tag of a
// module page. Pure, so a node:test file holds them.

import { docsUi } from "../content/docs.ts";
import { fenceReader } from "./docs-fence.ts";
import { interpolate } from "./interpolate.ts";

const MAX_DESCRIPTION = 160;
// Google cuts a result title near 60 characters and an SEO crawler calls one under about
// 50 too short, so a title takes the long template only while it stays within this.
const MAX_TITLE = 65;
// A description under this length gets the module sentence, because crawlers flag a meta
// description shorter than about 120 characters.
const MIN_DESCRIPTION = 120;

/** Plain text from one line of Markdown: links, code marks and emphasis stripped. */
function plain(line: string): string {
  return line
    .replaceAll(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replaceAll(/[`*_]/g, "")
    .replaceAll(/\s+/g, " ")
    .trim();
}

/**
 * The page's meta description: its first paragraph, in plain text, cut at a word near 160
 * characters. A heading, a blockquote (the generated banner), a table, a list, a code fence
 * and an HTML comment do not count as a paragraph.
 */
export function pageDescription(markdown: string): string {
  const inFence = fenceReader();
  const paragraph: string[] = [];
  for (const line of markdown.split("\n")) {
    const text = line.trim();
    const skipped = inFence(line) || /^(#|>|\||<!--|[-*+] |\d+\. )/.test(text);
    if (skipped || text === "") {
      if (paragraph.length > 0) {
        break;
      }
      continue;
    }
    paragraph.push(text);
  }
  return clip(plain(paragraph.join(" ")));
}

function clip(text: string): string {
  if (text.length <= MAX_DESCRIPTION) {
    return text;
  }
  const cut = text.slice(0, MAX_DESCRIPTION - 1);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}

/** The tier a generated module page states in its Facts table, such as `capability`. */
export function moduleTierOf(markdown: string): string | undefined {
  return /^\| Tier \| ([a-z]+) \|$/m.exec(markdown)?.[1];
}

/** The tab title of a docs page. The docs root passes an empty `page`. */
export function docsTitle(
  page: string,
  isModule: boolean,
  siteName: string
): string {
  if (page === "") {
    return interpolate(docsUi.rootTitle, { siteName });
  }
  const label = isModule
    ? interpolate(docsUi.moduleTitle, { name: page })
    : page;
  const long = interpolate(docsUi.title, { page: label, siteName });
  return long.length <= MAX_TITLE
    ? long
    : interpolate(docsUi.shortTitle, { page: label, siteName });
}

/** A module page's meta description: the first paragraph, with the module sentence when short. */
export function moduleDescription(
  description: string,
  name: string,
  tier: string | undefined,
  siteName: string
): string {
  if (tier === undefined || description.length >= MIN_DESCRIPTION) {
    return description;
  }
  const sentence = interpolate(docsUi.moduleDescription, {
    siteName,
    tier,
    name,
  });
  return clip(description === "" ? sentence : `${description} ${sentence}`);
}
