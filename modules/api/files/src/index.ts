import { createLogger } from "@repo/logger";
import type { Logger } from "@repo/logger";
import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { HTTPException } from "hono/http-exception";
import { health } from "./routes/health";

// Bindings live on the Workers runtime and are threaded through Hono's context
// (`c.env`) — never `process.env`. Base `api` declares `CORS_ORIGINS` and the two logger
// vars (below); a capability or feature that adds a D1/R2/KV/Queue binding extends this
// type and patches wrangler.jsonc.
export interface Bindings {
  CORS_ORIGINS?: string;
  /** Which registered log provider writes. Optional — unset selects the only installed one. */
  LOGGER_PROVIDER?: string;
  /** Minimum level to emit: trace | debug | info | warn | error | fatal. Defaults to `info`. */
  LOG_LEVEL?: string;
}

// Request-scoped values set by middleware and read with `c.get(...)`. `log` is the
// correlated logger the middleware below binds to every request.
export interface Variables {
  log: Logger;
}

// Local dev origins for `apps/web` (Astro, :3000) and `apps/admin` (TanStack
// Router/Vite, :3001) — the keyless dev fallback so `wrangler dev`/`vite dev` works
// with zero config. Frontends get 3xxx, backends 4xxx (api is :4000); every dev server
// pins its port with `strictPort`, so these stay true instead of drifting to the next
// free port. Prod sets `CORS_ORIGINS` (comma-separated) explicitly; a misconfigured
// prod value fails visibly (CORS rejects the real origin) rather than silently
// falling back.
const DEV_ORIGINS = ["http://localhost:3000", "http://localhost:3001"];

// The one error body this api answers with: `{ error: { code, message } }`. It is the
// same envelope `@repo/validators`' `errorSchema` describes, written out here because
// api cannot import it — `validators` declares `dependsOn: ["api"]`, so the dependency
// runs one way only. Change one and change the other.
interface ErrorBody {
  error: { code: string; message: string };
}

// A short, stable code per status, so a caller branches on `error.code` instead of
// parsing prose. Anything unmapped falls back by class.
const ERROR_CODES: Record<number, string> = {
  400: "invalid_input",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  415: "unsupported_media_type",
  422: "invalid_input",
  429: "rate_limited",
};

function errorFor(status: number, message: string): ErrorBody {
  const code =
    ERROR_CODES[status] ?? (status >= 500 ? "internal_error" : "client_error");
  // `errorSchema` requires a non-empty message, and `new HTTPException(400)` carries an
  // empty one, so the code doubles as the fallback text.
  return { error: { code, message: message || code } };
}

// The pre-chain binding. Its type is written out on purpose: an explicit annotation
// freezes `base` at `Hono<{ Bindings: Bindings; Variables: Variables }>`, so anything
// mounted on `base` (app-wide middleware, `auth`'s catch-all handler) cannot widen
// `AppType`. Routes that a client must see go on the chain below instead.
//
// Both middlewares below are links in this chain rather than `base.use(...)` statements,
// and that is load-bearing. A `chained-route` patch targeting `base` appends to this
// initializer, so a statement form would leave the untyped mount registered *before*
// the middleware — Hono runs matched handlers in registration order, and the mounted
// handler answers first, so neither CORS nor the request logger would reach it.
//
// Credentialed CORS lives in api's spine — every cross-origin caller (the admin SPA,
// the waitlist form on the marketing site, auth's cookie-based session) shares the
// same origin allowlist, so it's a property of api's topology, not any one consumer's.
// `auth`'s `trustedOrigins` reuses this same `CORS_ORIGINS` var (one list, two readers,
// no drift).
//
// The second link is request correlation. Every route below reads the same logger with
// `c.get("log")`, and every line it writes carries this request's `requestId` — that is
// what turns a pile of log lines into a request you can follow.
//
// `cf-ray` first: it is the id Cloudflare's own dashboard, invocation logs and support
// tickets key on, so a line correlates with the platform's view of the same request for
// free. `crypto.randomUUID()` covers local dev, where there is no ray.
//
// An inbound `x-request-id` is deliberately **not** honored. It would trust a
// client-supplied value into an indexed field — anyone could collide with, or forge, a
// real request's id. A gateway that must propagate one should overwrite the header
// upstream, not have this Worker believe it.
export const base: Hono<{ Bindings: Bindings; Variables: Variables }> =
  new Hono<{
    Bindings: Bindings;
    Variables: Variables;
  }>()
    .use(
      "*",
      cors({
        credentials: true,
        origin: (
          origin,
          c: Context<{ Bindings: Bindings; Variables: Variables }>
        ) => {
          const configured = c.env.CORS_ORIGINS?.split(",")
            .map((o: string) => o.trim())
            .filter(Boolean);
          const allowed =
            configured && configured.length > 0 ? configured : DEV_ORIGINS;
          return origin && allowed.includes(origin) ? origin : null;
        },
      })
    )
    .use("*", async (c, next) => {
      const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
      c.set("log", createLogger(c.env).child({ requestId }));
      // `next` is Hono's downstream continuation, not a Node error-first callback; returning
      // it would end the middleware before the response phase.
      // oxlint-disable-next-line node/callback-return
      await next();
    })
    // Every thrown error leaves as the envelope, because some 4xx are thrown rather than
    // returned and would otherwise ship a different body than the route's own type says.
    // The malformed-JSON case is the one that bites: Hono's json validator throws
    // `HTTPException(400, "Malformed JSON in request body")` *before* a `zValidator`
    // failure hook runs, so without this handler a route that publishes an envelope on
    // 400 answers that path with plain text, and `hc`'s type lies.
    //
    // `onError` is a single slot rather than an ordered middleware, so it rides the same
    // chain for consistency and a patch that lands after it still gets the handler.
    //
    // A sub-app mounted with `.route()` inherits this handler as long as it sets no
    // `onError` of its own, so route modules need no error plumbing.
    .onError((err, c) => {
      if (err instanceof HTTPException) {
        return c.json(errorFor(err.status, err.message), err.status);
      }
      // An unexpected throw is logged in full and answered with a fixed message: the real
      // one can carry a binding value, a query, or a stack. `onError` can fire before the
      // correlation middleware ran (a throw from CORS), so fall back to an uncorrelated
      // logger rather than assuming `log` is set.
      const log = c.get("log") ?? createLogger(c.env);
      log.error("unhandled error", { err });
      return c.json(errorFor(500, "internal error"), 500);
    });

// The typed route chain. Every mounted route is one `.route()` link in a single
// expression, so `typeof app` carries each path, its input, and its response shape —
// that is what `hc<AppType>` reads. A module registers itself by patching one link in
// here (the `chained-route` patch kind), not by dropping a file into a scanned folder:
// a glob gives the chain no type to carry.
const app = base.route("/health", health);

// The contract consumers import. `@repo/api/client` re-exports this type and nothing
// else, so a browser bundle gets the routes without pulling the Worker entry in.
export type AppType = typeof app;

export default app;
