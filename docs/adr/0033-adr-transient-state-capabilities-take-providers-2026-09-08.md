# 0033 — Transient-state capabilities take providers

A capability takes **drivers** when the project queries and migrates the state the capability holds, and **providers** when the platform owns that state or the service holds none. This is the system-of-record test, and it replaces the stateless/stateful wording that [ADR 0001](0001-adr-all-in-on-cloudflare-2026-07-22.md)'s 2026-08-04 amendment and [ADR 0026](0026-adr-database-driver-split-2026-08-28.md) both lean on. Under the new test `queue`, `kv`, `email`, `sms` and `logger` take providers; `database` and `storage` take drivers. Settled while planning issue [#125](https://github.com/mimukit/saasaloy/issues/125) (`docs/plans/0049-plan-queue-capability-module-2026-09-08.md`).

## Status
accepted. Amends ADR 0001's 2026-08-04 amendment, which is the record that says "applying the amendment to a stateful capability requires a new ADR". Amends ADR 0026, whose "Driver, not provider" section keeps its shape argument and loses its state argument.

## Why the old wording does not decide `queue`

ADR 0001's amendment splits the world into "stateless third-party services", which may be multi-provider, and "stateful infrastructure", which stays single-provider. A queue fails that split. It holds messages, so it is not stateless. Nobody queries those messages, migrates them, or expects them to survive the week, so calling it stateful puts it beside D1 and hands `queue` the driver shape it does not need.

The same reading breaks on `kv`. A KV namespace holds data with a TTL that the project never migrates. It breaks on `logger` in the other direction, because log lines are data too, and no one has ever suggested `logger-console` and `logger-cloudflare` exclude each other.

The test that actually separated `database` from `email` was never statefulness. It was **who owns the record**. Rows in `packages/db` are the project's own record: the project writes the schema, generates the migrations, and reads them back with queries it wrote. A queued message is the platform's record, transient by construction and readable only through the platform's own consumer. That distinction is what this ADR makes the rule.

## The system-of-record test

Ask two questions about the state the capability holds.

1. **Does the project own the schema and the migrations?** Drivers, if yes.
2. **Does the project query the state directly, and would a swap require moving existing data?** Drivers, if yes.

A capability takes providers when both answers are no: the platform owns the state, the state is transient, or the service holds no state at all. Providers coexist, `<CAP>_PROVIDER` picks one at runtime, and a project keeps a local provider installed beside the real one. Drivers exclude each other through `conflictsWith`, the capability names them in `requiresOneOf`, exactly one is installed, and `saasaloy add` enforces both at install time.

The doubtful case is `storage`. R2 holds objects the project does address directly by key, and a swap to S3 moves every one of them, so `storage` sits on the driver side even though it needs no migration file. The first question fails it and the second settles it. When a future capability answers the two questions differently from each other, the second question wins, because a data migration is the cost the shape exists to make visible.

### Which side each capability sits on

| Capability | Shape | Why |
|---|---|---|
| `email` | providers | No state. An email send is an endpoint. |
| `sms` | providers | No state, and no Cloudflare product at all. |
| `logger` | providers | The sink owns the lines; nothing reads them back through the capability. |
| `queue` | providers | The platform owns the messages, they are transient, and no consumer queries them. |
| `kv` | providers | The platform owns the entries and they carry a TTL. |
| `billing` | providers | The vendor owns the customer and the subscription. The project's table is a projection of that record, and a swap re-subscribes rather than migrates ([ADR 0034](adr-0034-billing-tables-are-a-projection-of-the-vendors-record-2026-09-08.md)). |
| `database` | drivers | The project owns the schema and the migrations, and queries the rows. |
| `storage` | drivers | The project addresses objects by key, and a swap moves every object. |

`database` stays on drivers, and ADR 0026 stands unchanged in substance. What changes is its stated reason: it is on that side because the project owns the rows, not because the capability holds state.

## What a binding provider registers, and where

A provider for a capability that needs a Workers binding registers through the generated project's own code and its own `wrangler.jsonc`, never through `infra`.

