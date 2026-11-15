// The blog's sitemap, installed by `saasaloy add cms`: the index and every published post.
// On demand, like the pages. The base ships no site-wide sitemap; point robots.txt or a
// sitemap index at this one if you add one.
import { buildSitemap, postPath } from "@repo/cms/client";
import type { SitemapUrl } from "@repo/cms/client";
import { config } from "@repo/config";
import { webEnv } from "@web/env";
import { BLOG_COLLECTION, cmsClient } from "@web/lib/cms";
import type { APIRoute } from "astro";

export const prerender = false;

// A guard on the page walk. At the default 10 posts a page it covers 5,000 posts, well
// inside the protocol's 50,000 URLs per file.
const MAX_PAGES = 500;

export const GET: APIRoute = async () => {
  const site = webEnv().PUBLIC_SITE_URL;
  const { basePath } = config.cms;
  const client = cmsClient();
  const urls: SitemapUrl[] = [];
  let pageCount = 1;
  for (let page = 1; page <= Math.min(pageCount, MAX_PAGES); page += 1) {
    const list = await client.list(BLOG_COLLECTION, page);
    ({ pageCount } = list);
    for (const post of list.entries) {
      urls.push({
        lastmod: post.updatedAt,
        loc: new URL(postPath(basePath, post.slug), site).href,
      });
    }
  }
  const index: SitemapUrl = {
    loc: new URL(basePath, site).href,
    ...(urls[0] ? { lastmod: urls[0].lastmod } : {}),
  };
  return new Response(buildSitemap([index, ...urls]), {
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "application/xml; charset=utf-8",
    },
  });
};
