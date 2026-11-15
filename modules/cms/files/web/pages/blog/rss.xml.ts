// The blog's RSS 2.0 feed, installed by `saasaloy add cms`. On demand, so a publish shows
// here within the client's 60-second cache. It carries the newest page of posts,
// `config.cms.pageSize` of them, with the channel title and description from the `cms`
// config section.
import { buildRss, postPath } from "@repo/cms/client";
import { config } from "@repo/config";
import { webEnv } from "@web/env";
import { BLOG_COLLECTION, cmsClient } from "@web/lib/cms";
import type { APIRoute } from "astro";

export const prerender = false;

export const GET: APIRoute = async () => {
  const site = webEnv().PUBLIC_SITE_URL;
  const { basePath, rssDescription, rssTitle } = config.cms;
  const list = await cmsClient().list(BLOG_COLLECTION, 1);
  const xml = buildRss({
    description: rssDescription,
    feedUrl: new URL(`${basePath}/rss.xml`, site).href,
    items: list.entries.map((post) => ({
      description: post.excerpt,
      link: new URL(postPath(basePath, post.slug), site).href,
      pubDate: post.publishedAt,
      title: post.title,
    })),
    language: config.app.locale,
    link: new URL(basePath, site).href,
    title: rssTitle,
  });
  return new Response(xml, {
    headers: {
      "cache-control": "public, max-age=60",
      "content-type": "application/rss+xml; charset=utf-8",
    },
  });
};
