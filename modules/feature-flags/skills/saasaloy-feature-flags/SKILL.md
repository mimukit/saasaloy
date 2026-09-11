---
name: saasaloy-feature-flags
description: Runbook for the feature-flags module — typed flags with per-tenant overrides and percentage rollouts, resolved through an isolate cache over a published kv document with the database as the source of truth, plus maintenance mode and per-integration kill switches. Use when adding a flag key, toggling a flag, rolling one out to a share of users, overriding a flag for one tenant, closing the site for maintenance, switching off payments or AI or email, or working out why a toggle has not taken effect yet.
---

# feature-flags — typed flags, rollouts, maintenance mode and kill switches

`feature-flags` ships one package and seven files:

| File | What it holds |
|---|---|
| `packages/feature-flags/` | the registry, the resolver, the isolate cache and the bucketing |
| `apps/api/src/routes/feature-flags.ts` | the admin API at `/flags` |
| `apps/api/src/lib/flags.ts` | `flagsFor(c)`, the database source, and `sessionIsAdmin` |
| `apps/api/src/middleware/maintenance.ts` | the 503 page middleware |
| `packages/db/src/schema/feature-flags.ts` | `feature_flags` and `feature_flag_overrides` |
| `packages/db/src/repositories/feature-flags.ts` | every query those tables need |
| `packages/validators/src/feature-flags.ts` | the write body schema, shared by the route and `hc` |
| `packages/ui/src/blocks/feature-flags.tsx` + `apps/admin/src/routes/flags.tsx` | the Flags screen |

## Where a value comes from

The database is the source of truth. `kv` is a **published read cache**, and the isolate cache in front of it is a plain `Map`.

A read walks three levels, cheapest first:

1. the isolate's `Map`, for `FLAGS_ISOLATE_TTL_SECONDS` (default 10),
2. the published kv document for the scope — `flags:v1:global`, or `flags:v1:t:<tenantId>`,
3. the database, which also publishes the missing document.

A *value* then resolves in this order: the tenant override, the global row, the code default.

**A reader never writes on a hit.** The only write a read can do is publishing a document that was missing entirely, which happens once per scope per location (a colo reading inside the up-to-60-second window after a publish republishes the same content), not once per colo per request. Write-back on every read would scale KV writes with traffic, and the free plan allows 1,000 writes a day. Published this way, KV writes equal toggles.

## Reading a flag

```ts
import { flagsFor } from "../lib/flags";

export const checkout = new Hono().post("/", async (c) => {
  const flags = flagsFor(c);

  if (await flags.flag("billing.new-checkout", { subjectId: user.id, tenantId: org.id })) {
    return newCheckout(c);
  }
  return oldCheckout(c);
});
```

`subjectId` and `tenantId` are both optional and both passed in by you. A missing `tenantId` resolves the global value, which is right for a single-tenant project. A missing `subjectId` makes a percentage flag resolve **false** — there is nothing to bucket, and guessing would make a retry of the same request answer differently.

## Adding a flag

Two steps, and the first one needs a deploy:

```ts
// packages/feature-flags/src/flags/app.ts — your file, beside the module's system.ts
import { defineFlag } from "../define";

export function newCheckout() {
  return defineFlag({
    key: "billing.new-checkout",
    type: "percentage",
    default: false,
    description: "Route checkout through the new provider.",
  });
}
```

```ts
// packages/feature-flags/src/index.ts
export const flags = defineFlags({
  flags: [maintenanceFlag(), killPayments(), killAi(), killEmail(), newCheckout()],
});
```

`flag()`'s key set is inferred from that array, so a call with an unregistered key fails `pnpm typecheck` rather than resolving to a default at runtime. That is the trade: **a new key needs a deploy, a new value does not.**

Put your own flags in your own file. `src/flags/system.ts` belongs to the module and `saasaloy update` may rewrite it.

## The 70 seconds

A toggle in the admin app reaches every location in **about 70 seconds**, and the two numbers that add up to it are:

| Layer | Delay | Why |
|---|---|---|
| Workers KV propagation | up to ~60 s | KV is eventually consistent between locations |
| the isolate `Map` | up to `FLAGS_ISOLATE_TTL_SECONDS`, default 10 s | expiry with no invalidation — nothing can reach into another colo's isolate |

The isolate that served the toggle drops its own copy immediately, so *you* see the change on your next request. Everyone else waits.

Raise `FLAGS_ISOLATE_TTL_SECONDS` to spend fewer KV reads and wait longer; set it to `0` to skip that layer and pay a KV read per request. At the default a warm isolate costs about 8,640 reads a day, well inside the free plan's 100,000. A value that is not a whole number throws while the Worker initializes rather than falling back to 10.

**The published document has no TTL.** The admin routes republish on every change, so there is nothing an expiry would fix.

## The admin screen reads the database, never the cache

`GET /flags` queries the tables directly. That is deliberate: the published document is up to a minute behind, and showing an operator a stale copy of the switch they just moved is the failure the split exists to prevent. The cost is the other way round — the screen can be *ahead* of what a live request sees, for about a minute after a toggle.

Every write route writes the row, then republishes. A tenant write republishes the global document too, so the two documents a tenant request reads were built from the same database state.

