import { spawnSync } from "node:child_process";
import * as docker from "./backends/docker.ts";
import * as server from "./backends/server.ts";
import {
  API_ENV,
  isManagedDatabase,
  loadContext,
  readFlags,
  resolveState,
  run,
  say,
  withSql,
} from "./lib/context.ts";
import type { Context } from "./lib/context.ts";
import { cloneId, parseMapping } from "./lib/mapping.ts";
import { planPrune, readRefs } from "./lib/prune.ts";
import type { DatabaseInfo, MergeState } from "./lib/prune.ts";
import { hostOf } from "./lib/url.ts";

// `pnpm db:prune [--apply] [--include-unmapped] [--server]`: find the development and test
// databases whose branch is closed, and with `--apply` drop them.
//
// It is a dry run by default: it lists the candidates with their sizes, and every database
// it keeps with the reason. The rule lives in `lib/prune.ts`; this file reads the server,
// git and `gh`, and acts on the answer. It never fetches, so a remote ref that is gone on
// the remote but still local only keeps a database.
//
// It reads one server: the state block's backend, or with no block the local container when
// it answers. `--server` reads the server `DATABASE_URL` names instead. neon.new deletes each
// database when it expires, so on neon there is nothing to prune.

interface Target {
  admin: string;
  label: string;
  /** The message a connection that never answers gets. */
  unreachable: string;
}

/** Which server to read, as the state block, `--server` or the container decides. */
async function chooseTarget(
  context: Context,
  useServer: boolean
): Promise<Target | undefined> {
  const url = context.env.values.get("DATABASE_URL");
  if (useServer) {
    const admin = server.adminUrl(url);
    return {
      admin,
      label: hostOf(admin),
      unreachable: server.SERVER_UNREACHABLE,
    };
  }
  const state = resolveState(context);
  if (state?.backend === "neon") {
    say(
      "This checkout uses neon.new, which deletes each database when it expires. Nothing to prune."
    );
    return undefined;
  }
  if (state?.backend === "server") {
    const admin = server.adminUrl(url);
    return {
      admin,
      label: hostOf(admin),
      unreachable: server.SERVER_UNREACHABLE,
    };
  }
  if (state?.backend === "docker" || (await docker.answers())) {
    return {
      admin: docker.adminUrl(),
      label: "the local container",
      unreachable: docker.DOCKER_UNREACHABLE,
    };
  }
  throw new Error(
    `This checkout has no state block and the local container does not answer. Run pnpm db:prune --server to read the server DATABASE_URL in ${API_ENV} names.`
  );
}

/** Branch names from `refs/heads` and `refs/remotes`, as git has them now. */
function gitRefs(root: string): { local: string[]; remote: string[] } {
  const result = spawnSync(
    "git",
    ["for-each-ref", "--format=%(refname)", "refs/heads", "refs/remotes"],
    { cwd: root, encoding: "utf-8" }
  );
  if (result.status !== 0) {
    throw new Error(
      "git for-each-ref failed, so the open branches are unknown. Run db:prune inside the repo."
    );
  }
  return readRefs(result.stdout.split("\n"));
}

/**
 * A lookup for a merged pull request on `branch`, cached per branch. It answers
 * `gh missing` when `gh` is not installed or fails, because then nothing proves the branch
 * merged.
 */
function mergedPrLookup(root: string): (branch: string) => MergeState {
  let hasGh: boolean | undefined;
  const cache = new Map<string, MergeState>();
  return (branch) => {
    hasGh ??= spawnSync("gh", ["--version"], { stdio: "ignore" }).status === 0;
    if (!hasGh) {
      return "gh missing";
    }
    const known = cache.get(branch);
    if (known) {
      return known;
    }
    const result = spawnSync(
      "gh",
      [
        "pr",
        "list",
        "--state",
        "merged",
        "--head",
        branch,
        "--json",
        "number",
        "--limit",
        "1",
      ],
      { cwd: root, encoding: "utf-8" }
    );
    let state: MergeState = "gh missing";
    if (result.status === 0) {
      try {
        state =
          (JSON.parse(result.stdout) as unknown[]).length > 0
            ? "merged"
            : "not merged";
      } catch {
        state = "gh missing";
      }
    }
    cache.set(branch, state);
    return state;
  };
}

