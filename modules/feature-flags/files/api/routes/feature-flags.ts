import { zValidator } from "@hono/zod-validator";
import { requireAdmin, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import {
  deleteOverride,
  listFlags,
  listOverrides,
  upsertFlag,
  upsertOverride,
} from "@repo/db/repositories/feature-flags";
import { flags } from "@repo/feature-flags";
import { errorBody } from "@repo/validators/common";
import { flagValueInput } from "@repo/validators/feature-flags";
import { Hono } from "hono";
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
//   **Every write republishes.** The database row changes, then `publish()` rewrites the
//   affected document. A KV write happens per toggle, not per read, which is what keeps the
//   whole feature inside Workers KV's 1,000 free daily writes.
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file, built
// as ONE chained expression. Split it into separate `featureFlags.get(...)` statements and
// the exported type forgets the route, which empties it out of `AppType`. The name has to be
// an `export const`: the `chained-route` codemod writes
// `import { featureFlags } from "./routes/feature-flags"` and refuses to wire a binding that
// resolves to a default import.
//
// This module's `chained-route` patch mounts it at `/flags`, so `get("/")` serves
// `GET /flags`. Paths here are relative to that mount.
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
    const issue = result.error.issues[0];
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
  .get("/", (c) =>
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
  .get("/:key", (c) =>
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
  // the global document is republished, and every isolate picks it up as its cache expires.
  .put("/:key", validateValue, (c) =>
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

      const value = c.req.valid("json");

      await withDb(c, (db) =>
        upsertFlag(db, {
          description: definition.description ?? null,
          enabled: value.enabled,
          key,
          percentage: shareFor(definition.type, value.percentage),
          type: definition.type,
        })
      );

      const document = await publish(c);
      return c.json({ ok: true, publishedAt: document.publishedAt }, 200);
    })
  )

  // A tenant override, the level that beats the global value.
  .put("/:key/tenants/:tenantId", validateValue, (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);

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

      await withDb(c, (db) =>
        upsertOverride(db, {
          enabled: value.enabled,
          flagKey: key,
          percentage: shareFor(definition.type, value.percentage),
          tenantId,
        })
      );

      const document = await publish(c, tenantId);
      return c.json({ ok: true, publishedAt: document.publishedAt }, 200);
    })
  )

  // Clearing an override deletes the row. The absence is the inheritance: with no row the
  // tenant resolves whatever global says, now and after global next changes.
  .delete("/:key/tenants/:tenantId", (c) =>
    withAuthScope(c, async () => {
      await requireAdmin(c);

      const key = c.req.param("key");
      const tenantId = c.req.param("tenantId");
      if (!definitionFor(key)) {
        return c.json(
          errorBody("not_found", `No flag named "${key}" is registered.`),
          404
        );
      }

      await withDb(c, (db) => deleteOverride(db, key, tenantId));

      const document = await publish(c, tenantId);
      return c.json({ ok: true, publishedAt: document.publishedAt }, 200);
    })
  );

/**
 * Republish a scope after a write, and drop this isolate's own cached copy so the operator
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
