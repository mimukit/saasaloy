import { resolve } from "node:path";
import { say, withSql } from "./context.ts";
import { buildGrantPlan } from "./readonly.ts";
import type { ClassifiedTable, GrantPlan, TableColumns } from "./readonly.ts";
import { databaseOf, hostOf } from "./url.ts";
import type * as ClassesModule from "../../src/column-classes.ts";

// Apply the read-only role's grants to the database `url` names, as the role that owns it.
// `pnpm db:prod:readonly-grants` runs this, and `pnpm db:prod:migrate` runs it after each
// migration. The guard is the caller's job: run `assertProductionTarget` first.

/**
 * Load every table's column classes from `packages/db/src/column-classes.ts`. The barrel
 * uses Vite's `import.meta.glob`, so plain Node cannot import it; `runnerImport` runs it
 * through Vite with no config file, as `loadSeedEntry` does for the seed.
 */
export async function loadColumnClasses(
  root: string
): Promise<ClassifiedTable[]> {
  const { runnerImport } = await import("vite");
  const { module } = await runnerImport<typeof ClassesModule>(
    resolve(root, "packages/db/src/column-classes.ts"),
    { logLevel: "error", root: resolve(root, "packages/db") }
  );
  return module.columnClasses;
}

/** Read the live columns, build the plan, and run it in one transaction. */
export async function applyReadonlyGrants(
  url: string,
  options: { role: string; classes: readonly ClassifiedTable[] }
): Promise<GrantPlan> {
  const database = databaseOf(url);
  return await withSql(
    url,
    `Cannot reach ${database} on ${hostOf(url)}`,
    async (sql) => {
      const [who] = await sql<{ superuser: boolean }[]>`
        select rolsuper as superuser from pg_roles where rolname = current_user`;
      const rows = await sql<{ table: string; column: string }[]>`
        select c.table_name as table, c.column_name as column
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
        where c.table_schema = 'public' and t.table_type = 'BASE TABLE'
        order by c.table_name, c.ordinal_position`;
      const byTable = new Map<string, string[]>();
      for (const { table, column } of rows) {
        const columns = byTable.get(table) ?? [];
        columns.push(column);
        byTable.set(table, columns);
      }
      const live: TableColumns[] = [...byTable].map(([table, columns]) => ({
        table,
        columns,
      }));
      const plan = buildGrantPlan({
        database,
        role: options.role,
        live,
        superuser: who?.superuser === true,
        classes: options.classes,
      });
      await sql.begin(async (tx) => {
        for (const statement of plan.statements) {
          await tx.unsafe(statement);
        }
      });
      return plan;
    }
  );
}

/** One line per table, then a line for each column the role cannot read for want of a class. */
export function reportGrants(
  plan: GrantPlan,
  print: (message: string) => void = say
): void {
  print(`Grants for ${plan.role}:`);
  for (const { table, granted, secret, unclassified } of plan.tables) {
    const held = [
      secret.length > 0 ? `${String(secret.length)} secret` : "",
      unclassified.length > 0
        ? `${String(unclassified.length)} unclassified`
        : "",
    ].filter(Boolean);
    print(
      `  ${table}: ${String(granted.length)} column(s) readable${held.length > 0 ? `, ${held.join(", ")} withheld` : ""}`
    );
  }
  const unclassified = plan.tables.flatMap(({ table, unclassified: columns }) =>
    columns.map((column) => `${table}.${column}`)
  );
  if (unclassified.length > 0) {
    print(
      `Withheld because no file in packages/db/src/column-classes/ gives them a class: ${unclassified.join(", ")}. Classify them and run pnpm db:prod:readonly-grants again.`
    );
  }
  print(
    plan.auditLog
      ? `log_statement = all is set for ${plan.role}: the server log records each statement it runs.`
      : `Skipped log_statement: the connecting role is not a superuser, so ${plan.role} runs without an audit log.`
  );
}
