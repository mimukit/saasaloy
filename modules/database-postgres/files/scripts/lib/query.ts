import { join } from "node:path";
import { assertProductionTarget } from "./production.ts";

// The pure half of `pnpm db:prod:query`: its flags, the file that holds the read-only URL,
// the checks on that file and URL, and the `--auth-trace` preset. `../query.ts` is the
// command.

export const READONLY_URL_KEY = "PROD_READONLY_DATABASE_URL";

/**
 * The read-only URL's home, outside the repo and away from `packages/env/.env.prod`:
 * `~/.config/<project>/prod-readonly.env`, where `<project>` is the dev prefix without
 * `_dev` (`acme_shop_dev` gives `acme_shop`).
 */
export function readonlyEnvPath(home: string, devPrefix: string): string {
  return join(
    home,
    ".config",
    devPrefix.replace(/_dev$/, ""),
    "prod-readonly.env"
  );
}

const DEFAULT_MAX_ROWS = 200;
const MAX_ROWS = 5000;

const USAGE =
  'Usage: pnpm db:prod:query "<sql>" [--max-rows <n>] | pnpm db:prod:query --auth-trace <email> [--max-rows <n>] | <sql on stdin> pnpm db:prod:query';

export type QueryArgs =
  | { kind: "sql"; sql?: string; maxRows: number }
  | { kind: "auth-trace"; email: string; maxRows: number };

/**
 * The email as Better Auth stores it: trimmed and in lower case. Anything without one `@`
 * throws, because the preset searches by exact value and a near miss reads as "no user".
 */
export function normalizeEmail(input: string): string {
  const email = input.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error(`${input} is not an email address.`);
  }
  return email;
}

/**
 * Read the command's flags. The SQL is the one positional argument; with none, the script
 * reads it from stdin. A leading `--`, which `pnpm run x -- --flag` forwards, is skipped.
 */
export function parseQueryArgs(argv: readonly string[]): QueryArgs {
  const args = argv[0] === "--" ? argv.slice(1) : [...argv];
  let maxRows = DEFAULT_MAX_ROWS;
  let email: string | undefined;
  const positional: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (arg === "--max-rows" || arg === "--auth-trace") {
      const value = args[index + 1];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} needs a value.\n${USAGE}`);
      }
      index += 1;
      if (arg === "--max-rows") {
        maxRows = Number(value);
        if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_ROWS) {
          throw new Error(
            `--max-rows takes a whole number from 1 to ${String(MAX_ROWS)}.`
          );
        }
      } else {
        email = normalizeEmail(value);
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown flag ${arg}.\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) {
    throw new Error(`Give the SQL as one quoted argument.\n${USAGE}`);
  }
  if (email !== undefined) {
    if (positional.length > 0) {
      throw new Error(`--auth-trace takes no SQL of its own.\n${USAGE}`);
    }
    return { kind: "auth-trace", email, maxRows };
  }
  const [sql] = positional;
  return sql === undefined
    ? { kind: "sql", maxRows }
    : { kind: "sql", sql, maxRows };
}

/** Throw when the URL file can be read by anyone but its owner. */
export function assertPrivateFile(path: string, mode: number): void {
  // oxlint-disable-next-line no-bitwise -- the group and other bits of a file mode
  if ((mode & 0o077) !== 0) {
    // oxlint-disable-next-line no-bitwise -- the permission bits, printed as `644`
    const permissions = (mode & 0o777).toString(8);
    throw new Error(
      `${path} is mode ${permissions}. It holds a database password: run chmod 600 ${path}. Nothing ran.`
    );
  }
}

/**
 * Throw unless `url` names the production database, on a server other than the dev one,
 * as the read-only role. The session check after connecting is the second half
 * (`assertReadonlySession` in `./readonly.ts`). No message carries the URL.
 */
export function assertReadonlyUrl(options: {
  url: string | undefined;
  devPrefix: string;
  devUrl?: string | undefined;
  role: string;
  path: string;
}): { url: string; database: string; host: string } {
  const { url, role, path } = options;
  if (url === undefined || url === "") {
    throw new Error(
      `${path} has no ${READONLY_URL_KEY}. Run pnpm db:prod:readonly-grants and follow what it prints. Nothing ran.`
    );
  }
  let target: { url: string; database: string; host: string };
  try {
    target = assertProductionTarget({
      url,
      devPrefix: options.devPrefix,
      devUrl: options.devUrl,
    });
  } catch (error) {
    throw new Error(
      `${READONLY_URL_KEY}: ${(error instanceof Error ? error.message : String(error)).replaceAll("DATABASE_URL", "the URL")} Nothing ran.`,
      { cause: error }
    );
  }
  const user = decodeURIComponent(new URL(target.url).username);
  if (user !== role) {
    throw new Error(
      `${READONLY_URL_KEY} connects as ${user || "no user"}, not ${role}. Nothing ran.`
    );
  }
  return target;
}

export interface PresetQuery {
  title: string;
  sql: string;
}

/**
 * The auth trace for one email: the user, how they sign in, and their newest sessions.
 * Each query takes the email as `$1`. `has_password` comes from a `credential` account row,
 * which Better Auth writes only with a password, so the secret column itself is never
 * named, and neither is `sessions.token`.
 *
 * There is no `verifications` query. Both `identifier` and `value` are `secret` (a reset
 * token sits in `identifier`), so no readable column ties a row to a user.
 */
export const AUTH_TRACE: readonly PresetQuery[] = [
  {
    title: "users: the account with this email",
    sql: `select id, role, name, email, email_verified, banned, ban_reason, ban_expires, created_at, updated_at
from users where email = $1`,
  },
  {
    title: "accounts: sign-in methods (credential means a password is set)",
    sql: `select a.provider_id, a.provider_id = 'credential' as has_password, a.created_at, a.updated_at
from accounts a join users u on u.id = a.user_id
where u.email = $1 order by a.created_at`,
  },
  {
    title: "sessions: the newest 20",
    sql: `select s.id, s.created_at, s.expires_at, s.ip_address, s.user_agent, s.impersonated_by
from sessions s join users u on u.id = s.user_id
where u.email = $1 order by s.created_at desc limit 20`,
  },
];
