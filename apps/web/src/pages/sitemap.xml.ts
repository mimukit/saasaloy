// /sitemap.xml, prerendered at build time from `site` in astro.config.mjs. It lists the
// indexable pages by hand: today only the home page, since 404 and 500 are `noindex`.
// Add a page's path to PATHS when it ships, or move to `@astrojs/sitemap` once the site
// has more pages than this list can keep up with (exclude /404 and /500 there).

import type { APIRoute } from "astro";

const PATHS = ["/"];

export const GET: APIRoute = ({ site }) => {
  const urls = PATHS.map(
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
