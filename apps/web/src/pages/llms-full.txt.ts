// /llms-full.txt, prerendered at build time: every docs page in reading order, as one
// Markdown file, for an agent that wants the whole documentation in a single fetch. Each
// page follows a rule line and a `Source:` line with its URL. The root llms.txt links here.
// The pages come from the same collection as /docs, so this file cannot drift from the site.
import type { APIRoute } from "astro";

import { siteName } from "@web/site";
import { loadDocs } from "@web/lib/docs";
import { groupPages } from "@web/lib/docs-nav";
import { rawPage } from "@web/lib/docs-raw";

export const GET: APIRoute = async ({ site }) => {
  const origin = site?.origin ?? "";
  const { items, pages } = await loadDocs();
  // The sidebar's order, not the wikimap's, so the file reads as the site does.
  const byPath = new Map(items.map((item) => [item.page.path, item]));
  const ordered = groupPages(pages)
    .flatMap((group) => group.pages)
    .map((page) => byPath.get(page.path))
    .filter((item) => item !== undefined);
  const parts = ordered.map(({ page, entry }) => {
    const url = `${origin}${page.slug === "" ? "/docs/index" : `/docs/${page.slug}`}.md`;
    return `Source: ${url}\n\n${rawPage(page, entry.body ?? "", pages, origin).trim()}`;
  });
  const body = [
    `# ${siteName} documentation`,
    "",
    `Every page of the docs at ${origin}/docs, in one file.`,
    "",
    parts.join("\n\n---\n\n"),
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
