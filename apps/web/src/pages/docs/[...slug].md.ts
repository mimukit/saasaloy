// Each wiki page as raw Markdown, at /docs/<slug>.md, for an agent that reads Markdown
// better than HTML. `/docs/index.md` is the docs root. It is the wiki file, with one change:
// each relative link becomes absolute (lib/docs-links.ts `absolutizeMarkdown`), because a
// reader of /docs/x.md has no file tree to resolve `../y.md` against.
import type { APIRoute, GetStaticPaths } from "astro";

import { loadDocs } from "@web/lib/docs";
import type { DocsPage } from "@web/lib/docs-nav";
import { rawPage } from "@web/lib/docs-raw";

export const getStaticPaths = (async () => {
  const { items, pages } = await loadDocs();
  return items.map(({ page, entry }) => ({
    params: { slug: page.slug === "" ? "index" : page.slug },
    props: { page, pages, body: entry.body ?? "" },
  }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props, site }) => {
  const { page, pages, body } = props as {
    page: DocsPage;
    pages: DocsPage[];
    body: string;
  };
  return new Response(rawPage(page, body, pages, site?.origin ?? ""), {
    headers: { "content-type": "text/markdown; charset=utf-8" },
  });
};
