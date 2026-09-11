---
name: create-provider
description: Author a provider module for a Saasaloy capability that owns a provider interface (modules/<capability>-<provider>/) — the descriptor, the single provider file, and the registration patch. Use when adding a second (or third) implementation behind an existing capability's interface — "add a Resend/SES/Plunk email provider", "support Postmark", "write an email-<x> module" — even if the word "provider" isn't used.
---

# create-provider

Guide for authoring a **provider module**: a `saasaloy:feature` module that supplies one
implementation of a capability's provider interface. It is the narrow sibling of
[`create-module`](../create-module/SKILL.md) — read that one first for the general descriptor
rules; this one covers only what is different when the module you're writing is a provider.

A provider module is deliberately tiny. If yours is growing a second file or a scaffold, you are
probably authoring a capability, not a provider — go back to `create-module`.

**Ground truth:** `docs/plans/0020-plan-email-capability-module-2026-08-04.md` (the design this pattern
came from), [ADR 0001](../../../docs/adr/0001-adr-all-in-on-cloudflare-2026-07-22.md) (when a
capability may be multi-provider at all), [ADR 0033](../../../docs/adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md)
(the test that decides provider vs driver), [ADR 0020](../../../docs/adr/0020-adr-capability-owns-its-vendor-packages-2026-07-24.md)
(where the vendor dependency goes).

## Is a provider module the right shape here?

ADR 0001 commits the stack to Cloudflare and cuts the multi-cloud adapter layer. Its 2026-08-04
amendment carves out exactly one exception, and a new provider must land inside it:

- **Stateful infrastructure stays single-provider** — a database, an object store. Swapping
  one is a data migration, and an adapter layer would hide a difference that matters.
- **Stateless third-party services may be multi-provider** when the capability owns the
  abstraction — sending email, sending an SMS. There is no migration; the endpoint is
  interchangeable.
- A sink that isn't a third-party service at all — `logger-console` writes to the platform's own
  log pipeline — sits comfortably *inside* the amendment rather than at its edge. It is stateless
  and carries nothing to migrate; the test the amendment is really applying is "would swapping this
  be a data migration?", not "is there a vendor?".
- **Transient platform state is provider territory too.** A queue holds a message for seconds and
  the platform, not the project, is its system of record. Nothing is queried after the fact and
  nothing is migrated, so `queue` takes providers even though it is a binding and not an HTTP
  endpoint. [ADR 0033](../../../docs/adr/0033-adr-transient-state-capabilities-take-providers-2026-09-08.md)
  states the test and lists which side each capability sits on. Read it before you assume "has
  state" means "driver".

A stateful capability can still offer a **choice made once, at install time**, without becoming
multi-provider. That is a driver module, and `database-d1` / `database-postgres` are the only pair
today. It is a different shape with its own rules, so if that is what you are writing, stop here
and read ADR 0026 instead.

Also check that a real interface already exists. Provider modules only work where a capability has
scaffolded a workspace with a `providers` registry to append to. Inventing that interface is
capability work.

## The shape (all modes)

```text
modules/<capability>-<provider>/
  registry-item.json     # type: saasaloy:feature, dependsOn: ["<capability>"]
  files/<provider>.ts    # ONE file: the interface implementation
```

Five rules hold for every mode:

1. **Name is `<capability>-<provider>`** and matches the directory (`email-cloudflare`,
   `email-resend`). The folder name, the descriptor `name`, and the module coordinate are one
   string.
2. **`type` is `saasaloy:feature`, `dependsOn` is `["<capability>"]`.** A provider is typed
   `feature` because the descriptor schema has exactly two tiers; it isn't really one. That wart is
   recorded in `CONTEXT.md` → *Provider module* — don't add a third tier to fix it.
3. **One file, into the capability's `providers/` folder**, via the capability's alias:
   `{ "path": "files/<provider>.ts", "target": "@<capability>/providers/<provider>.ts" }`.
4. **Register with a `plugin-array` patch** on the capability's barrel. This is the existing
   codemod (`packages/cli/src/lib/patch/ts-module.ts`), unchanged — it adds the import and appends
   the call idempotently. Dropping the file registers nothing; nothing scans `providers/`. That
   split is now the registry-wide rule rather than a provider quirk — an `api` route registers the
   same way, through the `chained-route` patch (ADR 0028) — so a target file that is a **statically
   named list** is what you should expect at every extension point.
5. **The npm dependency, if any, goes in the *capability's* `package.json`** through a
   `package-json-dependency` patch — never the descriptor's `dependencies[]` (which merges into the
   project root) and never another workspace. Only the capability's own workspace may import a
   provider SDK (ADR 0020).

Provider modules ship **no skill folder of their own**. The capability's skill is where a provider
gets documented; add a row to its provider table and, if the provider needs out-of-band setup, a
short runbook section there. One skill per capability keeps a consumer from installing five
near-identical runbooks.

