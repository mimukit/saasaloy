import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// The SQLite half of the object record, selected by `onlyWith: "database-d1"`. Its
// Postgres twin sits beside it as `file-uploads.pg.ts`, and exactly one of the two lands
// as `packages/db/src/schema/file-uploads.ts`. Change one and change the other: they are
// the same table, and the repository, the routes and the admin screen are written against
// both. Parity is semantic rather than textual — each column is the idiomatic form for its
// dialect, and what has to match is the shape a row comes back in.
//
// **This table is the record; `packages/storage` holds the bytes.** The capability can
// move an object but knows nothing about it afterwards, so a row here is the only thing
// that can list a tenant's files, tell a finished upload from an abandoned one, or say
// whether an object is world-readable.
//
// Timestamps use `timestamp_ms`, matching `auth.sqlite.ts` and `billing.sqlite.ts`.
//
// This module owns no `db:generate` step of its own: dropping the file into
// `packages/db/src/schema/` means database's barrel and migration scripts pick the table
// up like any other (the ADR 0020 exception — schema is database's domain even when
// another module authors the table).

const timestampMs = (name: string) => integer(name, { mode: "timestamp_ms" });
const createdAtDefault = sql`(cast(unixepoch('subsecond') * 1000 as integer))`;

export const storageObjects = sqliteTable(
  "storage_objects",
  {
    /** Set by `POST /files/uploads/:id/complete` once the object passed its checks. */
    completedAt: timestampMs("completed_at"),
    /** What the uploader declared, and what `complete` verifies against the real object. */
    contentType: text("content_type").notNull(),
    createdAt: timestampMs("created_at").notNull().default(createdAtDefault),
    /** Set when the row reaches `deleted`. Every repository read filters on it being null. */
    deletedAt: timestampMs("deleted_at"),
    /**
     * `crypto.randomUUID()`, and **security-relevant**: this value is the `<id>` segment
     * of the object key, so for a public object it is the whole access control. 122
     * random bits make enumeration infeasible. Never replace it with a counter, a slug or
     * anything derived from the filename.
     */
    id: text("id").primaryKey(),
    /** The full five-segment storage key, `t/<tenantId>/<scope>/<id>/<filename>`. */
    key: text("key").notNull().unique(),
    /** Anything the caller wants to keep beside the object, as JSON. */
    metadata: text("metadata", { mode: "json" }),
    /** The session user who uploaded it, so a list can say who owns a row. */
    ownerId: text("owner_id").notNull(),
    /** `STORAGE_PROVIDER` at upload time, recorded so a later swap is legible in the table. */
    provider: text("provider").notNull(),
    /** Bytes. Declared at upload, replaced by the real size at `complete`. */
    size: integer("size").notNull(),
    /** `pending`, `ready`, `rejected`, `deleting` or `deleted`. */
    status: text("status").notNull().default("pending"),
    /**
     * Whatever a project calls a tenant: an organization id under `multitenant`, or the
     * literal `default`. `file-uploads` deliberately does not depend on `multitenant`, so
     * this is free text with no foreign key.
     */
    tenantId: text("tenant_id").notNull(),
    /**
     * `private` or `public`. Frozen at upload: the marker lives in the key's scope
     * segment, so flipping it would have to rewrite the object.
     */
    visibility: text("visibility").notNull().default("private"),
  },
  (table) => [
    // Every read is a read by tenant, so this index is the hot path.
    index("storage_objects_tenant_id_idx").on(table.tenantId),
    // The list screen and the sweep both filter by status within one tenant.
    index("storage_objects_tenant_id_status_idx").on(
      table.tenantId,
      table.status
    ),
  ]
);
