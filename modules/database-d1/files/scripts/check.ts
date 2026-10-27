import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

// `pnpm db:check`: the schema drift gate. It fails when a table in `src/schema/` changed
// and nobody ran `pnpm db:generate`, so the change never reaches a migration. With testing
// on, the root `test` script runs it before Vitest (issue #243).
//
// Two steps. `drizzle-kit check` proves the migrations folder is consistent. Then a
// generate dry run: drizzle-kit has no dry-run flag, so the script copies `migrations/` to a
// temporary folder, runs `generate` into the copy, and reads drizzle-kit's verdict line.
// The real folder is never written. drizzle-kit exits 0 even when `generate` throws, so
// the script passes only on the "No schema changes" line and fails on anything else.
// `--out` takes a relative path: drizzle-kit prefixes `./` to whatever it is given.

const MIGRATIONS = resolve(process.cwd(), "migrations");

function drizzleKit(args: string[]): number {
  const result = spawnSync("drizzle-kit", args, { stdio: "inherit" });
  return result.status ?? 1;
}

if (drizzleKit(["check"]) !== 0) {
  process.exit(1);
}

const copy = mkdtempSync(join(tmpdir(), "db-check-"));
try {
  if (existsSync(MIGRATIONS)) {
    cpSync(MIGRATIONS, copy, { recursive: true });
  }
  const result = spawnSync(
    "drizzle-kit",
    [
      "generate",
      "--dialect=sqlite",
      "--schema=./src/schema/*.ts",
      `--out=${relative(process.cwd(), copy)}`,
    ],
    { encoding: "utf-8" }
  );
  const output = `${result.stdout}${result.stderr}`;
  if (output.includes("No schema changes")) {
    process.stdout.write("db:check: the migrations match the schema.\n");
  } else if (output.includes("Your SQL migration file")) {
    process.stderr.write(
      "db:check: the schema has changes no migration holds. Run `pnpm db:generate` and commit the migration.\n"
    );
    process.exitCode = 1;
  } else {
    process.stderr.write(
      `${output}\ndb:check: drizzle-kit generate did not finish.\n`
    );
    process.exitCode = 1;
  }
} finally {
  rmSync(copy, { force: true, recursive: true });
}