> **Drivers are the exception, and they are not providers.** `database-d1` and `database-postgres`
> each ship a skill folder, carry `scaffolds[]`, and replace files the capability would otherwise
> own. They can do that because they exclude each other with `conflictsWith`, so a project installs
> exactly one and receives exactly one runbook. That is a **driver module**, recorded in
> [ADR 0026](../../../docs/adr/0026-adr-database-driver-split-2026-08-28.md) and `CONTEXT.md`, not
> a licence to grow a provider. If your module is mutually exclusive with a sibling, read that ADR.
> If it is one of several that coexist behind an interface, every rule on this page still binds
> you.
>
> **A driver name belongs in exactly two places**: the capability's `requiresOneOf`, and the
> `conflictsWith` each driver declares against its siblings. No consumer names a driver in
> `dependsOn`. A feature depends on `database`, and the user picks `database-d1` or
> `database-postgres` from the capability's prompt. The same rule holds for a provider: a consumer
> depends on `email`, never on `email-resend`.

### Why the whole descriptor, and not one swappable function body

Providers differ in **descriptor** surface, not just code. That asymmetry is the entire reason each
one is its own module:

| | binding provider (`email-cloudflare`) | HTTP provider (`email-resend`) |
|---|---|---|
| `patches` → `apps/api/wrangler.jsonc` | a binding | — |
| `patches` → the capability's `package.json` | — | the SDK dependency |
| `patches` → the capability's barrel | register | register |
| `envVars` | none — the binding *is* the credential | the API key |

One mode below per capability that owns a provider interface. The rules above hold for all of them;
each mode covers only what is different. Add a mode (`storage`, …) when another capability grows
an interface — and read the mode you're writing for, not the one you remember: `sms` and `email`
look alike and disagree about `retryable`, which is the difference that costs money.

## Mode: `email`

**Interface:** `EmailProvider` in `packages/email/src/provider.ts`.

```ts
import { EmailError } from "../provider";
import type { EmailEnv, EmailProvider, EmailResult, ResolvedEmailMessage } from "../provider";

export function resend(): EmailProvider {
  return {
    name: "resend", // the value EMAIL_PROVIDER must hold to select this provider
    async send(env: EmailEnv, message: ResolvedEmailMessage): Promise<EmailResult> {
      // …send, then return the service's own id
      return { messageId: "…" };
    },
  };
}
```

Contract points that are easy to get wrong:

- **The message arrives resolved.** `from` is already filled in from `EMAIL_FROM`, `to` is already
  an array, `text` is already derived from `html`. Don't redo any of it, and don't add defaults of
  your own.
- **`name` is the `EMAIL_PROVIDER` value**, and it must be unique across providers. It is *not*
  required to match the exported factory — `email-console`'s factory is `consoleEmail` precisely so
  the generated import can't shadow the global `console`.
- **Normalize every failure into `EmailError`** with one of the four codes
  (`sender_not_verified`, `rate_limited`, `too_large`, `provider_error`), an honest `retryable`,
  and the vendor's raw code in `providerCode`. Map only codes you have actually seen; let the rest
  fall through to `provider_error` / `retryable: false`. A wrong `retryable: true` means duplicate
  mail.
- **Never retry, sleep, or queue inside `send()`.** The caller decides — a retry loop holds the
  Worker's response open.
