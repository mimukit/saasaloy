#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { parseJsonc } from "@repo/env/deploy";
import { parseValues, splitLines } from "@repo/env/dotenv";

// `pnpm logs:prod --since <time> [--until <time>] [--search <text>] [--limit <n>] [--worker <name>]`:
// read the production api Worker's logs through the Workers Observability query API, for
// debugging. Every printed line passes through `maskText`, which masks the local part of
// an email address.
//
// The token and the account id come from `~/.config/<project>/cloudflare-logs.env`, mode
// 0600, never from `packages/env/.env.prod`: that file holds the deploy token, and this
// command needs nothing that can deploy. `<project>` is the root `package.json` name as
// `projectSlug` builds it. The query runs with `dry: true`, so it saves nothing in the
// dashboard.
//
// Workers Logs keeps lines for 3 days on the Free plan and 7 on Workers Paid. The command
// prints the time of the oldest line it returns, and warns when the window starts beyond
// 7 days, so an empty answer outside the window does not read as "nothing happened".

const TOKEN_KEY = "CLOUDFLARE_LOGS_API_TOKEN";
const ACCOUNT_KEY = "CLOUDFLARE_ACCOUNT_ID";
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2000;
export const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const API_WRANGLER = "apps/api/wrangler.jsonc";

const USAGE =
  "Usage: pnpm logs:prod --since <ISO time | 30m | 2h | 3d> [--until <time>] [--search <text>] [--limit <n>] [--worker <name>]";

const SETUP = `Create it with ${TOKEN_KEY} (an API token with "Workers Observability: Read" only, nothing else) and ${ACCOUNT_KEY}, then run chmod 600 on it.`;

/**
 * The root `package.json` name as a folder name, the rule `databasePrefix` in the
 * `database-postgres` scripts uses without its `_dev`: `@acme/shop` becomes `acme_shop`.
 * A name that slugifies to nothing, or one starting with a digit, falls back to `app`.
 * Both commands then share one `~/.config/<project>/` folder.
 */
export function projectSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
  return slug === "" || /^\d/.test(slug) ? "app" : slug;
}

/** `~/.config/<project>/cloudflare-logs.env`. */
export function logsEnvPath(home: string, projectName: string): string {
  return path.join(
    home,
    ".config",
    projectSlug(projectName),
    "cloudflare-logs.env"
  );
}

export interface LogsArgs {
  from: number;
  to: number;
  search?: string;
  limit: number;
  worker?: string;
}

const SPAN_UNIT_MS: Record<string, number> = {
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** A time flag: an ISO time, or a span back from `now` such as `30m`, `2h` or `3d`. */
export function parseTime(value: string, now: number): number {
  const span = /^(\d+)([mhd])$/.exec(value);
  if (span) {
    return now - Number(span[1]) * (SPAN_UNIT_MS[span[2] ?? ""] ?? 0);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new TypeError(
      `${value} is not a time. Use an ISO time such as 2026-10-31T10:00Z, or a span such as 2h.`
    );
  }
  return parsed;
}

const FLAGS = new Set([
  "--since",
  "--until",
  "--search",
  "--limit",
  "--worker",
]);

/** Read the flags. A `--`, which `pnpm run x -- --flag` forwards, is skipped. */
export function parseLogsArgs(argv: readonly string[], now: number): LogsArgs {
  const args = argv.filter((arg) => arg !== "--");
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index] ?? "";
    if (!FLAGS.has(flag)) {
      throw new Error(`Unknown argument ${flag}.\n${USAGE}`);
    }
    const value = args[index + 1];
    if (value === undefined || value === "" || value.startsWith("--")) {
      throw new Error(`${flag} needs a value.\n${USAGE}`);
    }
    values.set(flag, value);
    index += 1;
  }
  const since = values.get("--since");
  if (since === undefined) {
    throw new Error(`--since is required.\n${USAGE}`);
  }
  const from = parseTime(since, now);
  const until = values.get("--until");
  const to = until === undefined ? now : parseTime(until, now);
  if (from >= to) {
    throw new Error("--since must be earlier than --until.");
  }
  const limit = Number(values.get("--limit") ?? DEFAULT_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new Error(`--limit takes a whole number from 1 to ${MAX_LIMIT}.`);
  }
  const search = values.get("--search");
  const worker = values.get("--worker");
  return {
    from,
    to,
    ...(search === undefined ? {} : { search }),
    limit,
    ...(worker === undefined ? {} : { worker }),
  };
}

