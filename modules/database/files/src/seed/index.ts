import { getTableName } from "drizzle-orm";
import { schema } from "../schema";
import { seedStatements } from "./apply";
import type { SeedDatabase } from "./apply";
import { planSeed } from "./plan";
import type { PlanStep } from "./plan";
import { collectSlices } from "./slice";
import { describeTable, tablesIn } from "./table";

// The seed entry. Every file under `./slices/` is picked up here by the same Vite
// `import.meta.glob` the schema barrel uses, so adding a table's seed rows is one new file
// and no list to edit.
//
// Only a Vite runtime executes `import.meta.glob`. Each driver's `scripts/seed.ts` loads
// this file through Vite's `runnerImport`, and Vitest runs it natively, so the completeness
// test and the route test harness read it too. The glob is eager on purpose: `runnerImport`
// closes its module runner before it returns, and a lazy loader called after that throws.

const modules = import.meta.glob<Record<string, unknown>>("./slices/*.ts", {
  eager: true,
});

/** Every slice in `./slices/`. */
export const slices = collectSlices(modules);

/** Every table in the schema barrel. */
export const tables = tablesIn(schema);

/** What a seed run did to one table. */
export interface SeedCount {
  table: string;
  rows: number;
}

/**
 * The whole seed, checked and ordered, before anything is written. Throws on a slice the
 * schema cannot take; see `planSeed` in `./plan.ts`.
 */
export function seedPlan(): PlanStep[] {
  return planSeed(
    tables.map((table) => describeTable(table)),
    slices.map((slice) => ({
      after: slice.after,
      key: slice.key,
      rows: slice.rows as Record<string, Record<string, unknown>>,
      table: getTableName(slice.table),
    }))
  );
}

/** The insert statements for `plan`, built against `db`, in write order. */
export function statementsFor(db: SeedDatabase, plan: readonly PlanStep[]) {
  return seedStatements(db, tables, plan);
}

/** The rows each table received, in write order. */
export function countsFor(plan: readonly PlanStep[]): SeedCount[] {
  return plan.map((step) => ({ rows: step.rows.length, table: step.table }));
}

/** The `message` lines of the slices in the plan, such as a documented dev password. */
export function messagesFor(plan: readonly PlanStep[]): string[] {
  const planned = new Set(plan.map((step) => step.table));
  return slices
    .filter((slice) => planned.has(getTableName(slice.table)))
    .flatMap((slice) => (slice.message ? [slice.message] : []));
}
