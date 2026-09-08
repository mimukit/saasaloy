import { MAINTENANCE_KEY } from "@repo/feature-flags";
import type { FlagsClient } from "@repo/feature-flags";
import type { Context, MiddlewareHandler, Next } from "hono";

// Maintenance mode: one reserved flag, one middleware, no second store and no second
// resolution path. `system.maintenance` is an ordinary boolean flag, so turning it on is the
// same toggle in the same screen as any other flag, and it lands in the same ~70 seconds.
//
// Unlike `rateLimit`, this one is meant to be app-wide, but the module still patches no
// `app.use`: which paths stay reachable during maintenance is a decision only the project
// can make. Wire it yourself in `apps/api/src/index.ts`, above the routes:
//
// ```ts
// import { maintenance } from "./middleware/maintenance";
// import { flagsFor, sessionIsAdmin } from "./lib/flags";
//
// app.use(
//   maintenance({
//     flags: flagsFor,
//     isAdmin: sessionIsAdmin,
//     bypassPaths: ["/health", "/auth"],
//   })
// );
// ```
//
// `flags` and `isAdmin` are injected rather than imported here, and that is deliberate:
// this file then imports nothing but a type from `@repo/feature-flags`, so the bypass rules
// are testable without a database, a session or a Cloudflare account.

/** What a 503 says, and the shape it is served in. */
export interface MaintenancePage {
  title: string;
  message: string;
}

export interface MaintenanceOptions {
  /** Builds the flag client for a request — `flagsFor` from `../lib/flags`. */
  flags: (c: Context) => Pick<FlagsClient<string>, "flag">;
  /**
   * Whether this caller bypasses the page. `sessionIsAdmin` from `../lib/flags` is the
   * intended answer; it reads the session and compares the role. Required, because an
   * "admin bypass" that silently defaulted to nobody would lock you out of your own api
   * during the one window you need it most.
   */
  isAdmin: (c: Context) => Promise<boolean>;
  /**
   * Path prefixes that stay reachable. Matched as a prefix, so `"/auth"` covers
   * `/auth/sign-in`. Health checks belong here: a load balancer that gets a 503 may pull the
   * Worker out of rotation and leave you with no way back in.
   */
  bypassPaths?: string[];
  /** Seconds for the `Retry-After` header. Default 300. */
  retryAfterSeconds?: number;
  /** Overrides the wording. The layout is fixed; this is the copy. */
  page?: MaintenancePage;
}

const DEFAULT_PAGE: MaintenancePage = {
  message:
    "We are making a short change and will be back in a few minutes. Nothing you saved has been lost.",
  title: "Down for maintenance",
};

/** Whether a request path is on the bypass list. Prefix match, and `/` matches only itself. */
export function isBypassPath(path: string, bypassPaths: string[]): boolean {
  return bypassPaths.some(
    (prefix) =>
      path === prefix ||
      (prefix !== "/" &&
        path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`))
  );
}

/**
 * Serve a 503 maintenance page while `system.maintenance` is on.
 *
 * Three ways past it, checked in this order: the path is on the bypass list, the flag is
 * off, or the caller is an admin. The path check comes first because it is free — no flag
 * read, no session read — and a health check firing every few seconds should not spend a KV
 * read each time.
 *
 * A failure to *resolve* the flag lets the request through. A store outage should not take
 * an api down on the assumption that somebody meant to close it, which is the same fail-open
 * reasoning `rateLimit` uses and for the same reason.
 */
export function maintenance(options: MaintenanceOptions): MiddlewareHandler {
  const {
    bypassPaths = [],
    flags,
    isAdmin,
    page = DEFAULT_PAGE,
    retryAfterSeconds = 300,
  } = options;

  return async function maintenanceMiddleware(c: Context, next: Next) {
    if (isBypassPath(c.req.path, bypassPaths)) {
      // oxlint-disable-next-line node/callback-return
      await next();
      return;
    }

    let closed: boolean;
    try {
      closed = await flags(c).flag(MAINTENANCE_KEY);
    } catch {
      // oxlint-disable-next-line node/callback-return
      await next();
      return;
    }

    if (!closed || (await isAdmin(c))) {
      // oxlint-disable-next-line node/callback-return
      await next();
      return;
    }

    return c.html(maintenanceHtml(page), 503, {
      "Cache-Control": "no-store",
      "Retry-After": String(retryAfterSeconds),
    });
  };
}

/**
 * The page itself, as one self-contained document.
 *
 * No stylesheet link and no script: during maintenance the rest of the deployment may be
 * mid-change, and a page that depends on another request to look right is a page that may
 * render as unstyled text at the worst moment.
 */
export function maintenanceHtml(page: MaintenancePage): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; min-height: 100dvh; display: grid; place-items: center;
        padding: 2rem; background: Canvas; color: CanvasText;
        font: 1rem/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
      }
      main { max-width: 32rem; text-align: center; }
      h1 { font-size: 1.375rem; font-weight: 600; letter-spacing: -0.01em; margin: 0 0 0.5rem; }
      p { margin: 0; opacity: 0.75; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(page.title)}</h1>
      <p>${escapeHtml(page.message)}</p>
    </main>
  </body>
</html>
`;
}

/** The copy is configurable, so it is escaped. */
function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
