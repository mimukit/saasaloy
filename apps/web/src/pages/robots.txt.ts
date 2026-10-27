// /robots.txt, prerendered at build time. An endpoint rather than a file in public/, so
// the `Sitemap:` line takes its origin from `site` in astro.config.mjs and never drifts.
//
// One group allows every crawler, search, AI search, user-triggered retrieval and
// training alike: an open source project wants to be cited, and developers ask
// assistants to read its pages for them. To opt out of model training, add a group per
// training agent (`GPTBot`, `ClaudeBot`, `CCBot`) with `Disallow: /`.

import type { APIRoute } from "astro";

export const GET: APIRoute = ({ site }) => {
  const sitemap = new URL("/sitemap.xml", site).href;
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${sitemap}`,
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
};
