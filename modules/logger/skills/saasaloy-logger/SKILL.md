---
name: saasaloy-logger
description: Runbook for the logger capability — structured, level-controlled, request-correlated logging from packages/logger with per-provider modules (logger-console). Use when logging from a route or a worker, reading logs with wrangler tail or Workers Logs, setting LOG_LEVEL or LOGGER_PROVIDER, correlating lines by request id, understanding what redaction catches, or writing a custom log provider.
---

# logger — structured logging from `packages/logger`

`packages/logger` (`@repo/logger`) is the capability core: six levels, a level threshold, child
loggers for correlation, error serialization, key-based redaction, and a **provider registry**. It
has **zero runtime dependencies**. Each provider ships as its own module — today just
`logger-console` — dropping one file into `src/providers/` and registering itself in the array in
`src/index.ts`.

> **`logger-console` is the production default, not a dev stand-in.** It shares a naming pattern
> with `email-console` and means the opposite. On Cloudflare Workers `console.*` *is* the log
> pipeline: Workers Logs ingests it and `wrangler tail` streams it. `email-console` logs a message
> instead of sending it and must never be deployed; `logger-console` writes structured objects to
> the platform's own sink and is what you ship.

Callers import `@repo/logger`, or read `c.get("log")` in a route, and never learn which provider is
active.

## Log from a route

`api`'s spine already mounts the correlation middleware, so a route just reads the logger off the
context. Compose `LoggerVariables` into the sub-app's generic to type it — a route can't import
`apps/api/src/index.ts`'s own `Variables` type, because the entry globs the routes and that would
be a cycle.

```ts
// apps/api/src/routes/widgets.ts
import { Hono } from "hono";
import type { LoggerVariables } from "@repo/logger";

const widgets = new Hono<{ Variables: LoggerVariables }>();

widgets.post("/", async (c) => {
  const log = c.get("log");

  log.info("creating widget", { plan: "pro", seats: 5 });

  try {
    // …
  } catch (err) {
    log.error("widget creation failed", { err });
    return c.json({ error: "internal" }, 500);
  }

  return c.json({ ok: true });
});

export default widgets;
```

The import is `@repo/logger` — the real package name — not `@logger/...`. `@logger` is only the
**file-placement alias** `saasaloy.json` uses to resolve a module's `files[].target` when copying
files onto disk; it is not a TypeScript or Vite import alias.

### `c.get("log")` vs `createLogger(c.env)`

| | what you get | use it |
|---|---|---|
| `c.get("log")` | the request's logger, already carrying `requestId` | in any route or route middleware |
| `createLogger(env)` | a fresh, **uncorrelated** logger | outside a request — a module-scope singleton, `scheduled()`, a queue consumer |

`createLogger(env)` takes the **whole env**, not one binding, because which key the active provider
reads is precisely what a caller isn't supposed to know. Calling it inside a route works but throws
away the request id, which is the one thing that makes a line findable — reach for `c.get("log")`
there.

### The call shape: message first

```ts
log.info("widget created", { widgetId, plan });
```

Message first, fields second — deliberately **not** pino's `log.info(obj, msg)`, which is an
artifact of its printf history. There is no `%s` interpolation: compose the string yourself, and
put values in `fields`, where a log sink can index them.

Six levels, in order: `trace` · `debug` · `info` · `warn` · `error` · `fatal`. `fatal` has no
distinct behaviour on Workers — nothing exits the process — but it exists so a project that wants
it doesn't have to patch the core's type.

### Correlation with `child()`

`log.child(fields)` returns a logger with those fields merged into every event it writes. This is
the whole correlation mechanism, and `apps/api`'s middleware is one use of it:

```ts
const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
c.set("log", createLogger(c.env).child({ requestId }));
```

`cf-ray` first because it is the id Cloudflare's dashboard, invocation logs and support tickets key
on, so your line correlates with the platform's view of the same request for free; the UUID covers
local dev, where there is no ray. An inbound **`x-request-id` is deliberately not honored** — it
would trust a client-supplied value into an indexed field, letting anyone forge or collide with a
real request's id. If a gateway in front of the Worker must propagate one, have the gateway
overwrite the header, not this Worker believe it.

Bind more context the same way, for a unit of work inside a request:

```ts
const jobLog = c.get("log").child({ jobId, tenantId }); // every line below carries all three
```

