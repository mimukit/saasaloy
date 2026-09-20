// The state block `db:setup` writes at the top of `apps/api/.dev.vars`. It is a run of
// comment lines, so wrangler and `process.loadEnvFile` skip it, and it is the only record
// of which backend made the database this worktree uses.
//
// A backend is not a provider. A provider is a registry module selected by a `<CAP>_PROVIDER`
// env var inside the Worker; a backend is where a developer's own database runs and nothing
// at runtime ever reads it. See the ADR on the db lifecycle scripts.

export type Backend = "docker" | "server" | "neon";

export interface State {
  backend: Backend;
  database: string;
  /** ISO time the database was created. Absent when the block was inferred. */
  created?: string;
  /** ISO time neon.new deletes an unclaimed database. docker and server have none. */
  expires?: string;
  /** neon.new's claim URL. */
  claim?: string;
}

export type Liveness = "live" | "expired" | "unknown";

export interface BackendFlags {
  docker: boolean;
  server: boolean;
  neon: boolean;
  reset: boolean;
}

export const BACKEND_LABEL: Record<Backend, string> = {
  docker: "a local Docker container",
  server: "the server DATABASE_URL names",
  neon: "neon.new",
};

/**
 * `--docker`, `--server` or `--neon` names a backend. With none, an existing block keeps
 * its backend, `--reset` included, and `docker` is the default, because a fresh project has
 * no server to connect to. Moving an existing database to another backend needs `--reset`.
 */
export function chooseBackend(flags: BackendFlags, state?: State): Backend {
  const wanted = (["docker", "server", "neon"] as const).filter(
    (name) => flags[name]
  );
  if (wanted.length > 1) {
    throw new Error("Pass one of --docker, --server or --neon, not several.");
  }
  const [first] = wanted;
  if (state && first && first !== state.backend && !flags.reset) {
    throw new Error(
      `This checkout already uses ${state.database} on ${BACKEND_LABEL[state.backend]}. Run pnpm db:setup --reset --${first} to replace it with a database on ${BACKEND_LABEL[first]}.`
    );
  }
  return first ?? state?.backend ?? "docker";
}

export const BLOCK_BEGIN =
  "# db:setup state: written by pnpm db:setup, edit with care";
export const BLOCK_END = "# end db:setup state";

const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** The block's comment lines, markers included. */
export function formatState(state: State): string[] {
  const lines = [
    BLOCK_BEGIN,
    `# backend=${state.backend}`,
    `# database=${state.database}`,
  ];
  if (state.created) {
    lines.push(`# created=${state.created}`);
  }
  if (state.expires) {
    lines.push(`# expires=${state.expires}`);
  }
  if (state.claim) {
    lines.push(`# claim=${state.claim}`);
  }
  lines.push(BLOCK_END);
  return lines;
}

/** Read a block back. Returns `undefined` when it names no known backend or database. */
export function parseState(lines: string[]): State | undefined {
  const fields = new Map<string, string>();
  for (const line of lines) {
    const match = /^#\s*([a-z]+)=(.*)$/.exec(line.trim());
    if (match?.[1] && match[2] !== undefined) {
      fields.set(match[1], match[2].trim());
    }
  }

  const backend = fields.get("backend");
  const database = fields.get("database");
  if (
    (backend !== "docker" && backend !== "server" && backend !== "neon") ||
    !database
  ) {
    return undefined;
  }

  const state: State = { backend, database };
  for (const key of ["created", "expires", "claim"] as const) {
    const value = fields.get(key);
    if (value) {
      state[key] = value;
    }
  }
  return state;
}

/** A docker or server database never expires. A neon.new one with no readable expiry is unknown. */
export function liveness(state: State, now: Date): Liveness {
  if (state.backend !== "neon") {
    return "live";
  }
  const expires = state.expires ? Date.parse(state.expires) : Number.NaN;
  if (Number.isNaN(expires)) {
    return "unknown";
  }
  return now.getTime() >= expires ? "expired" : "live";
}

/** `no expiry`, `unknown`, `expired`, or `<h>h <m>m left`. */
export function timeLeft(state: State, now: Date): string {
  const live = liveness(state, now);
  if (state.backend !== "neon") {
    return "no expiry";
  }
  if (live !== "live") {
    return live;
  }
  const ms = Date.parse(state.expires ?? "") - now.getTime();
  const hours = Math.floor(ms / HOUR_MS);
  const minutes = Math.floor((ms % HOUR_MS) / MINUTE_MS);
  return `${hours}h ${minutes}m left`;
}

/**
 * Build a block for a `DATABASE_URL` set before `db:setup` ever wrote one. A `neon.tech`
 * host is neon.new with an unknown expiry. Any other host holding a database this project
 * manages is the `server` backend, or `docker` when the host is the local one the scaffolded
 * `compose.yaml` publishes.
 *
 * Anything else returns `undefined`, and every script refuses rather than touching a
 * database it cannot prove it made.
 */
export function inferState(
  url: string,
  isManaged: (database: string) => boolean
): State | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!database) {
    return undefined;
  }

  if (parsed.hostname.endsWith(".neon.tech")) {
    return { backend: "neon", database };
  }
  if (!isManaged(database)) {
    return undefined;
  }
  const local =
    parsed.hostname === "localhost" ||
    parsed.hostname === "127.0.0.1" ||
    parsed.hostname === "::1";
  return { backend: local ? "docker" : "server", database };
}
