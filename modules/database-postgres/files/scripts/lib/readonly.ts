// The read-only production role an agent debugs with: its name, and the SQL that grants it
// what it may read. `pnpm db:prod:readonly-grants` and `pnpm db:prod:migrate` apply the
// plan (`./readonly-grants.ts`), and `pnpm db:prod:query` connects as the role.
//
// Every column has one class, from the files in `packages/db/src/column-classes/`:
//
//   secret  never granted. The role cannot select it, and cannot name it in a WHERE clause.
//   pii     granted, so a search by email works, and masked in `db:prod:query` output.
//   plain   granted and printed as it is.
//
// There is no table-level grant and no `ALTER DEFAULT PRIVILEGES`: a table-level grant
// covers every future column, so a new secret column would be readable on the day its
// migration lands. The class test in `pnpm test` fails on a schema column with no class.
//
// This file imports nothing, so `pnpm test:modules` tests it with no Drizzle and no `src/`.
// The class type is declared here by shape; `TableClasses` in `src/column-class.ts` fits it.

/** How the read-only role may read a column. The same union as `src/column-class.ts`. */
export type ColumnClass = "secret" | "pii" | "plain";

/** One table's classes, keyed by SQL column name, as `src/column-classes.ts` exports them. */
export interface ClassifiedTable {
  table: string;
  columns: Readonly<Record<string, ColumnClass>>;
}

/** A live table in `public` and its columns, in table order. */
export interface TableColumns {
  table: string;
  columns: readonly string[];
}

/**
 * The read-only role's name, from the dev prefix `databasePrefix` gives:
 * `acme_shop_dev` becomes `acme_shop_ro`.
 */
export function readonlyRoleName(devPrefix: string): string {
  return devPrefix.replace(/_dev$/, "_ro");
}

/** A double-quoted SQL identifier. */
export function quoteIdent(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export interface TableGrant {
  table: string;
  granted: string[];
  secret: string[];
  /** Live columns no class file names. Never granted. */
  unclassified: string[];
}

export interface GrantPlan {
  role: string;
  statements: string[];
  tables: TableGrant[];
  /** True when the plan sets `log_statement`, which needs a superuser. */
  auditLog: boolean;
}

/**
 * The SQL that brings `role` to exactly the classes, from the live columns of the `public`
 * schema. A live column no class names gets nothing, and so does a live table no class
 * file names: the grants fail closed against a schema ahead of this checkout. A classified
 * column the database does not have yet is skipped, so a checkout ahead of production does
 * not break the grant.
 *
 * The statements run in one transaction. Each table first loses every privilege the role
 * holds on it, so a column moved to `secret` loses its grant on the next run.
 */
export function buildGrantPlan(options: {
  database: string;
  role: string;
  live: readonly TableColumns[];
  superuser: boolean;
  classes: readonly ClassifiedTable[];
}): GrantPlan {
  const { database, live, superuser } = options;
  const byTable = new Map(
    options.classes.map((entry) => [entry.table, entry.columns])
  );
  const role = quoteIdent(options.role);
  const roleLiteral = options.role.replaceAll("'", "''");

  const statements = [
    // `CREATE ROLE` has no `IF NOT EXISTS`. The role gets no password here: the owner sets
    // one by hand, so no password passes through this script or its output.
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${roleLiteral}') THEN CREATE ROLE ${role} LOGIN; END IF; END $$`,
    `ALTER ROLE ${role} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`,
    `ALTER ROLE ${role} SET statement_timeout = '15s'`,
    `ALTER ROLE ${role} SET idle_in_transaction_session_timeout = '30s'`,
  ];
  if (superuser) {
    statements.push(`ALTER ROLE ${role} SET log_statement = 'all'`);
  }
  statements.push(
    `GRANT CONNECT ON DATABASE ${quoteIdent(database)} TO ${role}`,
    `GRANT USAGE ON SCHEMA public TO ${role}`
  );

  const tables: TableGrant[] = [];
  for (const { table, columns } of [...live].toSorted((a, b) =>
    a.table.localeCompare(b.table)
  )) {
    const classes = byTable.get(table) ?? {};
    const classOf = (column: string): ColumnClass | undefined =>
      Object.hasOwn(classes, column) ? classes[column] : undefined;
    const granted = columns.filter(
      (column) => classOf(column) === "pii" || classOf(column) === "plain"
    );
    const secret = columns.filter((column) => classOf(column) === "secret");
    const unclassified = columns.filter(
      (column) => classOf(column) === undefined
    );
    statements.push(
      `REVOKE ALL ON TABLE public.${quoteIdent(table)} FROM ${role}`
    );
    if (granted.length > 0) {
      statements.push(
        `GRANT SELECT (${granted.map(quoteIdent).join(", ")}) ON TABLE public.${quoteIdent(table)} TO ${role}`
      );
    }
    tables.push({ table, granted, secret, unclassified });
  }
  return { role: options.role, statements, tables, auditLog: superuser };
}

/**
 * Throw unless the session is `role` with the read-only default, checked before the first
 * statement `db:prod:query` runs. The message names the check that failed.
 */
export function assertReadonlySession(
  session: { currentUser: string; defaultReadOnly: string },
  role: string
): void {
  if (session.currentUser !== role) {
    throw new Error(
      `Connected as ${session.currentUser || "no user"}, not ${role}. db:prod:query runs as the read-only role only. Nothing ran.`
    );
  }
  if (session.defaultReadOnly !== "on") {
    throw new Error(
      `default_transaction_read_only is ${session.defaultReadOnly || "unset"} for ${role}, not on. Run pnpm db:prod:readonly-grants. Nothing ran.`
    );
  }
}