Call-site fields win over bound ones on a key collision.

### Errors

Pass an `Error` as the `err` field. The core flattens it to `{ name, message, stack, cause? }`
before any provider sees it:

```ts
log.error("charge failed", { err, invoiceId });
```

This matters more than it looks. `name`, `message` and `stack` are all non-enumerable, so
`JSON.stringify(new Error("boom"))` is `{}` — an error logged without serialization arrives as an
empty object. `cause` is followed **exactly one level**; a cause chain can be long or cyclic, and an
unbounded walk is CPU the request pays for. A non-`Error` `err` (a string, a status object) is left
in `fields` untouched rather than invented into an error shape.

There is no error class of this package's own, and `logger` never throws from a log call: a
provider's `write` failure is caught and swallowed. A logger that takes down a request is a
self-inflicted outage.

## Env checklist (`add logger` prints this)

| Var | What | Required |
|---|---|---|
| `LOGGER_PROVIDER` | Which registered provider writes: `console`, … | **No** — unset selects the only installed provider |
| `LOG_LEVEL` | Threshold: `trace` \| `debug` \| `info` \| `warn` \| `error` \| `fatal` | No — defaults to `info` |

**`LOGGER_PROVIDER` is optional on purpose, and this diverges from `EMAIL_PROVIDER` deliberately.**
Email has no default because a production deploy that silently stops sending is invisible. Logging
is the opposite: its absence is its own alarm, and throwing at boot would mean the observability
layer caused the outage. So unset falls back to the first registered provider, no providers at all
yields a silent no-op logger, and only a `LOGGER_PROVIDER` naming a provider that **isn't**
registered throws — that one is unambiguously a typo in a deploy config.

An unrecognized `LOG_LEVEL` falls back to `info` silently, for the same reason.

## Reading the logs

```sh
pnpm --filter @repo/api dev   # vite dev → events print to your terminal as objects
wrangler tail                 # a deployed Worker, live
```

In the Cloudflare dashboard, **Workers & Pages → your Worker → Logs** queries the same stream.
`apps/api/wrangler.jsonc` ships the block that turns it on:

```jsonc
"observability": {
  "enabled": true,
  "head_sampling_rate": 1
}
```

`head_sampling_rate` is the **cost dial** — `1` keeps every invocation, `0.1` keeps a tenth. Drop it
per environment (`env.production.observability`) if log volume starts to matter. Sampling is a
platform feature; the logger deliberately ships no knob that would duplicate it worse.

**`LOG_LEVEL` filters before anything is written**, so a line below the threshold costs nothing and
never reaches Workers Logs at all — it is a source-side control, not a dashboard filter. Set
`LOG_LEVEL=debug` in dev; leave production on `info` unless you are chasing something.

> [!TIP]
> Log **objects, never pre-stringified JSON**. `log.info("charged", { userId })` reaches Workers
> Logs as queryable fields; folding the value into the message (`log.info("charged " + userId)`)
> leaves you with a text search. Individual logs cap at **256 KB** and get flagged
> `truncated: true` past it, so keep `fields` small — don't log a whole request body.

## Providers

| Module | Provider name | Needs | Writes to |
|---|---|---|---|
| `logger-console` | `console` | nothing | `console.warn` / `console.error` / `console.log` by level — the Workers Logs pipeline |

`logger-console` arrives automatically: `api` declares `dependsOn: ["logger", "logger-console"]`, so
`saasaloy add api` installs all three. Installing another provider later is the same command again;
the codemod appends to the `providers` array idempotently, so several can be registered at once and
`LOGGER_PROVIDER` picks between them per environment.

## Redaction: what it catches, and what it does not

Redaction is **on by default**. Retrofitting it after call-site habits exist is the harder order, so
the core does it for every event.

**Caught** — a field whose key matches the deny-list, case-insensitively and exactly:
`authorization`, `cookie`, `set-cookie`, `token`, `password`, `secret`, `api_key`. The value becomes
the string `[redacted]`. The walk covers the top level of `fields` **and one level below it**.

**Not caught** — and each of these is a real way to leak a secret:

- **A key that isn't an exact match.** `authorizationHeader`, `apiKey`, `access_token` are all
  missed. Extend the list per project (below) rather than assuming a substring match.
