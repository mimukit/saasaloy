import { and, eq } from "drizzle-orm";
import type { Column, SQL } from "drizzle-orm";
import type { Db } from "./client";

// The repository guard: a branded id nothing but `requireTenant` mints, and one wrapper
// that appends the tenant filter to every query it builds. Two compile errors, not a
// runtime check — a scoped read written without the tenant id does not build, and a table
// with no `organizationId` column does not fit.
//
// This file is dialect-neutral. It never names `sqliteTable` or `pgTable`; it reads the
// table type back out of `Db`, which `database-d1` and `database-postgres` each declare
// for the driver the project holds. One file, both drivers.
//
// WHAT THIS DOES NOT DO: nothing stops a route from importing `db` and writing a raw
// `db.select().from(projects)`. v1 enforces the wrapper by convention and by the
// `saasaloy-multitenant` skill; a lint rule that refuses raw `db` on a tenant table is a
// filed follow-up. Review a scoped route for the `forTenant(` call the way you review it
// for the `requireTenant(` call.

declare const TENANT_ID: unique symbol;

/**
 * An organization id that has been through `requireTenant`. It is a `string` at runtime
 * and a distinct type at compile time, so a route cannot hand `forTenant` a slug, a user
 * id, or an `x-organization-id` header value it read itself.
 *
 * The brand is the whole design. Widen this to `string` and every guarantee below turns
 * into a naming convention.
 */
export type TenantId = string & { readonly [TENANT_ID]: "TenantId" };

/**
 * Mint a `TenantId` from a raw string.
 *
 * `packages/auth/src/tenant.ts` calls this, and nothing else should. It is the one place
 * the brand is applied, and it is applied only after `requireTenant` has resolved the
 * organization from a session's membership, a superadmin bypass, or a credential
 * resolver. Calling it on a value a request supplied hands the caller another
 * organization's rows, which is precisely the bug the brand exists to catch.
 */
export function asTenantId(value: string): TenantId {
  return value as TenantId;
}

/**
 * The table type this driver's Drizzle client accepts, read back off `Db` so this file
 * names neither dialect. Under `database-d1` it resolves to `SQLiteTable`, under
 * `database-postgres` to `PgTable`.
 */
type DialectTable = Parameters<Db["insert"]>[0];

/**
 * A table `forTenant` will scope: any table of this project's dialect that carries an
 * `organizationId` column. A table without one is a compile error at the call site, which
 * is what makes the tenant column convention enforceable rather than advisory.
 */
export type TenantTable = DialectTable & { organizationId: Column };

/** A row to insert, minus the tenant id — `forTenant` supplies that itself. */
export type TenantInsert<T extends TenantTable> = Omit<
  T["$inferInsert"],
  "organizationId"
>;

/** The columns an update may set. The tenant id is not one of them. */
export type TenantUpdate<T extends TenantTable> = Partial<
  Omit<T["$inferInsert"], "organizationId">
>;

/**
 * Every query builder this wrapper hands back, already filtered to one organization.
 *
 * `select`, `update` and `delete` append `eq(table.organizationId, tenantId)`; `insert`
 * forces the column rather than filtering on it. Chain `.where(...)` on the result to add
 * your own condition — the tenant filter is already in there, and Drizzle ANDs a second
 * `.where` onto it only if you pass `and(...)` yourself, so prefer the `where` argument
 * each method below takes.
 */
export function forTenant(db: Db, tenantId: TenantId) {
  const scope = <T extends TenantTable>(table: T, extra?: SQL | undefined) =>
    extra
      ? and(eq(table.organizationId, tenantId), extra)
      : eq(table.organizationId, tenantId);

  return {
    /** Every column of `table` belonging to this organization. */
    select<T extends TenantTable>(table: T, where?: SQL) {
      // The third cast, and it is dialect-driven. `database-postgres`' `.from()` guards
      // its argument with `TableLikeHasEmptySelection<T> extends true ? DrizzleTypeError
      // : T`, and a bare generic `T` cannot be shown to fail that test from inside a
      // generic function, so `tsc` refuses it under Postgres and accepts it under D1.
      // The public signature above is the strict one, and `T extends TenantTable` is
      // already a real table of this project's dialect.
      // The row type is restated rather than inferred, for the same reason: it is
      // `T["$inferSelect"][]`, which is what `.from(projects)` would have inferred at a
      // concrete call site. The builder is a thenable and every call site awaits it.
      // Cast the BUILDER, not the method. `const from = db.select().from` drops the
      // receiver, and Drizzle's `from` reads `this`, so that version throws at runtime
      // while it typechecks.
      const builder = db.select() as unknown as {
        from: (table: DialectTable) => {
          where: (condition: SQL | undefined) => Promise<T["$inferSelect"][]>;
        };
      };
      return builder.from(table).where(scope(table, where));
    },

    /**
     * Insert with the tenant id forced on. Passing `organizationId` yourself is a
     * compile error, so a row cannot be written into another organization by a typo in a
     * request body that was spread into `values`.
     */
    insert<T extends TenantTable>(table: T, values: TenantInsert<T>) {
      // The one cast in this file. `T` is generic here, so Drizzle's mapped insert type
      // cannot be proven equal to `T["$inferInsert"]` from inside; the public signature
      // above is the strict one, and it is what every call site is checked against.
      return db
        .insert(table)
        .values({ ...values, organizationId: tenantId } as T["$inferInsert"]);
    },

    /** Update rows of this organization only. The tenant id itself cannot be set. */
    update<T extends TenantTable>(table: T, set: TenantUpdate<T>, where?: SQL) {
      const builder = db.update(table);
      // The second cast, for the reason `insert` gives: `T` is generic here, so Drizzle's
      // mapped update type cannot be proven equal to the `Omit` above from inside. The
      // public signature is the strict one, and it refuses `organizationId`.
      return builder
        .set(set as Parameters<typeof builder.set>[0])
        .where(scope(table, where));
    },

    /** Delete rows of this organization only. */
    delete<T extends TenantTable>(table: T, where?: SQL) {
      return db.delete(table).where(scope(table, where));
    },
  };
}
