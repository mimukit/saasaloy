// The raw Markdown the agent-facing routes serve: one page at /docs/<slug>.md, and every page
// in /llms-full.txt. Both make each relative link absolute, because the file leaves the
// wiki's folder tree. The CLI version for the GitHub links comes from lib/cli-version.ts.
// This file uses no `node:fs`, because `astro dev` runs the routes inside workerd.

import { cliVersion } from "@web/lib/cli-version";
import { absolutizeMarkdown } from "@web/lib/docs-links";
import type { DocsPage } from "@web/lib/docs-nav";

/** One page's Markdown with its relative links made absolute against `origin`. */
export function rawPage(
  page: DocsPage,
  body: string,
  pages: readonly DocsPage[],
  origin: string
): string {
  const known = new Set(
    pages.map((candidate) => `docs/wiki/${candidate.path}`)
  );
  return absolutizeMarkdown(
    body,
    {
      fromFile: `docs/wiki/${page.path}`,
      version: cliVersion,
      hasPage: (repoPath) => known.has(repoPath),
    },
    origin
  );
}