interface Row {
  name: string;
  comment: string | null;
  size: string;
  sessions: number;
}

async function readDatabases(
  context: Context,
  target: Target
): Promise<DatabaseInfo[]> {
  const rows = await withSql(
    target.admin,
    target.unreachable,
    async (sql) => sql<Row[]>`
      select d.datname as name,
             shobj_description(d.oid, 'pg_database') as comment,
             pg_size_pretty(pg_database_size(d.oid)) as size,
             (select count(*)::int from pg_stat_activity a
               where a.datname = d.datname and a.pid <> pg_backend_pid()) as sessions
        from pg_database d
       where not d.datistemplate
       order by d.datname`
  );
  return rows
    .filter((row) => isManagedDatabase(context, row.name))
    .map((row) => {
      const mapping = parseMapping(row.comment);
      return {
        name: row.name,
        sessions: row.sessions,
        size: row.size,
        ...(mapping ? { mapping } : {}),
      };
    });
}

/** Sessions open on `database` now, so a session opened since the listing still saves it. */
async function sessionsOn(target: Target, database: string): Promise<number> {
  const [row] = await withSql(
    target.admin,
    target.unreachable,
    async (sql) => sql<{ sessions: number }[]>`
      select count(*)::int as sessions from pg_stat_activity
       where datname = ${database} and pid <> pg_backend_pid()`
  );
  return row?.sessions ?? 0;
}

function describe(database: DatabaseInfo): string {
  const branch = database.mapping
    ? ` (branch ${database.mapping.branch || "?"})`
    : "";
  return `${database.name}${branch}`;
}

await run(async () => {
  const flags = readFlags(["--apply", "--include-unmapped", "--server"]);
  const context = loadContext();
  const target = await chooseTarget(context, flags.has("--server"));
  if (!target) {
    return;
  }
  if (target.label !== "the local container") {
    say(
      "db:prune reads the remote refs as they are now and never fetches; run `git fetch --prune` first."
    );
  }

  const refs = gitRefs(context.root);
  const plan = planPrune({
    prefix: context.prefix,
    clone: cloneId(context.root),
    databases: await readDatabases(context, target),
    localBranches: refs.local,
    remoteBranches: refs.remote,
    mergedPr: mergedPrLookup(context.root),
    includeUnmapped: flags.has("--include-unmapped"),
  });

  say(`Databases of ${context.prefix} on ${target.label}:`);
  if (plan.candidates.length === 0) {
    say("  No database to prune.");
  }
  for (const database of plan.candidates) {
    say(`  prune  ${describe(database)}  ${database.size ?? ""}`.trimEnd());
  }
  for (const { database, reason } of plan.skipped) {
    say(`  keep   ${describe(database)}  ${reason}`);
  }

  if (!flags.has("--apply")) {
    if (plan.candidates.length > 0) {
      say("");
      say(
        `Nothing dropped. Run pnpm db:prune --apply${flags.has("--include-unmapped") ? " --include-unmapped" : ""}${flags.has("--server") ? " --server" : ""} to drop ${plan.candidates.length === 1 ? "this database" : `these ${plan.candidates.length} databases`}.`
      );
    }
    return;
  }

  say("");
  for (const database of plan.candidates) {
    if ((await sessionsOn(target, database.name)) > 0) {
      say(`Kept ${database.name}: a session opened on it since the listing.`);
      continue;
    }
    await server.dropDatabase(context.prefix, target.admin, database.name);
    say(`Dropped ${database.name}.`);
  }
  const inUse = plan.skipped.filter((skip) => skip.reason === "in use");
  for (const { database } of inUse) {
    say(
      `Kept ${database.name}: it has an open session. Close it and run db:prune --apply again.`
    );
  }
});
