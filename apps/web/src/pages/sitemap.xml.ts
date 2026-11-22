// /sitemap.xml, prerendered at build time from `site` in astro.config.mjs. It lists the
// indexable pages: the home page by hand, since 404 and 500 are `noindex`, and every docs
// page from the same collection that renders /docs, so a new wiki page joins the sitemap
// with no edit here. Add another page's path to PATHS when it ships, or move to
// `@astrojs/sitemap` once the site has more pages than this list can keep up with (exclude
// /404 and /500 there).

import type { APIRoute } from "astro";

import { loadDocs } from "@web/lib/docs";
import { uiBlocks } from "@web/lib/ui-registry";

// The Saasaloy UI index, the themes page and each block page. The preview frames are `noindex`.
const PATHS = [
  "/",
  "/ui",
  "/ui/themes",
  ...uiBlocks().map((block) => `/ui/blocks/${block.name}`),
];

export const GET: APIRoute = async ({ site }) => {
  const { pages } = await loadDocs();
  const urls = [...PATHS, ...pages.map((page) => page.url)].map(
    (path) => `  <url>\n    <loc>${new URL(path, site).href}</loc>\n  </url>`
  );
  const body = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    ...urls,
    `</urlset>`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
};
