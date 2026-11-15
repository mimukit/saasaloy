import { createCmsClient } from "@repo/cms/client";
import type { CmsClient } from "@repo/cms/client";
import { webEnv } from "@web/env";

// The blog's shared pieces on `apps/web`, installed by `saasaloy add cms`: the client the
// pages read the cms through, the words they show, and the prose styles for the stored
// html.
//
// The pages live at `src/pages/blog/`, and Astro routes by file name. `config.cms.basePath`
// builds every link the pages write, so if you move the blog, rename that folder and the
// config value in the same edit.

/** The cms client over `PUBLIC_API_URL`. Every client shares the isolate's 60-second cache. */
export function cmsClient(): CmsClient {
  return createCmsClient({ apiUrl: webEnv().PUBLIC_API_URL });
}

/** The collection the blog pages read. */
export const BLOG_COLLECTION = "blog";

/** Every word the blog pages show. `{siteName}` is filled in by the page. */
export const blogCopy = {
  title: "Blog",
  lead: "Notes on building and running {siteName}.",
  empty: "No posts yet. The first one shows here once it is published.",
  pagerLabel: "Pages",
  newer: "Newer posts",
  older: "Older posts",
  allPosts: "All posts",
  updated: "Updated",
  rssLabel: "RSS feed",
} as const;

/**
 * The look of the api's stored html, hand-written rather than a typography plugin. Tokens
 * only: the type ramp, `muted`, `border` and the radius scale from `apps/web/DESIGN.md`.
 * It styles what the renderer emits: paragraphs, h2 and h3, lists, quotes, inline code,
 * code blocks, links and images.
 */
export const PROSE = [
  // `wrap-anywhere`: a long unbroken word or a bare URL wraps, so a phone never scrolls
  // sideways. A code block keeps its own horizontal scroll.
  "text-base leading-7 wrap-anywhere md:text-lg md:leading-8",
  "[&>*+*]:mt-6",
  "[&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:tracking-tight md:[&_h2]:text-3xl",
  "[&_h3]:mt-10 [&_h3]:text-xl [&_h3]:font-semibold [&_h3]:tracking-tight",
  "[&_a]:font-medium [&_a]:underline [&_a]:underline-offset-4",
  "[&_ul]:list-disc [&_ol]:list-decimal [&_ul]:ps-6 [&_ol]:ps-6 [&_li+li]:mt-2 [&_li]:ps-1",
  "[&_blockquote]:border-s-2 [&_blockquote]:ps-5 [&_blockquote]:text-muted-foreground [&_blockquote]:italic",
  "[&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:rounded-md [&_:not(pre)>code]:px-1.5 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-[0.875em]",
  "[&_pre]:bg-muted [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:px-5 [&_pre]:py-4 [&_pre]:font-mono [&_pre]:text-sm [&_pre]:leading-6",
  "[&_img]:bg-muted [&_img]:h-auto [&_img]:w-full [&_img]:rounded-xl [&_img]:border",
  "[&_hr]:border-border [&_hr]:my-12",
].join(" ");
