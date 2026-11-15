// The `blog` collection this module ships. `saasaloy add cms` registers it by appending
// `blogCollection()` to the collections array in `src/index.ts`.
//
// This file is the module's, and `saasaloy update` may rewrite it. To change the blog's
// fields, copy it into a file of your own, register that factory instead, and remove this
// one from the array.

import { defineCollection } from "../define";
import { media, richText, seo, slug, text } from "../fields";

/** The longest excerpt. An empty excerpt falls back to the first 160 characters of the body. */
export const EXCERPT_MAX = 300;

export function blogCollection() {
  return defineCollection({
    fields: {
      title: text({ label: "Title", maxLength: 200, required: true }),
      slug: slug({
        help: "Changing the slug of a live post redirects the old address to the new one.",
      }),
      body: richText({ label: "Body", required: true }),
      cover: media({ label: "Cover image" }),
      excerpt: text({
        help: "Shown on the blog index and in feeds. Leave it empty to use the start of the body.",
        label: "Excerpt",
        maxLength: EXCERPT_MAX,
        multiline: true,
        placement: "side",
      }),
      seo: seo({
        help: "Empty fields fall back to the title, the excerpt and the cover.",
      }),
    },
    label: "Blog",
    name: "blog",
    singular: "Post",
  });
}