- **A handler export goes into the `handlers` table in `apps/api/src/worker.ts`**, appended by a `plugin-array` patch. `worker.ts` is the wrangler `main`, and its local `defineWorker({ fetch: app.fetch, handlers: [] })` merges each set's `queue` and `scheduled` exports into the object the Worker exports. `apps/api/src/index.ts` keeps `export default app` and `AppType`, so [ADR 0028](0028-adr-routes-register-by-chained-route-patch-2026-08-28.md)'s `chained-route` codemod is untouched. This is a [registration table](../../CONTEXT.md), not a folder scan, for ADR 0028's reason: a table yields a type and a `remove` that takes the line back out.
- **`infra` is not the registration path.** `modules/infra` provisions resources with Pulumi ([ADR 0021](0021-adr-pulumi-iac-engine-for-infra-2026-07-25.md)) and its translator reads `wrangler.jsonc` after the fact. A provider that registered there would put its binding outside the file the Worker builds from, and a project that never installs `infra` would get no binding at all. The provider patches `wrangler.jsonc`; `infra` catches up. Today its `translate.ts` covers `d1_databases` and `vars` and refuses the rest, so `send_email`, `queues`, `triggers` and `workflows` are a known gap tracked in its own issue, and each affected capability's skill states it.
- **A binding provider may carry several patches.** The one-file rule in `.agents/skills/create-provider/` is about the *runtime* surface: one file in `providers/`. The descriptor side is whatever the vendor needs. `email-cloudflare` already carries two patches, and `queue-cloudflare` carries six. The size test that matters is unchanged: if a new provider needs a second runtime file or a scaffold of its own, the contract is wrong, and fixing the contract is the answer.

## Considered Options

- **Keep the stateless/stateful wording and rule `queue` stateless.** Rejected because it is not true, and the next capability would have to stretch the word again. `kv` would need the same stretch a week later.
- **Give `queue` drivers.** Rejected because it costs the local provider. `queue-memory` beside `queue-cloudflare`, with `QUEUE_PROVIDER` picking, is the reason a project can run a job with no Cloudflare account. `conflictsWith` would allow only one of the two, and the one a developer wants at their desk is not the one that ships.
- **Decide per capability with no rule.** Rejected because the question has come up three times in six weeks and would come up eleven more, once per catalog module that touches a service.
- **Let a provider register its handler through `infra`.** Rejected above: it splits the Worker's own configuration from the file the Worker builds from.

## Consequences

- **`wrangler-binding` gains a dotted `bindingType`.** Queues bindings live at `queues.producers` and `queues.consumers`, the cron tick at `triggers.crons`, and Workflows at `workflows`. `packages/cli/src/lib/patch/jsonc.ts` reads a single-segment path today, so `upsertWranglerBinding`, `removeWranglerBinding` and `matchWranglerBinding` split the value on `.`, create missing parents on insert, and unwind them on removal so the file returns byte-identical. A value with no dot keeps today's behaviour exactly, so `database-d1`, `database-postgres`, `auth` and `email-cloudflare` are untouched. No new patch kind.
- **`apps/api` splits its entry.** `modules/api` ships `src/worker.ts` and points wrangler `main` at it. `src/index.ts` stays the Hono app and gains no line. `vite.config.ts` needs no edit, because `@cloudflare/vite-plugin` reads the entry from `wrangler.jsonc`. Every project scaffolded before this carries the old single-entry shape until `update` reaches it.
- **The two shapes are now a rule an author applies, not a precedent they read.** `.agents/skills/create-module/` and `.agents/skills/create-provider/` state the test, and a new capability answers the two questions before it picks a shape.
- **Nothing reopens.** No `core` interfaces package, no `saasaloy migrate db`, no per-provider deploy targets. A provider capability still promises only that a project can *start* on a different vendor; it promises no migration of work already queued.

## References
Issue [#125](https://github.com/mimukit/saasaloy/issues/125), `docs/plans/0049-plan-queue-capability-module-2026-09-08.md`. Amends [ADR 0001](0001-adr-all-in-on-cloudflare-2026-07-22.md) (its 2026-08-04 amendment) and [ADR 0026](0026-adr-database-driver-split-2026-08-28.md). Related: [ADR 0020](0020-adr-capability-owns-its-vendor-packages-2026-07-24.md), [ADR 0021](0021-adr-pulumi-iac-engine-for-infra-2026-07-25.md), [ADR 0028](0028-adr-routes-register-by-chained-route-patch-2026-08-28.md). Glossary: `CONTEXT.md` → "Provider module", "Driver module", "Job", "Schedule", "Handler set".
