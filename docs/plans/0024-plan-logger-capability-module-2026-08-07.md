# Plan — `logger` capability module

**Grilled:** 2026-08-07

**Issue:** [#66](https://github.com/mimukit/saasaloy/issues/66) · **Created:** 2026-08-07 · **Status:** hardened

## Context

Generated apps have no logging story. `apps/api` writes nothing; a route that wants to say something reaches for `console.log` and gets an unlevelled, unstructured, uncorrelated line. There is no way to turn debug output down in production, no way to attach a request id, and no way to change where logs go without touching every call site.

`email` proves the shape this copies: a capability owning a provider-agnostic core (`packages/email` — `provider.ts` for the contract, `define.ts` for the registry, a `defineEmail({ providers: [] })` barrel that provider modules patch into) plus `email-<provider>` modules that each ship one file and one `plugin-array` patch. ADR 0005 (two-tier modules), ADR 0013 (scaffolds/files split), ADR 0014 (skill naming) and ADR 0020 (capability owns its integration boundary) all apply unchanged.

**The one place this deviates from `email` is the dependency direction**, and that deviation is the plan's spine — see [The dependency inverts](#the-dependency-inverts). `api` depends on `logger`, not the other way round, so every project with a Worker gets a correlated logger from `saasaloy add api` with no further wiring.

Success: `saasaloy add api` gives a project a working, correlated, level-controlled logger with zero extra steps; `c.get("log")` in any route emits a structured line that Workers Logs indexes as queryable fields; and the provider seam is real enough that a second sink is one descriptor and one file.

### The blocking question is answered: **pino does not run on Workers**

Issue #66 Q1 asked whether pino works on Cloudflare Workers and said to verify empirically before committing to the title. Verified 2026-08-07 in `.dev/playground` — `saasaloy init` + `saasaloy add api`, pino 10.3.1, `@cloudflare/vite-plugin` 1.50.0, wrangler 4.118.0, workerd 1.20260730.1.

| Probe | Result |
|---|---|
| `import pino from "pino"` → `vite build` | **Fails.** Vite reports unexpected Node.js imports for the `api` environment: `node:os`, `node:fs`, `node:path`, `node:url`, `node:events`, `node:diagnostics_channel`, `module`, and `worker_threads` — pulled in via `pino/lib/transport.js`, `pino/lib/tools.js`, `sonic-boom@4.2.1` and `thread-stream@4.2.0` |
| `import pino from "pino/browser"` → `vite build` | **Builds clean.** No Node imports |
| `pino/browser` at runtime on workerd | **Works.** Levels filter correctly (a `debug` call at `level: "info"` never emits), `child({ requestId })` binds context, `browser.write` emits one JSON line per event |
| Error objects | **Broken by default** — `{"err":{}}`, because `JSON.stringify(new Error())` is `{}`. Fixed only by `serializers: { err: stdSerializers.err }` **plus** `browser: { serialize: true }`, which then yields `{type, msg, stack}` |
| `tsc --noEmit` on a `pino/browser` import | **Fails: TS7016.** pino 10.3.1 has no `exports` map and no `browser.d.ts`; `types` points at `pino.d.ts`, which covers the Node entry only |
| `pino.d.ts` itself | Imports `SonicBoom` from `sonic-boom` and references `NodeJS.WritableStream` — so even a type-only import drags Node typings into a Workers workspace |
| Bundle cost | api Worker `dist/index.js` 58.56 kB → 76.97 kB (gzip 15.60 → 20.49) |

So pino on Workers means: a non-default subpath, a hand-written ambient `declare module "pino/browser"` for an untyped vendor entry, a serializer incantation without which every logged error is `{}`, and ~4.9 kB gzip in every generated Worker — to wrap `console` in a JSON envelope.

A zero-dependency provider does that natively, is typed by construction, and costs nothing. **`logger-console` ships as the only provider in this issue; pino becomes a follow-up.** The issue title needs rewriting.

### What `console` actually is on Workers

`console.*` is not a fallback on workerd — it *is* the log pipeline. Workers Logs ingests console output; `wrangler tail` reads the same stream. A provider that writes structured JSON to `console` is therefore Workers-native, not a stand-in for something better. This is the opposite of `email-console`, where logging the message is a dev-only substitute for actually sending.

Per [Cloudflare's Workers Logs docs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), verified 2026-08-07:

- **Pass the object, never a JSON string.** `console.log({user_id: 123})` produces directly queryable fields; `console.log("user_id: " + 123)` produces `{message: "user_id: 123"}`, findable only by text match. Workers Logs *"automatically extracts the fields and indexes them intelligently."* This matches what wrangler's local observability capture showed in the probe run.
- **Individual logs cap at 256 KB**, past which they are truncated and flagged `truncated: true`.
- **Head sampling is a platform feature**, not something a logger should reimplement — `observability.head_sampling_rate` is a number 0–1 (default 1), settable per environment.

## The dependency inverts

`api` gains `dependsOn: ["logger", "logger-console"]`. `logger` gains `dependsOn: []`.

The intent was that every project has a logger from line one, with no moment where `console.log` is the only option — originally expressed as putting `packages/logger` in the base template. Four mechanisms make the base the wrong home, all verified in the code:

| What was checked | What it showed |
|---|---|
| `templates/base/apps/web/wrangler.jsonc` | *"Pure static site: serve Astro's build output as Workers static assets, **no Worker code**."* Astro output is static, no SSR adapter — **nothing in the base can call a logger** until `add api` lands a Worker |
| `init.ts` / `scaffold.ts` vs `.saasaloy/manifest.json` | `init` **never writes a manifest**. Base files are a one-shot copy, so a base-placed package gets no ADR 0006 copy-in update path, no `--diff`, and `saasaloy remove` cannot reach it |
| `init.ts` skill handling | `init` copies **no skills**; only `add` does (`init.ts:15`). The `saasaloy-logger` skill would have no delivery mechanism |
| `resolve.ts:33` + every module descriptor | `resolveGraph` resolves `dependsOn` by reading descriptors **from the registry**, not from `saasaloy.json`'s `installed[]` — so `logger-pino` → `dependsOn: ["logger"]` needs a `modules/logger` descriptor regardless. Separately, every patch target in the repo today is module-scaffolded; patching a base file would be the first |

`api → logger` delivers the same practical outcome — installed by default for every project that can actually log — with zero new machinery.

**The inversion is forced, not stylistic.** `logger` cannot keep `email`'s `dependsOn: ["api"]` shape: `api → logger → api` is exactly the cycle `resolveGraph` throws on (`resolve.ts:20-24`). So `logger` has no prerequisites, and `modules/api/files/package.json` declares `"@repo/logger": "workspace:*"` directly rather than `logger` patching it in — one fewer patch than `email` needs.

It also unlocks the correlation design the original plan couldn't reach: because `api` *knows* logger is present, its spine ships the middleware pre-wired instead of documenting a copy-paste snippet.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Architecture** | Capability core + provider modules, copying `email`'s file split exactly. No CLI or schema work — the same patch kinds already exist. |
| **Providers in scope** | **`logger-console` only** — zero runtime dependencies, structured JSON to `console`. |
| **pino** | **Follow-up issue.** Empirically the wrong default for Workers (above). |
| **Dependency direction** | **`api` → `["logger", "logger-console"]`; `logger` → `[]`.** Forced by the cycle; see above. |
| **Placement** | A capability module, not a base-template package. Base has no server runtime, no manifest tracking, no skill delivery. |
| **Zero-provider behaviour** | Cannot arise. `api` depends on `logger-console`, so a provider is registered by construction — and that dependency is what **exercises the `plugin-array` patch point in this issue** rather than shipping it unproven. |
| **Provider selection** | `LOGGER_PROVIDER` is **optional** — defaults to the sole registered provider, throws only when it names one that isn't registered. Deliberately diverges from `EMAIL_PROVIDER`: a missing logger is loudly visible (the lines are gone), whereas throwing at boot is an outage caused by the observability layer. The divergence is written into the descriptor's `LOGGER_PROVIDER` blurb so it reads as chosen, not overlooked. |
| **Scope of the `console.*` migration** | **Generated apps only.** The repo's own 12 calls (`packages/cli/src/index.ts` ×6, `scripts/verify-css.ts` ×3, `scripts/watch-template.ts` ×3, `scripts/update-deps.ts` ×3) are out — ADR 0011 (the tool repo never self-syncs) and ADR 0009 (the CLI's output is deliberate terminal UX) govern, and they get their own issue. |
| **`console.*` in generated apps** | There is nothing to migrate. `apps/api`, `packages/db`, `packages/auth` and the base template contain **zero** `console.*` calls today; the only one in `modules/` is `email-console`'s, which is that provider's entire feature and stays. This issue *prevents* the problem rather than fixing one. |
| **The `no-console` guard** | **Dropped.** There is no linter anywhere — not in the tool repo, not in the base template, not in any module; `turbo.json`'s `lint` task is an empty stub. Files as "adopt a linter", with `no-console` as one of its rules. |
| **Env access** | `createLogger(env)` taking the whole `env`, mirroring `createEmail(env)`. |
| **`envVars`** | `LOGGER_PROVIDER` (optional, above) and `LOG_LEVEL` (threshold, defaults to `info`). |
| **Redaction** | **On by default in the core.** Key deny-list — `authorization`, `cookie`, `set-cookie`, `token`, `password`, `secret`, `api_key` → `[redacted]` — walked one level deep past the top, so the CPU cost is bounded. `defineLogger({ redact })` *extends* the list rather than replacing it. Retrofitting redaction after call-site habits exist is the harder order. |
| **Observability config** | **`modules/api` ships the `observability` block** in its base `wrangler.jsonc` — it's a property of the Worker, not of a logging package, so every project gets it whether or not it logs. Not patchable anyway: `upsertWranglerBinding` handles only **top-level arrays** (`jsonc.ts:46-70`), and `observability` is a nested object — line 69 would write `"observability": [...]`. |
| **Sampling** | Not built. `head_sampling_rate` already exists at the platform level; a module knob would duplicate it worse. Documented in the api wrangler comment as the cost dial. |
| **Provider skill** | None. Per `create-provider`, provider modules ship no skill of their own; `logger-console` gets a row in `saasaloy-logger`'s provider table. |
| **Naming** | Stays `logger-console`. See [the naming trap](#the-naming-trap-and-why-it-stands) — mitigated in prose, not by renaming. |

### The provider interface

The one place vendor shape could leak into the contract, so it is decided deliberately rather than inherited.

**Levels:** `trace` · `debug` · `info` · `warn` · `error` · `fatal`. Six is pino's set and also syslog-shaped; it is not a pino-ism. `fatal` has no distinct behaviour on Workers — nothing exits the process — but it costs one union member, and dropping it means any project that wants it patches the core's type.

**Call shape: `log.info(msg, fields?)`, not pino's `log.info(obj, msg)`.** Message first. pino's argument order is an artifact of its printf `mergingObject` history, and adopting it would bake a vendor's ergonomic accident into a contract that no longer ships that vendor. A provider wanting pino's order swaps the arguments in its own `write`.

**Structured only, no printf.** `%s` interpolation is a formatting concern; the caller composes the string.

**Child loggers:** `log.child(fields)` returns a logger with those fields merged into every event. This is the correlation mechanism.

**The event a provider receives** is already normalized by the core — level, message, merged bound + call-site fields (post-redaction), timestamp, and a serialized `err` when one was passed. A provider implements one method:

```ts
export interface LogProvider {
  name: string;
  write(env: LoggerEnv, event: LogEvent): void;
}
```

`write` is **synchronous and returns `void`** — the deliberate difference from `EmailProvider.send`. A logger call is not a thing a caller awaits, and an async `write` would either force `await log.info(...)` at every call site or leak a floating promise on a Worker that may be killed before it settles. A provider needing to ship logs off-box owns its own batching behind that signature. `provider.ts` carries a comment recording *why* there is no `ExecutionContext` and that widening to `createLogger(env, ctx?)` → `write(env, event, ctx?)` is planned and non-breaking — so the next author doesn't read the absence as an oversight.

**Errors:** the core serializes an `Error` passed as `err` into `{ name, message, stack, cause? }` — the gap the pino probe exposed, handled once in the core instead of per provider. Unlike `EmailError` there is **no error class of its own**: a logger that throws is a self-inflicted outage. Provider `write` failures are swallowed by the core.

### Request correlation

`modules/api`'s `src/index.ts` ships the middleware pre-wired, in the same file and style as the existing `cors` block:

```ts
app.use("*", async (c, next) => {
  const requestId = c.req.header("cf-ray") ?? crypto.randomUUID();
  c.set("log", createLogger(c.env).child({ requestId }));
  await next();
});
```

- **`c.get("log")` is the correlated logger**; `createLogger(c.env)` stays available as the uncorrelated escape hatch for code outside a request.
- The Hono generic gains `Variables: { log: Logger }` alongside the existing `Bindings`, and `Bindings` gains `LOGGER_PROVIDER?` and `LOG_LEVEL?`.
- **`cf-ray` first, `crypto.randomUUID()` as fallback.** `cf-ray` is what Cloudflare's own dashboard, Invocation Logs and support tickets key on, so a log line correlates with the platform's view for free; the fallback covers local dev, where there is no ray. Honoring an inbound `x-request-id` is **deliberately omitted** — it trusts a client-supplied value into an indexed field — and the skill says so rather than leaving it looking unconsidered.

### The naming trap, and why it stands

`email-console` and `logger-console` are structurally identical and semantically opposite: one must never be deployed, the other is the production default. Someone scanning `saasaloy list` will reasonably infer both are dev-only. `logger-workers` was rejected (implies a Workers-specific implementation when it is plain `console`) and `logger-json` too (names the format, not the sink, which is the one thing a provider name should identify). The mitigation is prose: the first paragraph of both `saasaloy-logger` and `saasaloy-email` states the difference plainly, rather than burying it.

## Approach

### What it reuses

| Existing thing | Used for |
|---|---|
| `modules/email/registry-item.json` | The capability descriptor shape — `scaffolds` + `envVars` + `agent.skills` |
| `modules/email/files/src/{provider,define,index}.ts` | The three-file core split, comment voice, and the exact `export const x = defineX({ providers: [] })` barrel shape |
| `packages/cli/src/lib/patch/ts-module.ts` | `plugin-array` registration, unchanged |
| `modules/email-console/` | The whole provider-module template: descriptor, one file, one patch |
| `modules/api/files/src/index.ts` | The `cors` middleware block the logger middleware sits beside, and the `Bindings` type it extends |
| `.agents/skills/create-provider/SKILL.md` | The authoring rules; gains a `logger` mode |
| `modules/email/files/{package.json,tsconfig.json}` | The `clean` script + exact-pinned `rimraf`/`typescript`, and the workers-types tsconfig |
| `pnpm play:init` → `.dev/playground` | The verification harness |

### Phase 1 — `packages/logger` core

Scaffold `packages/logger` with the `@logger` alias, mirroring `email`'s `scaffolds` block.

- `files/package.json` → `@repo/logger`, `"clean": "rimraf -g dist \"*.tsbuildinfo\""`, **zero runtime dependencies**, exact-pinned `@cloudflare/workers-types` / `rimraf` / `typescript` / `@repo/tsconfig` in dev.
- `files/tsconfig.json` — copied from `email`'s.
- `files/src/provider.ts` — `LoggerEnv`, `LogLevel`, `LogFields`, `LogEvent`, `LogProvider`, `SerializedError`. No vendor imports, same discipline as email's core. Carries the `write(): void` rationale comment.
- `files/src/define.ts` — `defineLogger({ providers, redact? })`, provider selection, `LOG_LEVEL` threshold (default `info`), field merging, `child()`, error serialization, redaction, and the `try/catch` that keeps a failing `write` from taking down the request.
- `files/src/index.ts` — the barrel and the patch point, in exactly the shape `insertIntoPluginArray` requires (`ts-module.ts:34-38`), with the same "keep this line in exactly this shape" comment `email`'s barrel carries:

  ```ts
  export const logger = defineLogger({ providers: [] });
  export function createLogger(env: LoggerEnv) { return logger.create(env); }
  ```

- `files/src/providers/.gitkeep` — the drop target.

Descriptor: `dependsOn: []`, **no patches**, `envVars: { LOGGER_PROVIDER, LOG_LEVEL }` in the descriptors' established voice.

**Verify:** `pnpm typecheck` clean in a playground with `logger` added; workspace has zero runtime deps.

### Phase 2 — `logger-console`

One file into `@logger/providers/console.ts`, one `plugin-array` patch on `packages/logger/src/index.ts`. `dependsOn: ["logger"]`.

Writes the normalized `LogEvent` **as an object** to the matching `console` method — `console.warn` for `warn`, `console.error` for `error`/`fatal`, `console.log` otherwise — so Workers Logs' own level classification agrees with ours, and its field extraction gets a real object rather than an escaped string.

The factory is named `consoleLogger`, not `console`, for the same reason `email-console` uses `consoleEmail` — the generated import must not shadow the global.

**Verify:** `saasaloy add api` twice leaves one `consoleLogger()` in the providers array with comments intact.

### Phase 3 — `modules/api` changes

The phase that makes the logger arrive by default.

- `registry-item.json`: `dependsOn: []` → `["logger", "logger-console"]`.
- `files/package.json`: add `"@repo/logger": "workspace:*"` to `dependencies`.
- `files/src/index.ts`: the middleware above, the `Variables: { log: Logger }` generic, and `LOGGER_PROVIDER?` / `LOG_LEVEL?` on `Bindings`.
- `files/wrangler.jsonc`: the `observability` block, with a comment naming `head_sampling_rate` as the cost dial and pointing at per-environment overrides:

  ```jsonc
  "observability": {
    "enabled": true,
    "head_sampling_rate": 1
  }
  ```

- `skills/saasaloy-api/SKILL.md`: the route contract gains `c.get("log")`.

**Note the one-way door:** projects with `api` already installed do not retroactively gain `logger` — `dependsOn` is resolved at `add` time. The copy-in update path (ADR 0006) is what surfaces the changed `api` files; the QA plan should confirm what an existing project actually sees.

### Phase 4 — the skills

- **`modules/logger/skills/saasaloy-logger/SKILL.md`** (ADR 0014 naming, ADR 0015 symlink), covering: the call shape and why it is message-first; `c.get("log")` vs `createLogger(c.env)`; reading logs via `wrangler tail` and Workers Logs, and what `LOG_LEVEL` does in each; a provider table with `logger-console`'s row; the `logger-console` / `email-console` disambiguation **in the first paragraph**; § "Writing a custom provider in your own project" (the `LogProvider` contract only); what redaction does and does not catch, and the deliberate omission of inbound `x-request-id`.
- **`.agents/skills/create-provider/SKILL.md` gains a `logger` mode** alongside `email`, per its own "modes are added as more capabilities own provider interfaces" structure. The `logger` interface diverges enough — sync `write`, no error class, level threshold and redaction in the core — that leaving it undocumented invites a `logger-pino` that gets it wrong.

### Phase 5 — record the decisions

- **A new ADR: `api` depends on `logger`.** The first time a capability dependency reverses direction, and the first `dependsOn` on a `saasaloy:feature` module. It records: the cycle that forced the inversion (`api → logger → api`); the rule it sets — *a capability the spine **consumes** is depended on by the spine, not patched into it, the mirror of `email`, which the spine consumes nothing of*; and why `api → logger-console` is a dependency on a provider module (the two-tier wart already recorded in `CONTEXT.md` means `feature` is the only available type for a provider).
- **`CONTEXT.md`** — add logger vocabulary only if the build produces terms that are actually reused (`log event`, `bound fields`). Don't pad the glossary.
- ADR 0001's 2026-08-04 amendment (stateless third-party services may be multi-provider) is *applied*, not extended — `console` is not a third-party service at all, which sits comfortably inside the amendment rather than at its edge.

### Phase 6 — verification

- `saasaloy add api` on a clean playground installs `logger`, `logger-console` and `api` in that topological order; run it **twice** and confirm one `consoleLogger()` in the providers array and one `observability` block, comments intact.
- `pnpm deps:verify` clean.
- Under `wrangler dev`: a route emits `info` and `error` via `c.get("log")`; both lines carry the same `requestId`, sourced from `cf-ray`; a `debug` call is filtered out at `LOG_LEVEL=info`; a field named `authorization` comes out `[redacted]`; a thrown `Error` serializes to `{name, message, stack}` rather than `{}`.
- Bundle delta recorded — expected near zero, versus the measured +18.4 kB for pino.
- QA doc under `docs/qa/`.

### Rejected alternatives

- **`logger-pino` as the default** — rejected on the probe: untyped subpath, a hand-maintained ambient declaration, a serializer incantation, and ~4.9 kB gzip to wrap `console`.
- **Ship both providers now** — rejected as scope; shipping an untyped vendor shim alongside a first release buys risk for symmetry.
- **`packages/logger` in the base template** — rejected on four verified mechanisms (no server runtime, no manifest, no skill delivery, resolver reads the registry). `api → logger` delivers the same intent.
- **A built-in `console` sink in the core, with no `logger-console` module** — genuinely tempting; it answers #66's Q11 with "yes, redundant" and removes a module. Rejected because it would leave `plugin-array` registration unproven for this capability until `logger-pino` lands, and an unexercised patch point is how `matchOn: "name"` reached `email-cloudflare` unverified.
- **A single-file logger with no provider seam** — forecloses the shape every other capability uses, and a log *sink* is the most plausible thing a real project swaps.
- **`LOGGER_PROVIDER` required, mirroring `email`** — rejected: an outage caused by the observability layer is worse than the visible absence of logs.

## Non-goals

- **`logger-pino`, or any second provider.** Follow-up issues; the seam is built and proven for them.
- **The repo's own `console.*` calls** in `packages/cli` and `scripts/`. Separate issue; ADR 0011 and ADR 0009 govern.
- **A `no-console` lint rule or guard script.** Blocked on the repo having no linter at all; its own tooling issue.
- **Error reporting.** Sentry-style exception tracking is a different product from structured logs (#66 Q10). Logs only.
- **Log shipping, batching, or a remote sink.** The provider seam is where one goes; none ships.
- **Sampling knobs.** `head_sampling_rate` is the platform's job.
- **Metrics and tracing.** Not logs.
- **Changing `waitlist`, `auth`, or `database` to emit logs.** They get `@repo/logger` transitively through `api`; adopting it is per-module follow-up work.
- **Retrofitting `logger` into projects that already installed `api`.** Surfaced by the ADR 0006 copy-in update path, confirmed in QA, not automated here.
- **`saasaloy doctor` checks** for `LOGGER_PROVIDER`. Owned by #47.
