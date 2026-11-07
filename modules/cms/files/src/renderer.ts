// Tiptap JSON to HTML, with no DOM. The api calls `renderRichText` once at publish and
// stores the result in `cms_revisions.html`, so `apps/web` serves a string and carries no
// Tiptap at all (plan 0105, the Renderer row).
//
// Two mappings replace Tiptap's own output:
//
//   - `link` keeps only an href `isSafeHref` accepts. A refused link renders its text with
//     no `<a>`, so a crafted api write cannot put a `javascript:` URL on the public site.
//   - `image` builds its URL from the stored storage key through `imageUrl`, which the api
//     backs with `publicImageUrl` from `@api/lib/file-uploads`. An image with no buildable
//     URL renders nothing rather than a broken `<img>`.
//
// `cms:rerender` calls the same function for every live revision, after a renderer upgrade
// or a `STORAGE_PUBLIC_URL` change.

import {
  renderToHTMLString,
  serializeAttrsToHTMLString,
  serializeChildrenToHTMLString,
} from "@tiptap/static-renderer/pm/html-string";
import type { Collection } from "./define";
import { cmsExtensions } from "./extensions";
import type { RichTextDocument } from "./fields";
import { isSafeHref } from "./links";

export interface RenderOptions {
  /**
   * The public URL for a storage key, or `undefined` when none can be built. The api passes
   * `(key) => publicImageUrl(env, key)`.
   */
  imageUrl: (key: string) => string | undefined;
}

const ABSOLUTE_WEB = /^\s*https?:/i;

/** The `src` for an image node: its storage key first, then a safe web `src`. */
function imageSource(
  attrs: Record<string, unknown>,
  options: RenderOptions
): string | undefined {
  const key = attrs.storageKey;
  if (typeof key === "string" && key.length > 0) {
    return options.imageUrl(key);
  }
  const { src } = attrs;
  // A pasted image with no storage key keeps its `src` only when it is a web URL. `mailto:`
  // and `tel:` are fine on a link and meaningless on an image.
  if (
    typeof src === "string" &&
    isSafeHref(src) &&
    !/^\s*(mailto|tel):/i.test(src)
  ) {
    return src;
  }
  return undefined;
}

/**
 * Render a stored body to HTML.
 *
 * Throws when the document names a node or mark the extension list does not know. The
 * collection's Zod schema checks the shape only, so the api calls this before it stores a
 * revision and turns a throw into a validation error.
 */
export function renderRichText(
  doc: RichTextDocument,
  options: RenderOptions
): string {
  if (!doc.content || doc.content.length === 0) {
    return "";
  }

  return renderToHTMLString({
    content: doc,
    extensions: cmsExtensions(),
    options: {
      markMapping: {
        link({ children, mark }) {
          const href: unknown = mark.attrs.href;
          const inner = serializeChildrenToHTMLString(children);
          if (typeof href !== "string" || !isSafeHref(href)) {
            return inner;
          }
          const rel = ABSOLUTE_WEB.test(href) ? "noopener noreferrer" : null;
          return `<a${serializeAttrsToHTMLString({ href, rel })}>${inner}</a>`;
        },
      },
      nodeMapping: {
        image({ node }) {
          const attrs = node.attrs as Record<string, unknown>;
          const src = imageSource(attrs, options);
          if (src === undefined) {
            return "";
          }
          const alt = typeof attrs.alt === "string" ? attrs.alt : "";
          const title =
            typeof attrs.title === "string" && attrs.title.length > 0
              ? attrs.title
              : null;
          return `<img${serializeAttrsToHTMLString({ src, alt, title, loading: "lazy" })}>`;
        },
      },
    },
  });
}

/**
 * The HTML a revision stores: the collection's first `richText` field, rendered. A
 * collection with no rich-text field, or an entry with an empty one, stores "".
 *
 * `data` must already have passed the collection's `dataSchema`.
 */
export function renderCollectionHtml(
  collection: Collection,
  data: unknown,
  options: RenderOptions
): string {
  const key = Object.keys(collection.fields).find(
    (name) => collection.fields[name]?.kind === "richText"
  );
  if (key === undefined || typeof data !== "object" || data === null) {
    return "";
  }
  const doc = (data as Record<string, unknown>)[key];
  if (doc === undefined || doc === null) {
    return "";
  }
  return renderRichText(doc as RichTextDocument, options);
}
