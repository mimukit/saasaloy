import { statSync } from "node:fs";
import { homedir } from "node:os";
import type postgres from "postgres";
import { loadContext, run, say, withSql } from "./lib/context.ts";
import { readEnvFile } from "./lib/env-file.ts";
import { maskRow, piiColumns } from "./lib/mask.ts";
import {
  AUTH_TRACE,
  READONLY_URL_KEY,
  assertPrivateFile,
  assertReadonlyUrl,
  parseQueryArgs,
  readonlyEnvPath,
} from "./lib/query.ts";
import type { PresetQuery } from "./lib/query.ts";
import { loadColumnClasses } from "./lib/readonly-grants.ts";
import { assertReadonlySession, readonlyRoleName } from "./lib/readonly.ts";

// `pnpm db:prod:query "<sql>"` and `pnpm db:prod:query --auth-trace <email>`: read
// production as the read-only role `<project>_ro`, for debugging. The SQL can also come on
// stdin.
//
// It reads one URL, `PROD_READONLY_DATABASE_URL` from
// `~/.config/<project>/prod-readonly.env`, and nothing else: not `.env.prod`, not
// DATABASE_URL from the environment, and it never runs under `env-deploy`. Before the first
// statement it checks that the URL names the production database as the read-only role,
// and that the session is that role with `default_transaction_read_only` on. Each query
// runs in its own `begin read only` transaction that is rolled back, with a row cap, and
// the output is masked by `lib/mask.ts`. It never prints the URL.
//
// One statement per call: the query goes through the extended protocol, which refuses a
// second statement, so `set transaction read write; update ...` cannot ride along. The
// role holds no write grant either way: the server, not this script, is the boundary.

type Sql = ReturnType<typeof postgres>;

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Run one statement in a read-only transaction that is rolled back, and print its rows. */
async function runQuery(
  sql: Sql,
  query: PresetQuery,
  parameters: string[],
  options: { maxRows: number; pii: ReadonlySet<string> }
): Promise<void> {
  const { maxRows, pii } = options;
  const conn = await sql.reserve();
  const rows: Record<string, unknown>[] = [];
  let cut = false;
  try {
    await conn.unsafe("begin read only");
    await conn
      .unsafe(query.sql, parameters, { prepare: true })
      .cursor(maxRows + 1, (batch) => {
        rows.push(...(batch as unknown as Record<string, unknown>[]));
        if (rows.length > maxRows) {
          cut = true;
          rows.length = maxRows;
        }
        return conn.CLOSE;
      });
  } finally {
    try {
      await conn.unsafe("rollback");
    } catch {
      // A failed statement already ended the transaction; there is nothing to roll back.
    }
    conn.release();
  }
  say(`-- ${query.title}`);
  for (const row of rows) {
    say(JSON.stringify(maskRow(row, pii)));
  }
  say(
    cut
      ? `(first ${String(maxRows)} rows; raise --max-rows to see more)`
      : `(${String(rows.length)} row${rows.length === 1 ? "" : "s"})`
  );
}

await run(async () => {
  const args = parseQueryArgs(process.argv.slice(2));
  const context = loadContext();
  const role = readonlyRoleName(context.prefix);
  const path = readonlyEnvPath(homedir(), context.prefix);

  let mode: number;
  try {
    ({ mode } = statSync(path));
  } catch {
    throw new Error(
      `No ${path}. Run pnpm db:prod:readonly-grants and follow what it prints. Nothing ran.`
    );
  }
  assertPrivateFile(path, mode);
  const { url, database, host } = assertReadonlyUrl({
    url: readEnvFile(path).values.get(READONLY_URL_KEY),
    devPrefix: context.prefix,
    devUrl: context.env.values.get("DATABASE_URL"),
    role,
    path,
  });

  let queries: PresetQuery[];
  let parameters: string[] = [];
  if (args.kind === "auth-trace") {
    queries = [...AUTH_TRACE];
    parameters = [args.email];
  } else {
    // Stdin is read only when no SQL argument came, so a call with one never waits on it.
    let text = args.sql ?? "";
    if (args.sql === undefined && !process.stdin.isTTY) {
      const piped = await readStdin();
      text = piped.trim();
    }
    if (text === "") {
      throw new Error(
        "No SQL. Pass it as one quoted argument, pipe it on stdin, or use --auth-trace <email>."
      );
    }
    queries = [{ title: "query", sql: text }];
  }

  const pii = piiColumns(await loadColumnClasses(context.root));

  say(`Target: ${database} on ${host}, as ${role}.`);
  await withSql(url, `Cannot reach ${database} on ${host}`, async (sql) => {
    const [session] = await sql<
      { current_user: string; default_transaction_read_only: string }[]
    >`select current_user, current_setting('default_transaction_read_only') as default_transaction_read_only`;
    assertReadonlySession(
      {
        currentUser: session?.current_user ?? "",
        defaultReadOnly: session?.default_transaction_read_only ?? "",
      },
      role
    );
    for (const query of queries) {
      await runQuery(sql, query, parameters, { maxRows: args.maxRows, pii });
    }
  });
});
