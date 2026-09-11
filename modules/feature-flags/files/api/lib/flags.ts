import { ADMIN_ROLE, getSession } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import {
  listFlags,
  listOverridesForTenant,
} from "@repo/db/repositories/feature-flags";
import { createFlags } from "@repo/feature-flags";
import type { AuthRequestContext } from "@repo/auth/server";
import type { DbBindings, DbRequestContext } from "@repo/db/client";
import type { FlagSource, FlagsEnv, FlagValue } from "@repo/feature-flags";

// The wiring, and the only file in this feature that knows about all three of the database,
// the session and the flag package at once.
//
// `packages/feature-flags` deliberately imports no `@repo/db`: it takes a `FlagSource` and
// asks it for two records of values. This file is the implementation of that interface over
// the repository, which is what keeps the resolver, the bucketing and the evaluation
// testable with a plain object and keeps a database driver out of a package with no reason
// to know which one is installed.

/** What a flags route needs on `c.env`: the database binding plus the kv and flags settings. */
export type FlagsBindings = DbBindings & FlagsEnv;

/** The slice of Hono's context this file reads. Structural, like `DbRequestContext`. */
export type FlagsRequestContext = DbRequestContext & {
  env: FlagsBindings;
};

/**
 * Turn a stored row into the value the resolver reads.
 *
 * `percentage` is normalized to `null` on anything that is not a number, because a row
 * written before a flag became a percentage flag can carry whatever was there before, and
 * `evaluate` treats a missing share as zero rather than guessing.
 */
function toValue(row: {
  enabled: boolean;
  percentage: number | null;
}): FlagValue {
  return {
    enabled: row.enabled,
    percentage: typeof row.percentage === "number" ? row.percentage : null,
  };
}

/**
 * The database, presented as a `FlagSource`.
 *
 * Each call opens its own `withDb` scope. Under `database-postgres` that is a connection
 * per load, closed when the load settles; under `database-d1` there is no socket and the
 * wrapper is a pass-through. It is never a per-request cost in practice, because the
 * resolver only reaches this level when a scope's document is missing from kv entirely.
 */
export function dbFlagSource(c: FlagsRequestContext): FlagSource {
  return {
    async loadGlobal(): Promise<Record<string, FlagValue>> {
      const rows = await withDb(c, (db) => listFlags(db));
      return Object.fromEntries(rows.map((row) => [row.key, toValue(row)]));
    },
    async loadTenant(tenantId: string): Promise<Record<string, FlagValue>> {
      const rows = await withDb(c, (db) =>
        listOverridesForTenant(db, tenantId)
      );
      return Object.fromEntries(rows.map((row) => [row.flagKey, toValue(row)]));
    },
  };
}

/**
 * The flag client for this request.
 *
 * ```ts
 * const flags = flagsFor(c);
 * if (await flags.flag("billing.new-checkout", { subjectId: user.id })) { ... }
 * ```
 *
 * Cheap to call. It builds two closures and a `createKv(env)`; the isolate cache behind it
 * is module-scope, so two calls in one request share whatever the first one read.
 */
export function flagsFor(c: FlagsRequestContext) {
  return createFlags(c.env, dbFlagSource(c));
}

/**
 * Whether this request carries an admin session — what `maintenance()` bypasses on.
 *
 * It answers `false` rather than throwing for a signed-out caller, because during
 * maintenance an anonymous request is the ordinary case and a 401 would replace the
 * maintenance page with an authentication error.
 */
export async function sessionIsAdmin(c: AuthRequestContext): Promise<boolean> {
  const session = await getSession(c);
  return session?.user.role === ADMIN_ROLE;
}
