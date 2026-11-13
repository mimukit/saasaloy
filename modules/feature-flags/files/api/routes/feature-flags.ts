import { zValidator } from "@hono/zod-validator";
import { adminGate, requireAdmin, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import type { Db } from "@repo/db/client";
import {
  deleteOverride,
  listFlags,
  listOverrides,
  listOverridesForTenant,
  upsertFlag,
  upsertOverride,
} from "@repo/db/repositories/feature-flags";
import { flags } from "@repo/feature-flags";
import { errorBody } from "@repo/validators/common";
import { flagValueInput } from "@repo/validators/feature-flags";
import { Hono } from "hono";
import { adminWrite } from "../lib/admin-write";
import { flagsFor } from "../lib/flags";
import type { AuthDbBindings } from "@repo/auth/server";
import type { FlagsBindings, FlagsRequestContext } from "../lib/flags";

// The admin API behind the Flags screen. Five routes: list, read one, set the global value,
// set a tenant override, clear a tenant override.
//
// Two rules run through all of them, and they are the reason this feature works the way it
// promises:
//
//   **Every read here goes to the database, never to the cache.** The screen that just wrote
//   a value must not be shown the published document, which is by design up to ~70 seconds
//   behind. A reader route elsewhere in your api uses `flagsFor(c).flag(...)` and gets the
//   fast, slightly stale answer; this file gets the true one.
//
//   **Every write republishes, after it commits.** The database row changes, then
//   `publish()` rewrites the affected document. A KV write happens per toggle, not per
//   read, which is what keeps the whole feature inside Workers KV's 1,000 free daily
//   writes. The publish is queued with `afterCommit`, so a kv document never shows a value
//   whose write rolled back. It runs on `waitUntil`, so a write answers `{ ok: true }`
//   without waiting for kv.
//
// The three writes run through `adminWrite` (`../lib/admin-write.ts`): the admin check,
// one transaction, and one audit row per change, inserted with it. Their actions are in
// `../audit/feature-flags.ts`. Every query of a write goes through the scope's `db`.
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file, built
// as ONE chained expression. Split it into separate `featureFlags.get(...)` statements and
// the exported type forgets the route, which empties it out of `AppType`. The name has to be
// an `export const`: the `chained-route` codemod writes
// `import { featureFlags } from "./routes/feature-flags"` and refuses to wire a binding that
// resolves to a default import.
//
// This module's `chained-route` patch mounts it at `/admin/flags`, so `get("/")` serves
// `GET /admin/flags` and `hc<AppType>` types it for the admin app as `api.admin.flags`.
// Paths here are relative to that mount. It sits under `/admin/` so the admin gate test
// and the audit coverage test see its routes. The mount is `/admin/flags` and not `/admin`
// because a `chained-route` patch matches on its path, and `admin` already routes `/admin`.
//
// Every route lists `adminGate` first, before `validateValue`, so a caller with no admin
// session gets a 401 and never a 400 that describes the flag value. A read still calls
// `requireAdmin` inside its own scope, and a write's `adminWrite` checks again; the gate
// only decides who reaches the handler.
//
// No CORS and no `onError`: `modules/api`'s spine applies the credentialed `CORS_ORIGINS`
// allowlist before this sub-app is mounted, and an unset `onError` inherits api's, which
// renders the `HTTPException` `requireAdmin` throws as the shared error envelope.

type Bindings = AuthDbBindings & FlagsBindings;

/**
 * The shared failure hook for every write route.
 *
 * Without it `zValidator` answers with Hono's default body; with it, a rejected value gets
 * the `{ error: { code, message } }` envelope the rest of the api uses, and `hc` sees a 400
 * whose shape the admin screen can branch on.
 */
const validateValue = zValidator("json", flagValueInput, (result, c) => {
  if (!result.success) {
    const [issue] = result.error.issues;
    const message = issue
      ? `${issue.path.join(".")}: ${issue.message}`
      : "invalid request body";
    return c.json(errorBody("invalid_input", message), 400);
  }
});

/** The stored share for a flag: a number on a percentage flag, `null` on a boolean one. */
function shareFor(
  type: "boolean" | "percentage",
  percentage: number | null | undefined
): number | null {
  // A boolean flag stores no share. Keeping one would leave a number in the table that
  // nothing reads and that the next reader would have to guess the meaning of.
  return type === "percentage" ? (percentage ?? null) : null;
}

function definitionFor(key: string) {
  return flags.flags.find((definition) => definition.key === key);
}

export const featureFlags = new Hono<{ Bindings: Bindings }>()
  // The screen's whole payload in one request: the code definitions (which say what a flag
  // is and what it defaults to), the global rows, and every override. Definitions and rows
  // are separate on purpose — a flag with no row is the normal state, not a gap to fill.
  .get("/", adminGate, (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);

      const { overrides, rows } = await withDb(c, async (db) => ({
        overrides: await listOverrides(db),
        rows: await listFlags(db),
      }));
      const byKey = new Map(rows.map((row) => [row.key, row]));

      return c.json(
        {
          flags: flags.flags.map((definition) => {
            const row = byKey.get(definition.key);
            return {
              codeDefault: definition.default,
              description: row?.description ?? definition.description ?? null,
              // No row means nothing has ever been set, so the code default applies. The
              // screen shows that state rather than pretending the flag is off.
              enabled: row?.enabled ?? definition.default,
              hasRow: row !== undefined,
              key: definition.key,
              percentage: row?.percentage ?? null,
              type: definition.type,
            };
          }),
          overrides: overrides.map((override) => ({
            enabled: override.enabled,
            flagKey: override.flagKey,
            percentage: override.percentage,
            tenantId: override.tenantId,
          })),
        },
        200
      );
    })
  )

  // One flag, for a screen that deep-links to it. Same database-only rule as the list.
  .get("/:key", adminGate, (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);

      const key = c.req.param("key");
      const definition = definitionFor(key);
      if (!definition) {
        return c.json(
          errorBody("not_found", `No flag named "${key}" is registered.`),
          404
        );
      }

      const rows = await withDb(c, (db) => listFlags(db));
      const row = rows.find((candidate) => candidate.key === key);

      return c.json(
        {
          flag: {
            codeDefault: definition.default,
            description: row?.description ?? definition.description ?? null,
            enabled: row?.enabled ?? definition.default,
            hasRow: row !== undefined,
            key,
            percentage: row?.percentage ?? null,
            type: definition.type,
          },
        },
        200
      );
    })
  )

  // The global value. This is the toggle that takes effect with no deploy: the row lands,
  // the global document is republished after the commit, and every isolate picks it up as
  // its cache expires.
  .put("/:key", adminGate, validateValue, (c) =>
    adminWrite(c, async ({ db, audit, afterCommit }) => {
      const key = c.req.param("key");
      const definition = definitionFor(key);
      if (!definition) {
        return c.json(
          errorBody("not_found", `No flag named "${key}" is registered.`),
          404
        );
      }

      const value = c.req.valid("json");
      const percentage = shareFor(definition.type, value.percentage);
      const before = await storedFlag(db, key);

      await upsertFlag(db, {
        description: definition.description ?? null,
        enabled: value.enabled,
        key,
        percentage,
        type: definition.type,
      });
      audit({
        action: "flag.value.set",
        after: { enabled: value.enabled, percentage },
        before: before ? valueOf(before) : null,
        target: { id: key, label: key },
      });

      afterCommit(() => publish(c));
      return c.json({ ok: true }, 200);
    })
  )

  // A tenant override, the level that beats the global value.
  .put("/:key/tenants/:tenantId", adminGate, validateValue, (c) =>
    adminWrite(c, async ({ db, audit, afterCommit }) => {
      const key = c.req.param("key");
      const tenantId = c.req.param("tenantId");
      const definition = definitionFor(key);
      if (!definition) {
        return c.json(
          errorBody("not_found", `No flag named "${key}" is registered.`),
          404
        );
      }

      const value = c.req.valid("json");
      const percentage = shareFor(definition.type, value.percentage);
      const before = await storedOverride(db, key, tenantId);

      await upsertOverride(db, {
        enabled: value.enabled,
        flagKey: key,
        percentage,
        tenantId,
      });
      audit({
        action: "flag.tenant.set",
        after: { enabled: value.enabled, percentage },
        before: before ? valueOf(before) : null,
        target: tenantTarget(key, tenantId),
      });

      afterCommit(() => publish(c, tenantId));
      return c.json({ ok: true }, 200);
    })
  )

  // Clearing an override deletes the row. The absence is the inheritance: with no row the
  // tenant resolves whatever global says, now and after global next changes. Clearing an
  // override that does not exist changes nothing, so it writes no audit row.
  .delete("/:key/tenants/:tenantId", adminGate, (c) =>
    adminWrite(c, async ({ db, audit, afterCommit }) => {
      const key = c.req.param("key");
      const tenantId = c.req.param("tenantId");
      if (!definitionFor(key)) {
        return c.json(
          errorBody("not_found", `No flag named "${key}" is registered.`),
          404
        );
      }

      const before = await storedOverride(db, key, tenantId);

      await deleteOverride(db, key, tenantId);
      if (before) {
        audit({
          action: "flag.tenant.clear",
          before: valueOf(before),
          target: tenantTarget(key, tenantId),
        });
      }

      afterCommit(() => publish(c, tenantId));
      return c.json({ ok: true }, 200);
    })
  );

