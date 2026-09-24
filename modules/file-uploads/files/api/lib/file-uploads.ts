import type { StorageEnv } from "@repo/storage";

// The wiring, and the only file in this feature that knows whether a project has a tenant
// concept at all.
//
// Three jobs: resolve the tenant id every route and every key is scoped by, build the two
// public URLs, and hold the two key scopes so no route spells either of them by hand.

/** The scope segment of a private upload's key. */
export const PRIVATE_SCOPE = "uploads";
/**
 * The scope segment of a public upload's key.
 *
 * The public marker lives here rather than in a leading `public/` prefix because
 * `assertValidKey` pins a key to five segments starting with a literal `t`
 * (`packages/storage/src/keys.ts`), and a sixth segment is not buildable without changing
 * the capability. `public-uploads` rather than `public` keeps the what-it-is-for fact in
 * the segment, so a later `public-exports` needs no second decision.
 */
export const PUBLIC_SCOPE = "public-uploads";

/** The tenant id a project with no tenant concept writes every key under. */
export const DEFAULT_TENANT = "default";

/** What a `file-uploads` route needs on `c.env`, on top of the database binding. */
export interface FileUploadsEnv extends StorageEnv {
  /**
   * Origin a public object is served from — the R2 custom domain in production, the api's
   * own origin in dev. **Unset means public uploads are refused**, by name, at
   * `POST /files/uploads`. There is no fallback in either direction: guessing an origin
   * would hand out URLs that 404, and silently downgrading to `private` would store a
   * file the uploader believes is shareable.
   */
  STORAGE_PUBLIC_URL?: string;
  /**
   * `"true"` when Cloudflare image transformations are enabled on the zone serving
   * `STORAGE_PUBLIC_URL`. Default off, because the `/cdn-cgi/image/` prefix 404s on a zone
   * that has not turned them on, and a broken `<img>` is worse than an unresized one.
   */
  STORAGE_IMAGE_TRANSFORMS?: string | boolean;
  /** Days a `deleted` row is kept before the sweep purges it. Defaults to 30. */
  STORAGE_PURGE_AFTER_DAYS?: string | number;
}

/**
 * The slice of a session this feature reads.
 *
 * Structural, and that is the whole mechanism behind `resolveTenant`. `multitenant` ships
 * `requireTenant` in `packages/auth`, so this module cannot import it — the file is not
 * there in a project without that module, and a dynamic import of a path the bundler
 * cannot resolve fails the build rather than the call. What *is* always there is the
 * session's `activeOrganizationId` column, declared nullable in `@db/schema/auth.ts` by
 * the `auth` module itself. Reading it needs no import and no branch on what is installed.
 *
 * `session.id` is listed only to keep this from being a weak type. With every property
 * optional, TypeScript's weak-type check refuses a real Better Auth session for having no
 * property in common with it.
 */
export interface TenantSession {
  session: { id: string; activeOrganizationId?: string | null };
  user: { id: string };
}

/**
 * The tenant id this request acts for.
 *
 * The active organization under `multitenant`, and the literal `default` otherwise. This
 * is the only place in the module that knows the difference, and every key and every query
 * takes its answer.
 *
 * A project that adds `multitenant` later keeps its existing objects under `t/default/`,
 * where they still resolve. Nothing migrates them: a key cannot be rewritten, and any
 * other choice orphans the bytes.
 *
 * This is weaker than `forTenant`, which wraps the query builder so a cross-tenant read
 * cannot be written. The trade is deliberate — depending on `multitenant` would make
 * organizations a precondition for uploading a file. What carries the guarantee instead is
 * `@repo/db/repositories/objects` being the only read path.
 */
export function resolveTenant(session: TenantSession): string {
  const active = session.session.activeOrganizationId;
  return typeof active === "string" && active.length > 0
    ? active
    : DEFAULT_TENANT;
}

/** True when `STORAGE_IMAGE_TRANSFORMS` says the zone can serve `/cdn-cgi/image/`. */
export function imageTransformsEnabled(env: FileUploadsEnv): boolean {
  const raw = env.STORAGE_IMAGE_TRANSFORMS;
  return raw === true || raw === "true" || raw === "1";
}

/**
 * The world-readable URL for a public object's key, or `undefined` when
 * `STORAGE_PUBLIC_URL` is unset.
 *
 * The key is appended verbatim, all five segments of it. Rewriting the path in dev is
 * exactly the bug this arrangement would otherwise hide: the same record has to resolve
 * identically through the R2 custom domain and through this module's own
 * `GET /files/public/*`, and the two URLs differ only in origin.
 */
export function publicUrl(
  env: FileUploadsEnv,
  key: string
): string | undefined {
  const origin = env.STORAGE_PUBLIC_URL;
  if (typeof origin !== "string" || origin.length === 0) {
    return;
  }
  return `${trimSlash(origin)}/${key}`;
}

/** True when a public object can be given a URL at all. The gate on a public upload. */
export function hasPublicUrl(env: FileUploadsEnv): boolean {
  return (
    typeof env.STORAGE_PUBLIC_URL === "string" &&
    env.STORAGE_PUBLIC_URL.length > 0
  );
}

/** Options Cloudflare image transformations understand. Ignored when they are off. */
export interface ImageOptions {
  width?: number;
  height?: number;
  fit?: "scale-down" | "contain" | "cover" | "crop" | "pad";
  format?: "auto" | "avif" | "webp" | "json";
  quality?: number;
}

/**
 * The URL for a public image, resized on the way out when the zone can do it.
 *
 * With `STORAGE_IMAGE_TRANSFORMS` off this returns `publicUrl(env, key)` unchanged and
 * ignores the options, so a project that never enables transformations still renders every
 * image. That is the default, and it is the reason there is no `images` module: the bytes
 * are already in R2, and a variant is a URL prefix on the zone rather than a second copy in
 * a second product.
 */
export function publicImageUrl(
  env: FileUploadsEnv,
  key: string,
  options: ImageOptions = {}
): string | undefined {
  const url = publicUrl(env, key);
  if (url === undefined || !imageTransformsEnabled(env)) {
    return url;
  }
  const spec = imageSpec(options);
  if (spec.length === 0) {
    return url;
  }
  return `${trimSlash(env.STORAGE_PUBLIC_URL ?? "")}/cdn-cgi/image/${spec}/${key}`;
}

/** `width=96,height=96,fit=cover` — Cloudflare's own comma-separated option list. */
function imageSpec(options: ImageOptions): string {
  return Object.entries(options)
    .filter(([, value]) => value !== undefined)
    .map(([name, value]) => `${name}=${String(value)}`)
    .join(",");
}

function trimSlash(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}
