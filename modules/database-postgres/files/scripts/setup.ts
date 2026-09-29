import * as docker from "./backends/docker.ts";
import * as neon from "./backends/neon.ts";
import * as server from "./backends/server.ts";
import {
  API_ENV,
  journalEntries,
  loadContext,
  readFlags,
  resolveState,
  run,
  runPnpm,
  say,
  withSql,
} from "./lib/context.ts";
import type { Context } from "./lib/context.ts";
import { setKey, writeEnvFile } from "./lib/env-file.ts";
import { BACKEND_LABEL, chooseBackend, formatState } from "./lib/state.ts";
import type { Backend, State } from "./lib/state.ts";
import { hostOf, swapDatabase } from "./lib/url.ts";

// `pnpm db:setup [--docker | --server | --neon] [--reset]`: give this checkout a migrated
// development database, record it in the state block at the top of `apps/api/.dev.vars`, and
// point `DATABASE_URL` at it.
//
// On `main` the database is the plain `<project>_dev`. On any other branch it is
// `<project>_dev_<branch>`, so a migration that is not merged never lands in a database
// another developer reads. See the `saasaloy-database-postgres` skill.

/** The server URL `--server` creates on: whatever `DATABASE_URL` already names. */
function serverAdmin(context: Context): string {
  return server.adminUrl(context.env.values.get("DATABASE_URL"));
}

/** `--reset`: drop the database, or, on neon.new, forget its URL. */
async function discard(context: Context, state: State): Promise<void> {
  say(`Replacing ${state.database} on ${BACKEND_LABEL[state.backend]}.`);
  if (state.backend === "neon") {
    say("Discarding its URL. neon.new deletes the project when it expires.");
    return;
  }
  const admin =
    state.backend === "docker" ? docker.adminUrl() : serverAdmin(context);
  await server.dropDatabase(context.prefix, admin, state.database);
}

/** A docker or server database is live while it exists; a neon.new one until it expires. */
async function isLive(
  context: Context,
  state: State,
  now: Date
): Promise<boolean> {
  if (state.backend === "neon") {
    const expires = state.expires ? Date.parse(state.expires) : Number.NaN;
    const live = Number.isNaN(expires) || now.getTime() < expires;
    if (!live) {
      say(`${state.database} on neon.new has expired. Creating a new one.`);
    }
    return live;
  }
  if (state.backend === "docker") {
    await docker.ensureRunning(context.root);
  }
  const admin =
    state.backend === "docker" ? docker.adminUrl() : serverAdmin(context);
  const exists = await server.databaseExists(admin, state.database);
  if (!exists) {
    say(`${state.database} no longer exists. Creating it again.`);
  }
  return exists;
}

async function create(
  context: Context,
  backend: Backend,
  now: Date
): Promise<{ state: State; url: string }> {
  const { database, prefix, root } = context;
  const created = now.toISOString();

  if (backend === "neon") {
    const result = await neon.createDatabase(prefix, database);
    say(`Created ${database} on neon.new.`);
    return {
      state: {
        backend,
        database,
        created,
        ...(result.expires ? { expires: result.expires } : {}),
        ...(result.claim ? { claim: result.claim } : {}),
      },
      url: result.url,
    };
  }

  if (backend === "docker") {
    const url = await docker.create(root, prefix, database);
    say(`Created ${database} in the local container.`);
    return { state: { backend, database, created }, url };
  }

  const admin = serverAdmin(context);
  await server.createDatabase(prefix, admin, database);
  say(`Created ${database} on ${hostOf(admin)}.`);
  return {
    state: { backend, database, created },
    url: swapDatabase(admin, database),
  };
}

function printSummary(context: Context, state: State, url: string): void {
  say("");
  say(`Backend   ${BACKEND_LABEL[state.backend]}`);
  say(`Database  ${state.database}`);
  say(`Host      ${hostOf(url)}`);
  if (state.backend === "neon") {
    say(`Note      ${neon.NEON_NOTE}`);
    say(`Expires   ${state.expires ?? "unknown"}`);
    say(`Claim     ${state.claim ?? "unknown"}`);
  }
  say(
    context.isDefaultBranch
      ? "This is the default branch, so it uses the plain database name."
      : `Branch ${context.branch ?? "?"} has its own database; run pnpm db:drop when you are done with it.`
  );
  say(`DATABASE_URL is set in ${API_ENV}.`);
}

await run(async () => {
  const flagSet = readFlags(["--docker", "--server", "--neon", "--reset"]);
  const flags = {
    docker: flagSet.has("--docker"),
    server: flagSet.has("--server"),
    neon: flagSet.has("--neon"),
    reset: flagSet.has("--reset"),
  };
  const context = loadContext();
  const existing = resolveState(context);
  const backend = chooseBackend(flags, existing);
  if (backend === "neon") {
    neon.forceIpv4();
  }

  // A checkout that changed branch in place still holds the old branch's block. Reuse it
  // only when it names the database this branch should use; otherwise create that one and
  // leave the old database alone, because another worktree may still be on it.
  if (existing && existing.database !== context.database) {
    say(
      `The state block names ${existing.database}, but this branch uses ${context.database}. Leaving ${existing.database} alone; run pnpm db:drop from the checkout that owns it.`
    );
  }
  const reusable =
    existing && existing.database === context.database ? existing : undefined;

  // `--reset` replaces this branch's database, never one another branch's block named.
  if (flags.reset && reusable) {
    await discard(context, reusable);
  }

  const now = new Date();
  let state = flags.reset ? undefined : reusable;
  let url = flags.reset ? undefined : context.env.values.get("DATABASE_URL");
  if (!(state && url && (await isLive(context, state, now)))) {
    ({ state, url } = await create(context, backend, now));
  }

  // Written before the migrations run, so a failed migrate leaves a file that says where
  // the database is and a re-run picks it up rather than creating a second one.
  const lines = setKey(context.env.lines, "DATABASE_URL", url);
  writeEnvFile(context.env.path, formatState(state), lines);

  const env: Record<string, string> = { DATABASE_URL: url };
  if (state.backend === "neon") {
    await neon.prepare(url);
    env.NODE_OPTIONS = [process.env.NODE_OPTIONS, neon.IPV4_NODE_OPTIONS]
      .filter(Boolean)
      .join(" ");
  }
  // drizzle-kit exits non-zero and prints nothing when there is no migration to apply, so a
  // project that has not declared its first table would fail here for no reason.
  if (journalEntries(context.root) === 0) {
    say(
      "No migrations yet, so db:migrate is skipped. Add a table, run pnpm db:generate, then run pnpm db:setup again."
    );
  } else if (
    !runPnpm(context.root, ["--filter", "@repo/db", "db:migrate"], env)
  ) {
    throw new Error(
      "db:migrate failed. Fix the cause, then run pnpm db:setup again."
    );
  }

  // Prove the URL the file now holds actually answers, so `db:setup` never ends green on a
  // database the next command cannot open.
  await withSql(url, "The new database did not answer", async (sql) => {
    await sql`select 1`;
  });
  printSummary(context, state, url);
});
