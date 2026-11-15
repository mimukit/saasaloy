// The rules the public blog pages share, kept out of the `.astro` files so they have
// tests: how a date reads, when the "Updated" line shows, which `?page=` values exist, the
// pager's links, and the meta tags with their fallbacks.

/** The post date locale. The admin's `cms-format.ts` uses the same one. */
const DATE_LOCALE = "en-GB";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "12 October 2026", read in UTC so every visitor and every isolate sees one day. */
export function formatPostDate(value: Date | string): string {
  return new Intl.DateTimeFormat(DATE_LOCALE, {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
    year: "numeric",
  }).format(toDate(value));
}

/** The UTC calendar day, "2026-10-12". */
function utcDay(value: Date | string): string {
  return toDate(value).toISOString().slice(0, 10);
}

/**
 * Whether the post shows "Updated <date>". `updatedAt` is the live revision's date, so it
 * moves on every publish. The line shows only when that lands on a later day than the
 * first publish: a same-day fix would print the same date twice.
 */
export function showUpdated(
  publishedAt: Date | string,
  updatedAt: Date | string
): boolean {
  return utcDay(updatedAt) !== utcDay(publishedAt);
}

/**
 * The `?page=` value as a page number. No parameter is page 1. Anything but a positive
 * whole number with no padding is `undefined`, and the page answers 404, so one list
 * has one address per page.
 */
export function parsePageParam(raw: string | null): number | undefined {
  if (raw === null) {
    return 1;
  }
  return /^[1-9]\d*$/.test(raw) ? Number(raw) : undefined;
}

/** A post's path: the base path and the encoded slug. */
export function postPath(basePath: string, slug: string): string {
  return `${basePath.replace(/\/+$/, "")}/${encodeURIComponent(slug)}`;
}

/** The address of one index page. Page 1 is the bare base path. */
export function indexPath(basePath: string, page: number): string {
  const base = basePath.replace(/\/+$/, "") || "/";
  return page <= 1 ? base : `${base}?page=${page}`;
}

/** The pager under the index: "Page N of M", and Newer and Older links when they exist. */
export interface Pagination {
  label: string;
  newer: string | null;
  older: string | null;
}

/** The pager, or `null` when the list fits on one page. */
export function pagination(input: {
  basePath: string;
  page: number;
  pageCount: number;
}): Pagination | null {
  const { basePath, page, pageCount } = input;
  if (pageCount <= 1) {
    return null;
  }
  return {
    label: `Page ${page} of ${pageCount}`,
    newer: page > 1 ? indexPath(basePath, page - 1) : null,
    older: page < pageCount ? indexPath(basePath, page + 1) : null,
  };
}

/** What `pageMeta` reads off a public entry. */
export interface PageMetaInput {
  title: string;
  excerpt: string;
  seo: {
    metaTitle: string;
    metaDescription: string;
    ogImage: { url: string | null } | null;
  };
}

/** The post page's `<title>`, description and Open Graph image. */
export interface PageMeta {
  title: string;
  description: string;
  image: string | null;
}

/**
 * The meta tags for a post. The api already resolves the fallbacks (meta title to title,
 * meta description to excerpt to body text, Open Graph image to cover); this keeps them if
 * a string arrives blank, and makes the image absolute, because a link preview cannot
 * resolve a relative URL.
 */
export function pageMeta(entry: PageMetaInput, siteUrl: string): PageMeta {
  const url = entry.seo.ogImage?.url;
  return {
    description: entry.seo.metaDescription.trim() || entry.excerpt,
    image: url ? new URL(url, siteUrl).href : null,
    title: entry.seo.metaTitle.trim() || entry.title,
  };
}