- **Read secrets off the `env` argument**, never `process.env` (it doesn't exist on Workers), and
  declare each one in the descriptor's `envVars` with a human description.

**Descriptor, HTTP-provider flavour:**

```jsonc
{
  "name": "email-resend",
  "type": "saasaloy:feature",
  "dependsOn": ["email"],
  "dependencies": [],                       // stays empty — see the patch below
  "envVars": { "RESEND_API_KEY": "…" },     // provider-owned, never in the core
  "patches": [
    { "file": "packages/email/package.json", "kind": "package-json-dependency",
      "section": "dependencies", "name": "resend", "range": "4.0.1" },
    { "file": "packages/email/src/index.ts", "kind": "plugin-array",
      "exportName": "email", "arrayProp": "providers", "call": "resend",
      "import": { "name": "resend", "from": "./providers/resend" } }
  ],
  "files": [{ "path": "files/resend.ts", "target": "@email/providers/resend.ts" }],
  "scaffolds": []
}
```

`email-cloudflare` is the binding flavour of the same shape: no npm dependency and no secret,
plus a `wrangler-binding` patch adding `send_email` to `apps/api/wrangler.jsonc` (`matchOn: "name"`
— `send_email` entries are keyed by `name`, not `binding`).

A provider that needs an SDK version must pin it **exactly** — `"range": "4.0.1"`, never `^4.0.1`
or `~4.0.1`.

Pin it by hand the first time, and check the version against npm rather than typing one from
memory. After that the tooling keeps it current. `pnpm deps:update` and `pnpm deps:check` read the
`range` of every `package-json-dependency` patch as a third dependency site alongside a
descriptor's `dependencies[]` and `devDependencies[]`, so a provider's SDK pin gets the same
cooldown and within-major gate as everything else (ADR 0016, amended for #85). This used to be the
one place drift went unnoticed. It no longer is, which also means a patch missing `name`, `range`
or a `section` naming a real dependency map now fails the run outright.

## Mode: `logger`

**Interface:** `LogProvider` in `packages/logger/src/provider.ts`. A log sink — `console`, and the
`logger-pino` / remote-ingest providers that will follow.

```ts
import type { LoggerEnv, LogEvent, LogProvider } from "../provider";

export function axiom(): LogProvider {
  return {
    name: "axiom", // the value LOGGER_PROVIDER must hold to select this provider
    write(env: LoggerEnv, event: LogEvent): void {
      // …hand the already-normalized event to the sink. No return value.
    },
  };
}
```

The interface diverges from `email`'s in four ways, and each one is a way to get a `logger-<x>`
wrong:

- **`write` is synchronous and returns `void`.** Not `async`, not a `Promise`. A log call is not
  something a caller awaits, and an async `write` would either force `await log.info(...)` at every
  call site or leak a floating promise on a Worker that may be killed before it settles. A provider
  that ships logs off-box owns its own **batching** behind this signature — one `fetch` per line is
  a subrequest per line, and Workers cap subrequests per invocation. There is no `ExecutionContext`
  argument today; widening later (`write(env, event, ctx?)`) is non-breaking, so don't invent one.
- **There is no error type to normalize into.** No `LoggerError`, no `retryable`, no `providerCode`.
  The core wraps every `write` in a `try/catch` and **swallows** whatever escapes, deliberately: a
  logger that throws is a self-inflicted outage. The corollary is that a broken provider fails
  *silently* — test it against a real sink, because nothing will tell you.
- **The event arrives fully normalized.** The `LOG_LEVEL` threshold has already been applied, bound
  and call-site fields are already merged, **redaction has already run**, `time` is stamped, and an
  `Error` passed as `err` is already `{ name, message, stack, cause? }`. Don't re-filter by level,
  don't re-serialize, and above all don't add a redaction pass of your own — the core owns it, and a
  second one just costs CPU per line.
- **A missing `LOGGER_PROVIDER` doesn't throw.** Unset selects the first registered provider, so
  install order can decide which sink is live. Give the provider a `name` that reads well in a
  config (`console`, `axiom`, `pino`) and document it in the capability's provider table.

Descriptor — `logger-console` is the whole shape, and it is the minimal one (no dependency, no
secret, no binding):

```jsonc
{
  "name": "logger-console",
  "type": "saasaloy:feature",
  "dependsOn": ["logger"],
  "dependencies": [],
  "envVars": {},
  "patches": [
    { "file": "packages/logger/src/index.ts", "kind": "plugin-array",
      "exportName": "logger", "arrayProp": "providers", "call": "consoleLogger",
      "import": { "name": "consoleLogger", "from": "./providers/console" } }
  ],
  "files": [{ "path": "files/console.ts", "target": "@logger/providers/console.ts" }],
  "scaffolds": []
}
```

An HTTP-ingest provider adds the `package-json-dependency` patch (into `packages/logger`'s own
`package.json`, exact-pinned) and its `envVars`, exactly as `email-resend` does above.

One non-obvious rule for this capability: **log the event object, don't `JSON.stringify` it**, if
your sink is `console`. Workers Logs extracts and indexes the fields of a logged object; a
pre-stringified line arrives as one opaque string that only a full-text match can find.

## Mode: `sms`

**Interface:** `SmsProvider` in `packages/sms/src/provider.ts`. `sms-console` is the worked
example; the capability's runbook is `modules/sms/skills/saasaloy-sms/SKILL.md`.

Same descriptor shape as `email`'s HTTP flavour, and there is no binding flavour to choose between:
Cloudflare has no SMS product, so every provider here is a REST call over `fetch` and none of them
patches `wrangler.jsonc`.

```ts
import { SmsError } from "../provider";
import type { ResolvedSmsMessage, SmsEnv, SmsProvider, SmsResult } from "../provider";

export function twilio(): SmsProvider {
  return {
    name: "twilio", // the value SMS_PROVIDER must hold to select this provider
    async send(env: SmsEnv, message: ResolvedSmsMessage): Promise<SmsResult> {
      // …send, then return the service's own id
      return { messageId: "…" };
    },
  };
}
```

Three things differ from `email`, and a provider copied across gets each of them wrong:

- **`retryable` is inverted, and the core enforces it.** Email treats an ambiguous failure — a
  timeout, a dropped connection — as retryable, because the request may never have left and a
  duplicate email is an annoyance. Here the message may already have been accepted and billed, and
  a retry buzzes the phone twice and invalidates the one-time code the person is typing. **An
  ambiguous failure is `retryable: false`; a timeout is explicitly non-retryable.** `SmsError`
  honors `retryable: true` on `rate_limited` and `provider_error` only and silently drops it
  elsewhere, so a copied `retryable: true` on a timeout is coerced rather than shipped — but write
  it correctly, because the coercion is a backstop and not a design.
- **`from` arrives optional and unvalidated.** The core validates every recipient against E.164 and
  does nothing at all to `from`, because a sender may be a number, a short code, an alphanumeric id
  or a pool id. If *your* provider requires a sender, check `message.from` yourself and raise
  `invalid_message`. Don't push that requirement into the core; a pool-routed provider doesn't have
  it.
- **The message carries `estimatedSegments`.** It is the core's estimate, computed from the body.
  Don't overwrite it with the vendor's count and don't add a field to `SmsResult` for one: Twilio
  reports `num_segments: 0` for messages sent through a Messaging Service, so a provider figure is
  missing in exactly the pooled case, and two numbers that disagree are worse than one.

Failure codes are `invalid_number`, `unroutable`, `opted_out`, `account_error`, `rate_limited`,
`message_too_long` and `provider_error` (`invalid_message` is the core's). Sender-not-owned, empty
balance and missing geo permission all collapse into **`account_error`** — they are operator alerts
with the same caller response, and `providerCode` keeps the vendor's own code for whoever fixes it.

**Descriptor:**

```jsonc
{
  "name": "sms-twilio",
  "type": "saasaloy:feature",
  "dependsOn": ["sms"],
  "dependencies": [],
  "envVars": { "TWILIO_ACCOUNT_SID": "…", "TWILIO_AUTH_TOKEN": "…" },
  "patches": [
    { "file": "packages/sms/src/index.ts", "kind": "plugin-array",
      "exportName": "sms", "arrayProp": "providers", "call": "twilio",
      "import": { "name": "twilio", "from": "./providers/twilio" } }
  ],
  "files": [{ "path": "files/twilio.ts", "target": "@sms/providers/twilio.ts" }],
  "scaffolds": []
}
```

Twilio publishes [test credentials](https://www.twilio.com/docs/iam/test-credentials) and magic
numbers that exercise the live API with no purchased number and no charge — `+15005550006` as a
valid `From`, and `To` numbers returning documented errors (21211 invalid, 21612 unroutable, 21610
opted-out, 21408 no international permission). Use them to prove your code mapping instead of
guessing at it.

## Mode: `queue`

**Interface:** `QueueProvider` in `packages/queue/src/provider.ts`. `queue-cloudflare` is the
binding flavour, `queue-memory` is the local one, and the capability's runbook is
`modules/queue/skills/saasaloy-queue/SKILL.md`.

The interface itself is one method:

```ts
import { QueueError } from "../provider";
import type { EnqueueOptions, Job, QueueEnv, QueueProvider } from "../provider";

export function upstash(): QueueProvider {
  return {
    name: "upstash", // the value QUEUE_PROVIDER must hold to select this provider
    async enqueue(env: QueueEnv, job: Job, payload: unknown, options: EnqueueOptions) {
      // …serialize { job: job.name, payload } and hand it to the service
    },
  };
}
```

What a provider copied from `email` gets wrong here:

- **The core has already done the lookup and the validation.** `job` is a registered job and
  `payload` has already been through its schema. Don't look the name up again, don't re-validate,
  and don't reach into the `jobs` table. Send `{ job: job.name, payload }` and nothing else: the
  job table holds everything a consumer needs to run it.
- **`enqueue` returns void, and returns fast.** There is no message id in the contract, on purpose,
  because a provider that batches has no single id to give back. Never run the handler, retry, or
  sleep inside `enqueue` on a provider that has a real service behind it; the caller is a request.
- **Refuse `job.durable` unless you can actually checkpoint.** A handler asking for a durable run
  and getting a plain message still runs, but it loses the replay it asked for, and it loses it
  silently. Throw `QueueError("provider_error")` naming the limitation. `queue-memory` is the one
  documented exception: it warns instead of throwing, because a local provider that refuses would
  make a durable job undevelopable.
- **Honour `options.delaySeconds` or say you cannot.** Passing it through to a service that ignores
  it turns a delayed job into an immediate one, which reads as a scheduling bug months later.
- **Codes are `invalid_job`, `unknown_job`, `too_large`, `rate_limited`, `provider_error`.** The
  first two belong to the core; a provider raises the last three. Map only vendor codes you have
  seen and let the rest fall through to `provider_error` / `retryable: false`. A wrong
  `retryable: true` means the job runs twice.

**The second export, when the platform delivers rather than being polled.** A provider whose
service pushes work back into the Worker (a Queues consumer, a Cron Trigger) ships a *second*
factory in the same file returning `{ queue?, scheduled? }`, and registers it with a second
`plugin-array` patch on `apps/api/src/worker.ts`. That is the handler table from ADR 0033, and it
is the only route for a non-`fetch` Worker export. Two rules bind that half:

- **Gate on `QUEUE_PROVIDER` and return with one warn line when it names another provider.** The
  module installs as a unit, so a project that switched providers without removing yours would
  otherwise run every job twice. Warn rather than throw: the handlers are the Worker's, and
  throwing fails a batch another provider is legitimately handling.
- **Settle every message on every branch** — ack, retry, or dead-letter. A message left unsettled
  is redelivered when the visibility timeout expires, which reads as a job that ran twice for no
  reason. Read `QueueError.retryable` to choose; the core never retries for you.
- **A cron tick enqueues, it never runs a job inline.** Call `dueSchedules(new Date(tick))` and
  enqueue one message per hit, so a scheduled run gets the same retries and dead-lettering as any
  other.

**Descriptor, local flavour** (`queue-memory`, the minimum: no binding, no dependency, no secret):

```jsonc
{
  "name": "queue-memory",
  "type": "saasaloy:feature",
  "dependsOn": ["queue"],
  "dependencies": [],
  "envVars": {},
  "patches": [
    { "file": "packages/queue/src/index.ts", "kind": "plugin-array",
      "exportName": "queue", "arrayProp": "providers", "call": "memory",
      "import": { "name": "memory", "from": "./providers/memory" } }
  ],
  "files": [{ "path": "files/memory.ts", "target": "@queue/providers/memory.ts" }],
  "scaffolds": []
}
```

**Descriptor, binding flavour** (`queue-cloudflare`): the same `plugin-array` patch, plus a
`wrangler-binding` patch per binding and a second `plugin-array` for the handler set. The binding
patches use the **dotted `bindingType`** the CLI gained for this capability, so a nested Wrangler
key is one patch and removal unwinds the parents it created:

```jsonc
{ "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding",
  "bindingType": "queues.producers", "entry": { "binding": "JOBS", "queue": "app-jobs" } },
{ "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding",
  "bindingType": "queues.consumers", "matchOn": "queue",
  "entry": { "queue": "app-jobs", "max_batch_size": 10, "max_retries": 3 } },
{ "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding",
  "bindingType": "triggers.crons", "entry": "* * * * *" },
{ "file": "apps/api/src/worker.ts", "kind": "plugin-array",
  "exportName": "worker", "arrayProp": "handlers", "call": "cloudflareQueueHandlers",
  "import": { "name": "cloudflareQueueHandlers", "from": "@repo/queue/providers/cloudflare" } }
```

Pick `matchOn` to name the entry's own identifying field: `binding` for a producer (the default),
`queue` for a consumer, and nothing at all for `triggers.crons`, whose entries are bare strings
matched by equality.

**Every capability that can be developed offline owes a local provider.** `queue-memory` runs the
job inline in the same Worker, records each `ctx.step` name and `ctx.sleep` duration, keeps a
`failed` list, and exposes `runDue(now)` so a test can fire the schedule table without a cron
trigger. That recording surface sits on the value the factory returned, not on `QueueProvider`:
the core knows nothing about it, and a test reaches it directly. Copy that shape rather than
inventing a mock.

## Mode: `kv`

**Interface:** `KvProvider` in `packages/kv/src/provider.ts`. `kv-cloudflare` is the binding
flavour, `kv-memory` the local one, and the capability's runbook is
`modules/kv/skills/saasaloy-kv/SKILL.md`.

```ts
import { KvError } from "../provider";
import type {
  ConsumeResult, KvEnv, KvListOptions, KvListResult, KvProvider, KvSetOptions,
  ResolvedConsumeRequest,
} from "../provider";

export function upstash(): KvProvider {
  return {
    name: "upstash",       // the value KV_PROVIDER must hold to select this provider
    minTtlSeconds: 0,      // the shortest TTL this store accepts, in seconds
    async get(env: KvEnv, key: string): Promise<string | null> { /* … */ },
    async set(env: KvEnv, key: string, value: string, options: KvSetOptions) { /* … */ },
    async delete(env: KvEnv, key: string): Promise<void> { /* … */ },
    async list(env: KvEnv, options: KvListOptions): Promise<KvListResult> { /* … */ },
    // optional — leave it off if the store cannot count
    async consume(env: KvEnv, request: ResolvedConsumeRequest): Promise<ConsumeResult> { /* … */ },
  };
}
```

Six contract points that are easy to get wrong, and this capability's core does more for you than
`email`'s does:

- **You store strings, and nothing else.** The core owns `JSON.stringify` / `JSON.parse`, the
  25 MiB `too_large` check, the 512-byte key check and the namespace rules. Don't re-encode, don't
  re-measure, and don't build a key. `set` hands you a string that has already passed every check.
- **`minTtlSeconds` is a declaration, not a clamp.** The core compares against it and throws
  `invalid_ttl` before you are called. Never round a TTL up yourself: the whole point of the floor
  is that the same call cannot expire at a different time on a different provider with nothing in
  the logs to say so. `options.ttlSeconds` arrives either absent or already legal.
- **A miss returns `null` from `get`. It is not an error.** `delete` on an absent key succeeds.
- **`list` must page with a real cursor.** Return `{ keys, cursor, complete }`, where `cursor` is
  present exactly when `complete` is false and is **opaque** to the caller — pass through the
  vendor's own token, or base64 something of your own. A `list` shipped without a paging test is a
  `list` nobody has ever run past page one; `modules/kv-memory/files/memory.test.ts` pages 2,500
  keys for that reason.
- **`consume` receives a resolved `Policy`, and a refusal is a value.** The core looks the policy
  name up in the table and throws `not_supported` for an unregistered one, so you never do that
  lookup. Return `{ success: false }` when the budget is spent — never throw. `remaining` and
  `resetAt` are **optional and must stay honest**: Cloudflare's Rate Limiting binding reports
  `{ success }` alone, so `kv-cloudflare` returns exactly that rather than inventing a number a
  caller would put in a `RateLimit-Remaining` header. Fill them in only if your store really counts.
- **Omit `consume` entirely if the store cannot count.** The core then throws `not_supported`
  naming the provider, on the first call rather than at construction. A stub returning
  `{ success: true }` is worse than no method: it silently disables every rate limit in the project.

Failure codes are `invalid_key`, `invalid_ttl`, `too_large`, `rate_limited`, `not_supported` and
`provider_error`; the first three are usually the core's. Map the vendor's own code onto one, keep
the raw value in `providerCode`, and set `retryable` honestly — `kv-cloudflare` parses the HTTP
status out of `KV PUT failed: 429 …` and maps 429 and the 5xx family to retryable, everything else
to `provider_error` / `retryable: false`.

**Descriptor, binding flavour (`kv-cloudflare`):** one `kv_namespaces` entry matched on `binding`,
three `ratelimits` entries matched on `name`, and the registration patch.

```jsonc
{
  "name": "kv-cloudflare",
  "type": "saasaloy:feature",
  "dependsOn": ["kv"],
  "dependencies": [],
  "envVars": {},                            // the bindings are the credential
  "patches": [
    { "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding",
      "bindingType": "kv_namespaces", "matchOn": "binding",
      "entry": { "binding": "KV", "id": "<replace-me>" } },
    { "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding",
      "bindingType": "ratelimits", "matchOn": "name",
      "entry": { "name": "RL_STRICT", "namespace_id": "1001",
                 "simple": { "limit": 10, "period": 10 } } },
    { "file": "packages/kv/src/index.ts", "kind": "plugin-array",
      "exportName": "kv", "arrayProp": "providers", "call": "cloudflare",
      "import": { "name": "cloudflare", "from": "./providers/cloudflare" } }
  ],
  "files": [{ "path": "files/cloudflare.ts", "target": "@kv/providers/cloudflare.ts" }],
  "scaffolds": []
}
```

`kv_namespaces` is matched on `binding` and `ratelimits` on `name`, because that is the key each
array is identified by — get it wrong and a second `add` appends a duplicate instead of doing
nothing. An HTTP provider (`kv-upstash`) drops both wrangler patches and adds its SDK through a
`package-json-dependency` patch into `packages/kv/package.json`, exactly as `email-resend` does.

One repo-only wrinkle worth copying. A provider file reads `../provider`, which resolves inside a
scaffolded project but not inside `modules/<capability>-<provider>/files/`. To run a `node:test`
suite against the file in place, add a one-line re-export shim beside the module —
`modules/kv-memory/provider.ts` holding `export * from "../kv/files/src/provider";` — and leave it
out of the descriptor's `files` list so it never ships. `queue-memory` and `kv-memory` both do this.

## Mode: `billing`

**Interface:** `BillingProvider` in `packages/billing/src/provider.ts`. `billing-stripe` is the
vendor flavour, `billing-console` is the local one, and the capability's runbook is
`modules/billing/skills/saasaloy-billing/SKILL.md`. Read
[ADR 0034](../../../docs/adr/adr-0034-billing-tables-are-a-projection-of-the-vendors-record-2026-09-08.md)
before you start: it is what makes a payment capability take providers even though the project owns
the table.

This is the widest interface in the repo — seven methods plus an optional auth plugin — and it is
also the one where copying `email` goes wrong fastest. Five rules, in the order they bite:

- **A provider never writes the database.** `billing_subscriptions` has exactly one writer, the
  event path, and the dedupe rule lives there. Nothing in your file imports a schema, a client or
  `requireBillingStore`. A state change is reported, not written: return a `CheckoutResult.event`
  when your vendor has no webhook, or let your webhook enqueue one when it does. Never both — a
  provider that does both writes the projection twice and races itself.
- **Wrap the vendor's Better Auth plugin when it has one.** Better Auth ships plugins for Stripe,
  Polar, Dodo and Autumn, and each owns customer creation, checkout, the portal and a
  signature-verified webhook. Re-implementing that against the raw SDK is a large amount of vendor
  code you would then have to keep correct. Export a second factory, `<vendor>AuthPlugin()`, from
  the same file and register it with a second `plugin-array` patch on `packages/auth/src/auth.ts`.
  Two exports, still one file. **Build the vendor client lazily.** That factory is called while
  `packages/auth/src/auth.ts` is being imported, so a client built eagerly makes your vendor's
  secret a requirement for signing in, and takes `BILLING_PROVIDER=console` away from a
  contributor who has no account. `billing-stripe` hands the plugin a `Proxy` that builds the
  client on the first property read; copy that shape.
- **Map the plugin's model onto the core's columns, and check the map covers every field the
  plugin writes.** Better Auth plugins let a project rename the model and every field
  (`schema.subscription.modelName` + `fields`). `modelName` is the **Drizzle export key**
  (`billingSubscription`), not the SQL table name, and each field maps to a Drizzle property, not a
  column name. Read the plugin's own schema file at the pinned version and account for every entry;
  a field with no column fails at the first webhook, not at `pnpm typecheck`. Watch for fields the
  plugin writes *outside* its declared schema — `@better-auth/stripe` writes `limits` whenever a
  plan carries it, which is why `billing-stripe` does not pass `limits` through.
- **`plans.ts` is the source of truth, and the plan id is what lands in the `plan` column.** Map
  `providerIds.<yourName>.monthly` and `.yearly` onto the vendor's price fields and `trialDays`
  onto its trial field. Leave the default plan out: it has no price and nobody buys it. Name the
  vendor's plan after the plan **id**, because that is the string `entitlements` looks up.
- **Wire `authorizeSubject` into the vendor's own authorization hook.** The plugin's endpoints are
  reachable directly, so the rule in `@billing/subject.ts` has to guard them as well as the
  capability's routes. That single file is what `teams` replaces to bill organizations.

Codes are `invalid_request`, `not_found`, `card_declined`, `rate_limited`, `webhook_invalid` and
`provider_error`. Map only vendor codes you have seen, keep the raw one in `providerCode`, and set
`retryable` honestly: a rate limit and a connection failure earn it, a declined card never does.

**Descriptor** (`billing-stripe`): two `plugin-array` patches — one per door Stripe reaches the
project through — and one `package-json-dependency` per vendor package, into the **capability's**
`package.json` and never into `packages/auth`:

```jsonc
{ "file": "packages/billing/src/index.ts", "kind": "plugin-array",
  "exportName": "billing", "arrayProp": "providers", "call": "stripeBilling",
  "import": { "name": "stripeBilling", "from": "./providers/stripe" } },
{ "file": "packages/auth/src/auth.ts", "kind": "plugin-array",
  "exportName": "auth", "arrayProp": "plugins", "call": "stripeAuthPlugin",
  "import": { "name": "stripeAuthPlugin", "from": "@repo/billing/providers/stripe" } },
{ "file": "packages/billing/package.json", "kind": "package-json-dependency",
  "section": "dependencies", "name": "stripe", "range": "22.6.1" },
{ "file": "packages/billing/package.json", "kind": "package-json-dependency",
  "section": "peerDependencies", "name": "better-auth", "range": "1.7.3" }
```

The vendor's plugin peers on `better-auth`, so declare that as a **peer** dependency of
`packages/billing` rather than a direct one. Two copies of Better Auth in one project is two
session implementations.

**Does your vendor need a column on `user`?** Better Auth plugins put the customer link on the
`user` model and cannot be pointed at another table. `modules/billing` already adds
`user.billingCustomerId` with a `drizzle-column` patch, so map the plugin's own field onto it
(`schema.user.fields.stripeCustomerId: "billingCustomerId"`) rather than adding a second column.

**The local provider is not optional here, and it is not a mock.** `billing-console` runs the whole
flow — checkout, portal, change-plan, cancel, restore — with no account and no network, by
returning the event the route enqueues. It has no auth plugin, so it patches one array. Two things
it needs that a vendor provider does not: ids derived from the subject, so a second call converges
on the row the first created instead of stacking a history row; and `SubjectInput.current`, the
live row the route reads for it, because `cancel` and `restore` carry no plan and a provider with
no webhook cannot learn one.

## Mode: `storage`

**Interface:** `StorageProvider` in `packages/storage/src/provider.ts`. `storage-cloudflare` (R2) and `storage-memory` are the worked examples; the capability's runbook is `modules/storage/skills/saasaloy-storage/SKILL.md`.

Object storage is stateful, so read [ADR 0037](../../../docs/adr/0037-adr-an-alternate-implementation-that-adds-one-file-is-a-provider-2026-09-08.md) before you start. It adds the third question to ADR 0033's test: an alternate implementation that **adds one file** is a provider, one that **replaces files the core owns** is a driver. `storage` sits on the provider side because R2 speaks S3, so `storage-s3` is the same code with a different endpoint. The consequence is written into the runbook rather than hidden: a provider swap copies bytes by hand, and no migration is promised.

```ts
import { StorageError } from "../provider";
import type { StorageEnv, StorageObject, StorageProvider } from "../provider";

export function s3(): StorageProvider {
  return {
    name: "s3", // the value STORAGE_PROVIDER must hold to select this provider
    async put(env: StorageEnv, key: string, body, options): Promise<StorageObject> { … },
    async get(env, key) { … },   // resolve `null` for an absent key — absence is not an error
    async head(env, key) { … },
    async delete(env, key) { … },
    async list(env, options) { … },
    // presigning and multipart are optional; implement only what the vendor has
  };
}
```

Five contract points, and each one is a way to get a `storage-<x>` wrong:

- **Five methods are required, the rest are optional.** `put`, `get`, `head`, `delete` and `list` must exist. `presignPut`, `presignGet`, `createMultipartUpload`, `uploadPart`, `presignPart`, `completeMultipart` and `abortMultipart` may be absent, and the core answers a call to an absent one with `StorageError` code `not_supported`. Do not stub one to return a lie. `storage-memory` implements multipart for real because the export job in `file-uploads` chains pages into one multipart upload, and a stub would strand local development at the first interesting job.
- **`undefined` from a presign method means "I cannot sign", and it is not a failure.** The core reads it and falls back to the capability's own proxy route, so the browser does the same `PUT` either way. `storage-cloudflare` returns `undefined` unless all four of `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` are set — one module, both modes, no second descriptor. A provider with no signing at all simply omits the methods.
- **Absence is `null`, not a throw.** `get` and `head` resolve `null` for a key that names no object. Keep `not_found` for an operation that needed the object to be there, such as completing a multipart upload that no longer exists.
- **Normalize every failure into `StorageError`** with one of the six codes (`not_found`, `invalid_key`, `too_large`, `rate_limited`, `not_supported`, `provider_error`), the vendor's raw code in `providerCode`, and an honest `retryable`. Map only codes you have actually seen and let the rest fall through to `provider_error` / `retryable: false`. The core never retries, so `retryable` is advice to a queue consumer, not an instruction to the package.
- **Do not sign a content-type header on a presigned PUT.** A signed header must be reproduced byte for byte and a browser normalizes what it sends, so signing it turns a working upload into a 403 nobody can fix. The feature's `complete` step heads the real object, and that is where size and type are enforced — a presigned PUT cannot carry a size cap at all.

Keys arrive already built and already checked. The core runs `assertValidKey` before it calls you, so never repair, re-prefix or re-encode a key; escape it for a URL if your vendor needs that, and nothing more.

**Descriptor, binding-plus-SDK flavour.** `storage-cloudflare` needs all three patch kinds, which is the fullest a provider ever gets:

```jsonc
{
  "name": "storage-cloudflare",
  "type": "saasaloy:feature",
  "dependsOn": ["storage"],
  "dependencies": [],
  "envVars": { "R2_ACCOUNT_ID": "…", "R2_ACCESS_KEY_ID": "…", "R2_SECRET_ACCESS_KEY": "…", "R2_BUCKET_NAME": "…" },
  "patches": [
    { "file": "apps/api/wrangler.jsonc", "kind": "wrangler-binding",
      "bindingType": "r2_buckets", "entry": { "binding": "BUCKET", "bucket_name": "app-storage" },
      "matchOn": "binding" },
    { "file": "packages/storage/package.json", "kind": "package-json-dependency",
      "section": "dependencies", "name": "aws4fetch", "range": "1.0.20" },
    { "file": "packages/storage/src/index.ts", "kind": "plugin-array",
      "exportName": "storage", "arrayProp": "providers", "call": "cloudflare",
      "import": { "name": "cloudflare", "from": "./providers/cloudflare" } }
  ],
  "files": [{ "path": "files/cloudflare.ts", "target": "@storage/providers/cloudflare.ts" }],
  "scaffolds": []
}
```

`r2_buckets` entries are keyed by `binding`, which is also the `matchOn` default. It is written out above so a reader comparing this with `email-cloudflare`'s `matchOn: "name"` does not have to guess which one applies here. `storage-memory` is the minimal end of the same shape: no binding, no dependency, no secret, one `plugin-array` patch.

**Testing a storage provider in this repo.** The root `node_modules` holds dev tooling only, so a provider's npm dependency is not installed here and `../provider` does not resolve to the capability core. Both `storage-cloudflare` and `storage-memory` carry a repo-only `provider.ts` at the module root that re-exports `modules/storage/files/src/provider.ts`, and `storage-cloudflare` carries an `aws4fetch-stub.ts` its test maps onto the `aws4fetch` specifier with a `node:module` resolve hook. Neither file is in `files[]`, so neither ships. Copy that arrangement rather than skipping the tests. A fake binding proves the provider calls the vendor correctly; a real bucket is what proves the vendor call works.

## Verify before you call it done

The install path a provider must survive is a **clean project**, one command:

```sh
pnpm play:reset
cd .dev/playground && ./saasaloy add email-<provider>   # or logger-, sms-, queue-, billing-, storage-<provider>
```

That resolves `email` first, scaffolds `packages/email`, drops your file, and applies your patches
in one run — a provider's file target and patch point both resolve against a workspace that didn't
exist when the run started (`buildPlan` collects scaffold aliases up front; patches execute after
every file is written). Then run it **a second time** and confirm it is a no-op: one entry in the
`providers` array, one binding in `wrangler.jsonc`, comments intact.

## Authoring checklist

- [ ] The capability is on the provider side of the system-of-record test (ADR 0001, ADR 0033).
- [ ] `modules/<capability>-<provider>/registry-item.json`, `name` matching the directory.
- [ ] `type: saasaloy:feature`, `dependsOn: ["<capability>"]`, `scaffolds: []`.
- [ ] Exactly one file, targeted at `@<capability>/providers/<provider>.ts`.
- [ ] A `plugin-array` patch registering it on the capability's barrel.
- [ ] A non-`fetch` Worker export, if any, registered through the `handlers` array in
      `apps/api/src/worker.ts` with a second `plugin-array` patch, and gated on the capability's
      `<CAP>_PROVIDER` variable.
- [ ] Any npm dependency patched into the **capability's** `package.json`, exact-pinned.
- [ ] `envVars` declares every secret the provider reads; none baked into files.
- [ ] Failures normalized into the capability's error type, `retryable` set honestly.
- [ ] No skill folder — the capability's skill gains a row (and a runbook section if it needs one).
- [ ] Installed twice on a clean playground: second run changes nothing.
- [ ] Removed again: `saasaloy remove <capability>-<provider>` leaves every patched file
      byte-identical to before the add.
