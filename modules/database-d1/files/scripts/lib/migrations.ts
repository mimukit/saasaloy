import { existsSync, readdirSync } from "node:fs";

/**
 * The `.sql` migrations `wrangler d1 migrations apply` would read from `dir`, in name
 * order. A folder that does not exist yet holds none: `db:generate` makes it with the
 * first table.
 */
export function migrationFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .toSorted();
}