/** The window starts before the longest Workers Logs retention, so its start is gone. */
export function beyondRetention(from: number, now: number): boolean {
  return from < now - RETENTION_MS;
}

/** The body of `POST /accounts/{id}/workers/observability/telemetry/query`. */
export function buildQueryBody(
  args: LogsArgs & { worker: string }
): Record<string, unknown> {
  return {
    queryId: "logs-prod",
    view: "events",
    dry: true,
    limit: args.limit,
    timeframe: { from: args.from, to: args.to },
    parameters: {
      filters: [
        {
          key: "$workers.scriptName",
          operation: "eq",
          type: "string",
          value: args.worker,
        },
      ],
      ...(args.search === undefined
        ? {}
        : {
            needle: { value: args.search, isRegex: false, matchCase: false },
          }),
    },
  };
}

const EMAIL = /[\w.+-]+@([\w-]+(?:\.[\w-]+)+)/g;

/**
 * Mask the local part of every email address in free text: `ana@example.com` becomes
 * `***@example.com`. An accident guard, not a privacy boundary: a name in a log line
 * stays as it is.
 */
export function maskText(text: string): string {
  return text.replaceAll(EMAIL, (_match, domain: string) => `***@${domain}`);
}

export interface LogLine {
  timestamp: number;
  level: string;
  requestId: string;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value[key]` when `value` is an object, else `undefined`. */
function field(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

function stringOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function messageOf(source: unknown, metadata: unknown): string {
  if (typeof source === "string") {
    return source;
  }
  return source === undefined
    ? stringOf(field(metadata, "message"))
    : JSON.stringify(source);
}

/** The events in a query response (`result.events.events`), oldest first. */
export function extractEvents(response: unknown): LogLine[] {
  const events = field(field(field(response, "result"), "events"), "events");
  if (!Array.isArray(events)) {
    return [];
  }
  return events
    .map((event: unknown) => {
      const metadata = field(event, "$metadata");
      const timestamp = field(event, "timestamp");
      return {
        timestamp: typeof timestamp === "number" ? timestamp : 0,
        level: stringOf(field(metadata, "level")),
        requestId: stringOf(field(metadata, "requestId")),
        message: messageOf(field(event, "source"), metadata),
      };
    })
    .toSorted((a, b) => a.timestamp - b.timestamp);
}

/** One printed line per event, masked. */
export function formatLine(line: LogLine): string {
  const parts = [
    new Date(line.timestamp).toISOString(),
    line.level || "-",
    line.requestId || "-",
    line.message,
  ];
  return maskText(parts.join(" "));
}

export interface Credentials {
  token: string;
  account: string;
}

/**
 * The token and the account id from `file`. Refuses a missing file, a mode wider than
 * 0600, and a file without both keys, each with a message that names the path.
 */
export function readCredentials(file: string): Credentials {
  let mode: number;
  try {
    ({ mode } = statSync(file));
  } catch {
    throw new Error(`No ${file}. ${SETUP}`);
  }
  // oxlint-disable-next-line no-bitwise -- the group and other bits of a file mode
  if ((mode & 0o077) !== 0) {
    // oxlint-disable-next-line no-bitwise -- the permission bits, printed as `644`
    const permissions = (mode & 0o777).toString(8);
    throw new Error(
      `${file} is mode ${permissions}. It holds an API token: run chmod 600 ${file}.`
    );
  }
  const values = parseValues(splitLines(readFileSync(file, "utf-8")));
  const token = values.get(TOKEN_KEY) ?? "";
  const account = values.get(ACCOUNT_KEY) ?? "";
  if (token === "" || account === "") {
    throw new Error(
      `${file} needs both ${TOKEN_KEY} and ${ACCOUNT_KEY}. ${SETUP}`
    );
  }
  return { token, account };
}

/** The `name` in `apps/api/wrangler.jsonc`, or undefined when there is none. */
export function defaultWorker(root: string): string | undefined {
  const file = path.join(root, API_WRANGLER);
  if (!existsSync(file)) {
    return undefined;
  }
  const config = parseJsonc(readFileSync(file, "utf-8"));
  const name = field(config, "name");
  return typeof name === "string" && name !== "" ? name : undefined;
}

function rootPackageName(root: string): string {
  const file = path.join(root, "package.json");
  if (!existsSync(file)) {
    return "";
  }
  return stringOf(field(JSON.parse(readFileSync(file, "utf-8")), "name"));
}

export interface LogsDeps {
  /** The repo root, where `package.json` and `apps/api/wrangler.jsonc` live. */
  root: string;
  /** The home folder `~/.config/<project>/` sits in. */
  home: string;
  now: () => number;
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  say: (line: string) => void;
}

function apiError(status: number, body: unknown): Error {
  const errors = field(body, "errors");
  const messages = (Array.isArray(errors) ? errors : [])
    .map((error: unknown) => stringOf(field(error, "message")))
    .filter((message) => message !== "")
    .join("; ");
  const hint =
    status === 401 || status === 403
      ? ' The token needs "Workers Observability: Read" on this account.'
      : "";
  return new Error(
    `The Observability API answered ${String(status)}${messages ? `: ${messages}` : ""}.${hint}`
  );
}

/** Read the flags, the credentials and the default Worker, run the query, print it masked. */
export async function runLogs(
  argv: readonly string[],
  deps: LogsDeps
): Promise<void> {
  const now = deps.now();
  const args = parseLogsArgs(argv, now);
  const worker = args.worker ?? defaultWorker(deps.root);
  if (worker === undefined) {
    throw new Error(
      `${API_WRANGLER} has no name, so there is no default Worker. Pass --worker <name>.`
    );
  }
  const { token, account } = readCredentials(
    logsEnvPath(deps.home, rootPackageName(deps.root))
  );

  deps.say(
    `Logs for ${worker}, ${new Date(args.from).toISOString()} to ${new Date(args.to).toISOString()}${args.search === undefined ? "" : `, matching "${maskText(args.search)}"`}.`
  );
  if (beyondRetention(args.from, now)) {
    deps.say(
      "Warning: the window starts more than 7 days ago. Workers Logs keeps 3 days (Free) or 7 days (Paid), so older lines are gone."
    );
  }

  const response = await deps.fetch(
    `https://api.cloudflare.com/client/v4/accounts/${account}/workers/observability/telemetry/query`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildQueryBody({ ...args, worker })),
    }
  );
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok || field(body, "success") === false) {
    throw apiError(response.status, body);
  }

  const lines = extractEvents(body);
  for (const line of lines) {
    deps.say(formatLine(line));
  }
  const [oldest] = lines;
  deps.say(
    oldest === undefined
      ? "No lines matched in this window."
      : `${String(lines.length)} line(s); the oldest is from ${new Date(oldest.timestamp).toISOString()}.${lines.length === args.limit ? " That is the --limit; narrow the window or raise it." : ""}`
  );
}

if (import.meta.main) {
  try {
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim();
    await runLogs(process.argv.slice(2), {
      root,
      home: homedir(),
      now: () => Date.now(),
      fetch: async (url, init) => await fetch(url, init),
      say: (line) => {
        process.stdout.write(`${line}\n`);
      },
    });
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