- **Anything nested more than one level deep.** `{ a: { b: { token } } }` keeps its token. The bound
  is on purpose: an unbounded deep walk is CPU on every log call.
- **Anything that isn't a plain object.** A `Headers`, a `Request`, a `Date`, a class instance, an
  array of objects — all pass through whole. Pull the fields you want out first.
- **Secrets in the message string, or in a serialized error's `message`/`stack`.** Redaction is
  key-based; it never inspects text.

Extend the deny-list in `packages/logger/src/index.ts` — `redact` **unions** with the built-in list
rather than replacing it:

```ts
export const logger = defineLogger({
  providers: [],
  redact: ["apiKey", "access_token", "refresh_token", "session"],
});
```

Redaction is a backstop against an accidental spread (`log.info("req", { ...headers })`), not a
licence to log credentials. Don't put a secret in `fields` and rely on the list to catch it.

## Writing a custom provider in your own project

You don't need a registry module to add a provider — a file and a line will do. Implement
`LogProvider` in `packages/logger/src/providers/<name>.ts`:

```ts
import type { LoggerEnv, LogEvent, LogProvider } from "../provider";

export function axiom(): LogProvider {
  return {
    name: "axiom", // the value LOGGER_PROVIDER must hold
    write(env: LoggerEnv, event: LogEvent): void {
      // Synchronous, returning void. Batch or ship in the background yourself; see below.
      void fetch("https://api.axiom.co/v1/datasets/logs/ingest", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${String(env.AXIOM_TOKEN ?? "")}`,
        },
        body: JSON.stringify([event]),
        signal: AbortSignal.timeout(5_000),
      }).catch(() => {
        // Never let a shipping failure reach the caller. The core swallows throws, but a
        // rejected promise from an un-awaited fetch is yours to handle.
      });
    },
  };
}
```

Then register it by hand in `src/index.ts`:

```ts
// Add the import; `defineLogger` is already imported at the top of this file.
import { axiom } from "./providers/axiom";

// Then add the call to the existing array literal — don't replace the line's shape.
export const logger = defineLogger({ providers: [axiom()] });
```

Contract notes:

- **The event arrives normalized.** The level threshold has already been applied, bound and
  call-site fields are already merged, redaction has already run, `time` is stamped, and an `Error`
  passed as `err` is already `{ name, message, stack, cause? }`. Don't redo any of it.
- **`write` is synchronous and returns `void`**, unlike `EmailProvider.send`. A log call is not
  something a caller awaits, and an async `write` would either force `await log.info(...)`
  everywhere or leak a floating promise on a Worker that may be killed before it settles. There is
  no `ExecutionContext` argument today; widening to `createLogger(env, ctx?)` → `write(env, event,
  ctx?)` later is non-breaking for providers written against this signature.
- **A remote sink needs its own batching.** One `fetch` per log line is a subrequest per line, and
  Workers cap subrequests per invocation. Buffer in the provider and flush.
- **There is no error type to normalize into.** The core catches and swallows whatever `write`
  throws — deliberately, because a logger that throws is a self-inflicted outage. That also means
  a broken provider is *silent*: test it.
- **`name` is the `LOGGER_PROVIDER` value**, unique across providers. It need not match the exported
  factory — `logger-console`'s factory is `consoleLogger` precisely so the generated import can't
  shadow the global `console`.
- **Read secrets off the `env` argument**, never `process.env` (it doesn't exist on Workers), and
  declare each one in the descriptor's `envVars` if you package it as a module.
- Any npm dependency belongs in `packages/logger/package.json`, not in another workspace — only this
  package touches provider SDKs (ADR 0020).

## Boundaries to honor

- **`export const logger = defineLogger({ providers: [] })` stays in exactly that shape** — a real
  array literal, never omitted. It is the patch point every provider module appends to; without it
  a provider install fails silently.
- **`c.get("log")` in a route, never `console.log`.** A bare console call is unlevelled,
  uncorrelated, and skips redaction.
- **Message first, values in `fields`.** Interpolated values can't be queried.
- **Only `packages/logger` talks to a provider's SDK.** Everything else imports `@repo/logger`
  (ADR 0020).
- **A log call never throws and never blocks.** Don't add an `await`, a retry, or a `throw` to a
  provider's `write`.
- **`logger-console` is production.** Don't swap it out for "something real" — on Workers it *is*
  the real one.
