import { DOCKER_UNREACHABLE } from "./backends/docker.ts";
import * as neon from "./backends/neon.ts";
import { SERVER_UNREACHABLE } from "./backends/server.ts";
import {
  journalEntries,
  loadContext,
  readFlags,
  resolveState,
  run,
  say,
  withSql,
} from "./lib/context.ts";
import { BACKEND_LABEL, liveness, timeLeft } from "./lib/state.ts";
import type { Backend } from "./lib/state.ts";
import { hostOf } from "./lib/url.ts";

// `pnpm db:status`: which database this checkout uses, on which backend, and whether it
// still answers. It is a report, not a gate: it exits 0 with pending migrations and 1 only
// when the database is unreachable.
//
// Pending migrations are the journal's entries minus the rows drizzle recorded in
// `drizzle.__drizzle_migrations`.

const UNREACHABLE: Record<Backend, string> = {
  docker: DOCKER_UNREACHABLE,
  server: SERVER_UNREACHABLE,
  neon: neon.NEON_UNREACHABLE,
};

await run(async () => {
  readFlags([]);
  const context = loadContext();
  const state = resolveState(context);
  const url = context.env.values.get("DATABASE_URL");
  if (!(state && url)) {
    say(
      `This checkout has no development database yet. Run pnpm db:setup to create ${context.database}.`
    );
    return;
  }

  const now = new Date();
  say(`Backend   ${BACKEND_LABEL[state.backend]}`);
  say(`Database  ${state.database}`);
  say(`Host      ${hostOf(url)}`);
  say(`Branch    ${context.branch ?? "detached HEAD"}`);
  if (state.backend === "neon") {
    say(`Expires   ${timeLeft(state, now)}`);
  }
  if (state.database !== context.database) {
    say(
      `Stale     this branch uses ${context.database}. Run pnpm db:setup to create it.`
    );
  }

  if (liveness(state, now) === "expired") {
    say("Status    expired. Run pnpm db:setup to create a new one.");
    process.exitCode = 1;
    return;
  }
  if (state.backend === "neon") {
    neon.forceIpv4();
  }

  try {
    const applied = await withSql(
      url,
      UNREACHABLE[state.backend],
      async (sql) => {
        const [table] = await sql<{ name: string | null }[]>`
          select to_regclass('drizzle.__drizzle_migrations')::text as name`;
        if (!table?.name) {
          return 0;
        }
        const [row] = await sql<{ count: number }[]>`
          select count(*)::int as count from drizzle.__drizzle_migrations`;
        return row?.count ?? 0;
      }
    );
    const pending = Math.max(journalEntries(context.root) - applied, 0);
    say(`Applied   ${applied}`);
    say(
      `Status    reachable, ${pending} pending migration${pending === 1 ? "" : "s"}`
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    say(`Status    unreachable. ${reason}`);
    process.exitCode = 1;
  }
});
