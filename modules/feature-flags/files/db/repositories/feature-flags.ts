import { and, eq } from "drizzle-orm";
import { featureFlag, featureFlagOverride } from "../schema/feature-flags";
import type { Db } from "../client";

// Every query the flag tables need, in one file, written once for both dialects. The table
// declarations are the only part of this feature that knows whether it is talking to SQLite
// or Postgres (`schema/feature-flags.sqlite.ts` and `.pg.ts`), and Drizzle's query builder
// is neutral at call time — so this file ships once and `apps/api` never branches on the
// driver.
//
// It returns rows, not resolved flags. Turning a row into a value the resolver understands
// happens in `apps/api/src/lib/flags.ts`, which keeps `packages/db` free of any dependency
// on `@repo/feature-flags` and keeps the flag semantics in one package rather than two.

export interface FlagRowInput {
  key: string;
  enabled: boolean;
  /** 0–100 on a percentage flag; `null` on a boolean one. */
  percentage: number | null;
  type: string;
  description?: string | null;
}

export interface OverrideRowInput {
  flagKey: string;
  tenantId: string;
  enabled: boolean;
  percentage: number | null;
}

/** Every global row. The admin screen's list, and the global document's contents. */
export function listFlags(db: Db) {
  return db.select().from(featureFlag);
}

/** Every override, for the admin screen. Small by construction: one row per flag per tenant. */
export function listOverrides(db: Db) {
  return db.select().from(featureFlagOverride);
}

/** One tenant's overrides. What the tenant document is published from. */
export function listOverridesForTenant(db: Db, tenantId: string) {
  return db
    .select()
    .from(featureFlagOverride)
    .where(eq(featureFlagOverride.tenantId, tenantId));
}

/**
 * Insert or update the global row for a key.
 *
 * Upsert rather than insert-then-update: a flag has no row until somebody toggles it, so
 * the first write from the admin screen is an insert and every later one is an update, and
 * the caller should not have to know which.
 */
export function upsertFlag(db: Db, input: FlagRowInput) {
  const now = new Date();
  return db
    .insert(featureFlag)
    .values({
      description: input.description ?? null,
      enabled: input.enabled,
      key: input.key,
      percentage: input.percentage,
      type: input.type,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: featureFlag.key,
      set: {
        description: input.description ?? null,
        enabled: input.enabled,
        percentage: input.percentage,
        type: input.type,
        updatedAt: now,
      },
    });
}

/** Insert or update one tenant's override for a key. */
export function upsertOverride(db: Db, input: OverrideRowInput) {
  const now = new Date();
  return db
    .insert(featureFlagOverride)
    .values({
      enabled: input.enabled,
      flagKey: input.flagKey,
      percentage: input.percentage,
      tenantId: input.tenantId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: [featureFlagOverride.flagKey, featureFlagOverride.tenantId],
      set: {
        enabled: input.enabled,
        percentage: input.percentage,
        updatedAt: now,
      },
    });
}

/**
 * Remove one tenant's override.
 *
 * Deleting is how an override is cleared, because the absence of a row *is* the
 * inheritance: with no row the tenant resolves the global value. Storing "same as global"
 * would freeze the tenant at whatever global happened to be that day.
 */
export function deleteOverride(db: Db, flagKey: string, tenantId: string) {
  return db
    .delete(featureFlagOverride)
    .where(
      and(
        eq(featureFlagOverride.flagKey, flagKey),
        eq(featureFlagOverride.tenantId, tenantId)
      )
    );
}
