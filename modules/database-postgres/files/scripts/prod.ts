import { spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { loadContext, run, runPnpm, say } from "./lib/context.ts";
import {
  defaultDumpDirectory,
  readMode,
  runProduction,
} from "./lib/production.ts";

// `pnpm db:prod:dump` and `pnpm db:prod:migrate`: back up the production database, and
// apply the pending migrations to it, from a developer machine.
//
// Both pnpm scripts run this under `env-deploy --run api`, so DATABASE_URL is the
// production value from the value source (`packages/env/.env.prod` with the `local`
// source) and stays in memory. The target is checked before anything connects: it must
// name `<project>_production`, on a server other than the development one `apps/api/.env`
// names.
//
//   dump      pg_dump the database (custom format) into the backup folder
//   migrate   dump first, then apply the pending migrations with drizzle-kit migrate
//
// `migrate` never runs without a fresh dump: a failed or empty dump stops it before a
// migration starts. The dump lands in `~/<project>-backups/` (or `DB_DUMP_DIR`), mode
// 0700, outside the repository. pg_dump comes from the `postgres:<major>` image through
// Docker, with the major version the root `compose.yaml` runs. Set `PG_DUMP=local` to use
// a `pg_dump` on PATH instead.
//
// `pnpm deploy:production --migrate` runs `db:prod:migrate` before the first Worker
// uploads. Nothing else does: a production migration is its own step.

function readCompose(root: string): string {
  const file = join(root, "compose.yaml");
  return existsSync(file) ? readFileSync(file, "utf-8") : "";
}

/** Run pg_dump with its stdout in `file`, created new with mode 0600. */
async function dumpTo(
  command: string,
  args: string[],
  url: string,
  file: string
): Promise<number> {
  const out = openSync(file, "wx", 0o600);
  try {
    // `spawn` reports through events, not a promise, so this wraps it in one.
    // oxlint-disable-next-line promise/avoid-new
    return await new Promise<number>((resolve, reject) => {
      const child = spawn(command, args, {
        env: { ...process.env, DATABASE_URL: url },
        stdio: ["ignore", out, "inherit"],
      });
      child.on("error", reject);
      child.on("exit", (exit) => {
        resolve(exit ?? 1);
      });
    });
  } finally {
    closeSync(out);
  }
}

await run(async () => {
  const mode = readMode(process.argv.slice(2));
  const context = loadContext();
  await runProduction(mode, {
    url: process.env.DATABASE_URL,
    devPrefix: context.prefix,
    devUrl: context.env.values.get("DATABASE_URL"),
    local: process.env.PG_DUMP === "local",
    compose: readCompose(context.root),
    dumpDirectory:
      process.env.DB_DUMP_DIR ??
      defaultDumpDirectory(homedir(), context.prefix),
    now: () => new Date(),
    hasDocker: () =>
      spawnSync("docker", ["info"], { stdio: "ignore" }).status === 0,
    makeDirectory: (directory) => {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
    },
    dump: dumpTo,
    fileSize: (file) => (existsSync(file) ? statSync(file).size : 0),
    removeFile: (file) => {
      rmSync(file, { force: true });
    },
    migrate: (url) =>
      runPnpm(context.root, ["--filter", "@repo/db", "db:migrate"], {
        DATABASE_URL: url,
      }),
    say,
  });
});
