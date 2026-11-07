// Plain-text helpers for the fallbacks the plan settled: an empty excerpt uses the first 160
// characters of the body, an empty meta title uses the title, and an empty Open Graph image
// uses the cover. The api calls them when it builds a public entry, so `apps/web` never
// walks a Tiptap document.

import type {
  MediaValue,
  RichTextDocument,
  RichTextNode,
  SeoValue,
} from "./fields";

/** The length the excerpt fallback cuts the body text to, the ellipsis included. */
export const EXCERPT_FALLBACK_LENGTH = 160;

const BLOCK_SEPARATOR = " ";

function textOf(node: RichTextNode): string {
  if (node.type === "text") {
    return node.text ?? "";
  }
  if (node.type === "hardBreak") {
    return " ";
  }
  const inner = (node.content ?? []).map(textOf);
  // An inline container (a paragraph, a heading) joins its children directly; a block
  // container (a list, a quote) separates its blocks.
  const inline = (node.content ?? []).some(
    (child) => child.type === "text" || child.type === "hardBreak"
  );
  return inner.join(inline ? "" : BLOCK_SEPARATOR);
}

/** The visible text of a document, blocks separated by one space, whitespace collapsed. */
export function plainText(doc: RichTextDocument | undefined): string {
  if (!doc?.content) {
    return "";
  }
  return doc.content
    .map(textOf)
    .join(BLOCK_SEPARATOR)
    .replaceAll(/\s+/g, " ")
    .trim();
}

function present(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

/**
 * The excerpt a list shows: the manual one when it has text, else the body's first 160
 * characters. A cut body ends in "…" inside those 160 characters.
 */
export function excerptOf(input: {
  excerpt?: string;
  body?: RichTextDocument;
}): string {
  const manual = present(input.excerpt);
  if (manual) {
    return manual;
  }
  const body = plainText(input.body);
  if (body.length <= EXCERPT_FALLBACK_LENGTH) {
    return body;
  }
  return `${body.slice(0, EXCERPT_FALLBACK_LENGTH - 1).trimEnd()}…`;
}

/** The resolved SEO values a page renders: every override, or its fallback. */
export interface ResolvedSeo {
  metaTitle: string;
  metaDescription: string;
  ogImage: MediaValue | null;
}

/**
 * Resolve the SEO block. Meta title falls back to the title, meta description to the
 * excerpt (which itself falls back to the body), and the Open Graph image to the cover.
 */
export function seoFallbacks(input: {
  title: string;
  excerpt: string;
  cover?: MediaValue | null;
  seo?: SeoValue;
}): ResolvedSeo {
  return {
    metaDescription: present(input.seo?.metaDescription) ?? input.excerpt,
    metaTitle: present(input.seo?.metaTitle) ?? input.title,
    ogImage: input.seo?.ogImage ?? input.cover ?? null,
  };
}
