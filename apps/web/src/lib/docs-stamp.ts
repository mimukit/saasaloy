// The provenance stamp wikikit writes at the end of a verified page:
//
//   _Verified against `main`@`42cbf03` on 2026-09-11._
//
// The docs header shows it as "Verified against 42cbf03", linked to the commit, beside the
// version label. `scripts/docs-freshness.ts` reads the same line to find the commits a page
// has missed. A page with no stamp shows no label.

const STAMP =
  /^_Verified against `[^`]+`@`([0-9a-f]{7,40})` on (\d{4}-\d{2}-\d{2})\._\s*$/m;

export interface Stamp {
  /** The commit as the page writes it, usually 7 characters. */
  sha: string;
  /** The date in the stamp, `YYYY-MM-DD`. */
  date: string;
}

/** The stamp of a page's Markdown, or undefined. */
export function stampOf(markdown: string): Stamp | undefined {
  const match = STAMP.exec(markdown);
  return match === null
    ? undefined
    : { sha: match[1] ?? "", date: match[2] ?? "" };
}
