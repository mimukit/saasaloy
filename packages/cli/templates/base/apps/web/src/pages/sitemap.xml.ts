import type { APIRoute } from "astro";
import { sitemapXml } from "../lib/sitemap";

// The sitemap, built at build time from the pages in this folder, so a new page joins it
// with no edit here. public/robots.txt names it. The page rules, and the list of what stays
// out, live in src/lib/sitemap.ts.
//
// A hand-written endpoint rather than @astrojs/sitemap keeps the dependency count down for
// a site of a few pages. Move to the integration when the page count grows.
export const GET: APIRoute = ({ site }) => {
  if (site === undefined) {
    throw new Error("Set `site` in astro.config.mjs; the sitemap needs it.");
  }
  const files = Object.keys(import.meta.glob("./**/*.astro"));
  return new Response(sitemapXml(files, site), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
};