## Percentage rollouts

Bucketing is FNV-1a 32-bit over `"<flagKey>:<subjectId>"`, modulo 100. It is synchronous, has no dependencies, and is stable: one subject gets the same answer on every request, in every colo, for as long as the share does not move.

The flag key is in the hash, not just the subject. Two flags at 10% therefore reach different tenths of the audience — bucketing on the subject alone would make the second rollout a subset of the first, and the second experiment would measure the first.

Web Crypto was rejected for this. `crypto.subtle.digest` is async, so every `flag()` call would await a digest even for a boolean flag that never buckets.

Raising a share keeps everyone who was already in it: a subject's bucket does not move, so 10% → 20% adds subjects and removes none. **Lowering it removes people who had the feature.**

## Maintenance mode

`system.maintenance` is an ordinary boolean flag. The middleware is not patched in anywhere, because which paths stay reachable is your decision:

```ts
// apps/api/src/index.ts
import { maintenance } from "./middleware/maintenance";
import { flagsFor, sessionIsAdmin } from "./lib/flags";

app.use(
  maintenance({
    flags: flagsFor,
    isAdmin: sessionIsAdmin,
    bypassPaths: ["/health", "/auth", "/flags"],
  })
);
```

Three ways past the page, checked in this order: the path is on the bypass list, the flag is off, or the caller is an admin. The path check runs first because it costs no flag read.

Put `/health` on the bypass list. A load balancer that gets a 503 may pull the Worker out of rotation. Put `/auth` there too, or an admin cannot sign in to turn maintenance back off — and `/flags`, or they cannot reach the switch once signed in.

If the flag cannot be resolved at all, the request goes through. A store outage should not take an api down on the assumption that somebody meant to close it.

## Kill switches

`kill.<integration>` keys drive `assertEnabled`:

```ts
import { KillSwitchError } from "@repo/feature-flags";
import { flagsFor } from "../lib/flags";

await flagsFor(c).assertEnabled("payments"); // throws KillSwitchError while kill.payments is off
```

Three ship: `kill.payments`, `kill.ai`, `kill.email`. All three **default to on**, because a kill switch is off-by-exception and a flag store that has never been published must not stop a project charging its customers. `system.maintenance` defaults off for the same reason read the other way.

`assertEnabled` takes the name without the prefix, and the name is typed: `assertEnabled("paymnets")` fails `pnpm typecheck`.

## Settings

| Key | Default | What it does |
|---|---|---|
| `FLAGS_ISOLATE_TTL_SECONDS` | `10` | Seconds an isolate serves its cached document. `0` disables the layer. |

The kv settings apply too: `KV_PROVIDER` selects the store and `KV_KEY_PREFIX` prefixes the document keys. Two environments sharing one namespace need different prefixes, or they share their flags.

## Troubleshooting

| Symptom | Cause |
|---|---|
| A toggle has not taken effect after 20 seconds | Normal. Wait ~70 s. Check again from a different location before you go looking for a bug. |
| Every flag reads as its code default | The document has never been published and the database has no rows. That is the correct state for a fresh install — toggle something. |
| A percentage flag is off for everyone | No `subjectId` is being passed. There is nothing to bucket, so it resolves false. |
| A tenant sees the global value | No override row exists for that tenant, or `tenantId` is not being passed to `flag()`. |
| `Flag "x.y" is not registered` | The key is not in the `flags` array in `packages/feature-flags/src/index.ts`. A new key needs a deploy. |
| `FLAGS_ISOLATE_TTL_SECONDS is "10s"` at startup | Whole seconds, no unit. Use `10`. |
| The admin screen shows a value a live route does not | Expected for about a minute after a toggle. The screen reads the database; the route reads the published document. |

## Upgrading from singular table names

This module used to name its tables `feature_flag` and `feature_flag_override`. It now names them `feature_flags` and `feature_flag_overrides`. A project that installed the old names upgrades them with one migration:

1. Run `saasaloy update feature-flags` to take the new schema file.
2. Run `pnpm --filter @repo/db db:generate`.
3. drizzle-kit asks, for each new table, whether it is created or renamed from an existing table. Pick the rename from the old name: `feature_flag` → `feature_flags`, and `feature_flag_override` → `feature_flag_overrides`.
4. Read the generated SQL before you apply it. It must rename the tables and the `feature_flag_override_key_tenant_idx` index (`ALTER TABLE ... RENAME TO ...`), and contain no `DROP TABLE` or `CREATE TABLE` for a table that holds data.
5. If it drops a table, delete that migration file and run `pnpm --filter @repo/db db:generate` again.
6. Apply the migration with your driver's command, then open the admin Flags screen to confirm that it lists your flags.

## What `remove` leaves behind

The `feature_flags` and `feature_flag_overrides` tables survive removal — run `db:generate` and read the drop migration before applying it. The published documents survive too: they have no TTL, so `flags:v1:global` and every `flags:v1:t:<tenantId>` stay in the namespace until `wrangler kv key delete` removes them.

If you wired `maintenance()` into `apps/api/src/index.ts` by hand, remove that line yourself. `saasaloy remove` does not undo an edit you made.
