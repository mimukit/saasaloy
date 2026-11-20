// Builds the sticky pull request comment of the stale-docs check (plan 0114, Phase 5). The
// `site` workflow runs `docs-stale.ts --base origin/main --json`, pipes the result here,
// and posts the text as the job summary and as one comment that later runs update. The
// hidden MARKER on the first line is how the workflow finds that comment again.
//
// Three cases, each a test in `docs-stale-comment.test.ts`:
//
//   stale pages      list each page with the commits that touched its covered files;
//   none stale       say no page needs a look;
//   `docs: none`     say the pull request needs no docs change, and count what the check
//                    would have listed, so a reviewer who removes the label sees the list.
//
// The text never tells the author the check failed, because it never fails the job.
//
//   node scripts/docs-stale-comment.ts <report.json> [--docs-none]

import { readFileSync } from "node:fs";
import type { Report } from "./docs-stale.ts";

/** The first line of the comment. GitHub hides an HTML comment, and the workflow finds it. */
export const MARKER = "<!-- saasaloy-docs-stale -->";

/** The label that marks a pull request as needing no docs change. */
export const LABEL = "docs: none";

const MAX_COMMITS = 5;

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

/** The Markdown body of the comment, MARKER first. */
export function buildComment(report: Report, docsNone: boolean): string {
  const count = report.pages.length;
  const lines = [MARKER, "### Stale docs", ""];
  if (docsNone) {
    lines.push(
      `This pull request has the \`${LABEL}\` label, so it needs no docs change.`
    );
    if (count > 0) {
      lines.push(
        "",
        `Without the label, the check would list ${plural(count, "page")} that cover files this change touches.`
      );
    }
    return `${lines.join("\n")}\n`;
  }
  if (count === 0) {
    lines.push(
      "No page covers a file this change touches without the change also editing the page."
    );
    return `${lines.join("\n")}\n`;
  }
  lines.push(
    `${plural(count, "hand-written page")} cover${count === 1 ? "s" : ""} files this pull request changes, and the pull request does not edit ${count === 1 ? "it" : "them"}.`,
    ""
  );
  for (const page of report.pages) {
    lines.push(`- \`docs/wiki/${page.path}\` (${page.title})`);
    for (const commit of page.commits.slice(0, MAX_COMMITS)) {
      lines.push(`  - \`${commit.sha}\` ${commit.subject}`);
    }
    if (page.commits.length > MAX_COMMITS) {
      lines.push(`  - and ${page.commits.length - MAX_COMMITS} more`);
    }
  }
  lines.push(
    "",
    `Check each page against the change and edit it in this pull request. If the change needs no docs, add the \`${LABEL}\` label.`
  );
  return `${lines.join("\n")}\n`;
}

if (import.meta.main) {
  const [file, ...flags] = process.argv.slice(2);
  if (file === undefined || flags.some((flag) => flag !== "--docs-none")) {
    console.error(
      "usage: node scripts/docs-stale-comment.ts <report.json> [--docs-none]"
    );
    process.exitCode = 2;
  } else {
    const report = JSON.parse(readFileSync(file, "utf-8")) as Report;
    process.stdout.write(buildComment(report, flags.includes("--docs-none")));
  }
}