/** The stored global row of one flag, or `undefined` when none was ever written. */
async function storedFlag(db: Db, key: string) {
  const rows = await listFlags(db);
  return rows.find((row) => row.key === key);
}

/** One tenant's stored override of one flag, or `undefined` when it has none. */
async function storedOverride(db: Db, key: string, tenantId: string) {
  const rows = await listOverridesForTenant(db, tenantId);
  return rows.find((row) => row.flagKey === key);
}

/** A stored row's value, as an audit row records it. */
function valueOf(row: { enabled: boolean; percentage: number | null }) {
  return { enabled: row.enabled, percentage: row.percentage };
}

/**
 * A tenant override as the audit log names it. The id is the flag key, so a filter by
 * target finds every change to the flag, global and per tenant; the label names the tenant.
 */
function tenantTarget(key: string, tenantId: string) {
  return { id: key, label: `${key} · tenant ${tenantId}` };
}

/**
 * Republish a scope after a write commits, and drop this isolate's own cached copy so the operator
 * who just toggled sees the change on their next request rather than waiting out the TTL.
 *
 * Every other isolate still waits: nothing can reach into another colo to invalidate a
 * `Map`, which is exactly why the TTL is 10 seconds.
 */
async function publish(c: FlagsRequestContext, tenantId?: string) {
  const client = flagsFor(c);
  const global = await client.publish();
  if (tenantId === undefined) {
    return global;
  }
  // A tenant write republishes the global document too. It costs one extra KV write per
  // toggle — nothing against the 1,000 free daily writes — and it means the two documents a
  // tenant request reads were built from the same database state, so an override can never
  // sit next to a global value that has since moved.
  return client.publish(tenantId);
}
