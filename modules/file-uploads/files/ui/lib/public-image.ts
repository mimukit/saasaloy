// The browser half of the image path: turn a public object URL into a resized one.
//
// It is the mirror of `publicImageUrl` in `apps/api/src/lib/file-uploads.ts`, split in two
// for the reason every block is split from its app: `packages/ui` imports React and ui
// primitives and nothing else, so it cannot read a Worker environment. The api reads
// `STORAGE_PUBLIC_URL` and `STORAGE_IMAGE_TRANSFORMS` and hands the block a finished URL
// plus one boolean; this function does the rest with no configuration of its own.
//
// Cloudflare image transformations are a URL prefix on the zone, not a second product and
// not a second copy of the bytes. That is why there is no `images` module.

/** Options Cloudflare image transformations understand. */
export interface ImageOptions {
  width?: number;
  height?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  format?: "auto" | "avif" | "webp" | "json";
  quality?: number;
}

/**
 * Insert `/cdn-cgi/image/<options>/` after the origin of a public object URL.
 *
 * With `enabled` false this returns `url` unchanged and ignores the options, which is the
 * default and the safe direction: the prefix 404s on a zone that has not turned
 * transformations on, and a broken `<img>` is worse than an unresized one.
 *
 * ```ts
 * imageUrl(row.url, { width: 96, height: 96, fit: "cover" }, transforms);
 * ```
 */
export function imageUrl(
  url: string,
  options: ImageOptions = {},
  enabled = false
): string {
  if (!enabled) {
    return url;
  }
  const spec = Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(",");
  if (spec.length === 0) {
    return url;
  }

  // Split on the first path segment rather than parsing: the caller's URL may be
  // root-relative in dev, and `new URL` needs a base for that case.
  const origin = originOf(url);
  return `${origin}/cdn-cgi/image/${spec}${url.slice(origin.length)}`;
}

/** Everything before the path, for an absolute URL; the empty string for a relative one. */
function originOf(url: string): string {
  const scheme = url.indexOf("://");
  if (scheme === -1) {
    return "";
  }
  const slash = url.indexOf("/", scheme + 3);
  return slash === -1 ? url : url.slice(0, slash);
}
