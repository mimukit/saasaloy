// `@repo/cms/client`: what `apps/web` reads the cms through. It calls the api's public
// routes with `fetch` to `PUBLIC_API_URL` (no service binding, plan 0105 "Web to api"),
// behind a 60-second isolate cache that keeps 404s and redirects too.
//
// This subpath imports no Tiptap, no React and no Zod. Keep it that way: the web Worker
// bundles whatever this file reaches, and the renderer already ran in the api at publish.
// Types only cross from the rest of the package.

import { CMS_CACHE_TTL_SECONDS, createTtlCache } from "./cache";
import type { TtlCache } from "./cache";

export { CMS_CACHE_TTL_SECONDS, createTtlCache } from "./cache";
export type { TtlCache } from "./cache";
export { buildRss, buildSitemap, escapeXml, rfc822 } from "./feeds";
export type { RssChannel, RssItem, SitemapUrl } from "./feeds";
export {
  formatPostDate,
  indexPath,
  pageMeta,
  pagination,
  parsePageParam,
  postPath,
  showUpdated,
} from "./public-page";
export type { PageMeta, PageMetaInput, Pagination } from "./public-page";

/** An image in a public answer: the stored media value plus its public URL. */
export interface CmsPublicMedia {
  objectId: string;
  key: string;
  alt?: string;
  url: string | null;
}

/** One row of the public list. Dates are ISO strings. */
export interface CmsPublicListed {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  cover: CmsPublicMedia | null;
  authorName: string | null;
  publishedAt: string;
  /** The live revision's date. */
  updatedAt: string;
}

/** One published entry: the list row plus the stored html and the resolved SEO block. */
export interface CmsPublicEntry extends CmsPublicListed {
  html: string;
  seo: {
    metaTitle: string;
    metaDescription: string;
    ogImage: CmsPublicMedia | null;
  };
}

/** One page of the public list, newest `publishedAt` first. `pageCount` is at least 1. */
export interface CmsPublicPage {
  entries: CmsPublicListed[];
  page: number;
  pageCount: number;
  total: number;
}

/** What a read by slug finds: the entry, a 301 to its current slug, or nothing. */
export type CmsEntryResult =
  | { kind: "entry"; entry: CmsPublicEntry }
  | { kind: "redirect"; slug: string }
  | { kind: "missing" };

/** The api answered something the client cannot use. Never cached. */
export class CmsClientError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(url: string, status: number) {
    super(`The cms api answered ${status} for ${url}.`);
    this.name = "CmsClientError";
    this.status = status;
    this.url = url;
  }
}

export interface CmsClientOptions {
  /** The api origin, `PUBLIC_API_URL`. */
  apiUrl: string;
  /** Injected for tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** Injected for tests. Defaults to one cache per isolate, shared by every client. */
  cache?: TtlCache<unknown>;
  /** Seconds an answer stays cached. Defaults to 60; 0 turns the cache off. */
  ttlSeconds?: number;
}

export interface CmsClient {
  /** One page of a collection's published entries. Throws for an unknown collection. */
  list(collection: string, page: number): Promise<CmsPublicPage>;
  /** One published entry by slug. */
  entry(collection: string, slug: string): Promise<CmsEntryResult>;
}

// One cache per isolate, shared by every client the pages create per request.
const isolateCache = createTtlCache<unknown>();

function lastSegment(location: string | null): string | undefined {
  if (!location) {
    return undefined;
  }
  const path = location.split(/[?#]/)[0] ?? "";
  const segment = path.slice(path.lastIndexOf("/") + 1);
  return segment ? decodeURIComponent(segment) : undefined;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/** A client for the public cms routes. */
export function createCmsClient(options: CmsClientOptions): CmsClient {
  if (!options.apiUrl) {
    throw new Error(
      "createCmsClient needs the api origin. Set PUBLIC_API_URL for apps/web."
    );
  }
  const base = options.apiUrl.replace(/\/+$/, "");
  // Called as a plain function: workerd throws "Illegal invocation" when `fetch` runs as a
  // method of some other object.
  const doFetch: typeof fetch =
    options.fetch ?? ((input, init) => fetch(input, init));
  const cache = options.cache ?? isolateCache;
  const ttl = options.ttlSeconds ?? CMS_CACHE_TTL_SECONDS;

  async function cached<T>(url: string, load: () => Promise<T>): Promise<T> {
    const hit = cache.read(url);
    if (hit !== undefined) {
      return hit as T;
    }
    const value = await load();
    cache.write(url, value, ttl);
    return value;
  }

  function get(url: string): Promise<Response> {
    return doFetch(url, {
      headers: { accept: "application/json" },
      redirect: "manual",
    });
  }

  return {
    entry(collection, slug) {
      const url = `${base}/cms/${encodeURIComponent(collection)}/entries/${encodeURIComponent(slug)}`;
      return cached<CmsEntryResult>(url, async () => {
        const response = await get(url);
        if (response.status === 404) {
          return { kind: "missing" };
        }
        if (response.status === 301 || response.status === 308) {
          const body = (await readJson(response)) as
            { slug?: unknown } | undefined;
          const next =
            typeof body?.slug === "string"
              ? body.slug
              : lastSegment(response.headers.get("location"));
          if (!next) {
            throw new CmsClientError(url, response.status);
          }
          return { kind: "redirect", slug: next };
        }
        if (!response.ok) {
          throw new CmsClientError(url, response.status);
        }
        const body = (await response.json()) as { entry: CmsPublicEntry };
        return { entry: body.entry, kind: "entry" };
      });
    },
    list(collection, page) {
      const url = `${base}/cms/${encodeURIComponent(collection)}/entries?page=${page}`;
      return cached<CmsPublicPage>(url, async () => {
        const response = await get(url);
        if (!response.ok) {
          throw new CmsClientError(url, response.status);
        }
        return (await response.json()) as CmsPublicPage;
      });
    },
  };
}
