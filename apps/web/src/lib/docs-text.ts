// Small readers over a wiki page's raw Markdown: the meta description, and the tier tag of a
// module page. Pure, so a node:test file holds them.

import { fenceReader } from "./docs-fence.ts";

const MAX_DESCRIPTION = 160;

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
  const text = plain(paragraph.join(" "));
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
