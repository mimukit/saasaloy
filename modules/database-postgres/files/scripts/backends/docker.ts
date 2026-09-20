import { spawnSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { withSql } from "../lib/context.ts";
import { swapDatabase } from "../lib/url.ts";
import { MAINTENANCE_DATABASE, createDatabase } from "./server.ts";

// The default backend, `pnpm db:setup --docker`: the Postgres container the scaffolded
// `compose.yaml` at the repo root defines. `db:setup` starts it when it is not answering,
// waits for it, and then does exactly the `CREATE DATABASE` work the `server` backend does,
// because a container is a Postgres server that happens to be local.
//
// The credentials are the ones `compose.yaml` ships. They are development-only and the port
// is published on localhost, so they are deliberately not a secret and not configurable:
// two places to change a password is how the two drift.

export const DOCKER_UNREACHABLE =
  "Cannot reach the local Postgres container. Run docker compose up -d in the repo root, or run pnpm db:setup --server to use a server instead.";

/** Matches the service `compose.yaml` publishes. Change both or neither. */
export const CONTAINER_URL =
  "postgres://postgres:postgres@127.0.0.1:5432/postgres";

/** How long `db:setup` waits for a freshly started container to accept a connection. */
const READY_TIMEOUT_MS = 60_000;
const POLL_MS = 1000;

/** The container's server and role, pointed at `postgres`. */
export function adminUrl(): string {
  return swapDatabase(CONTAINER_URL, MAINTENANCE_DATABASE);
}

async function answers(): Promise<boolean> {
  try {
    await withSql(adminUrl(), DOCKER_UNREACHABLE, async (sql) => {
      await sql`select 1`;
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Start the container and wait for it, unless it is already answering. `docker compose up -d`
 * runs in the repo root with no `-f`, which is the command a developer types by hand, and it
 * is safe to repeat: compose leaves a running service alone.
 */
export async function ensureRunning(root: string): Promise<void> {
  if (await answers()) {
    return;
  }
  const result = spawnSync("docker", ["compose", "up", "-d"], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(
      "docker compose up -d failed. Check that Docker is installed and running, or run pnpm db:setup --server to use a server instead."
    );
  }

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await answers()) {
      return;
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `The container started but did not accept a connection within ${READY_TIMEOUT_MS / 1000}s. Check docker compose logs.`
  );
}

/** Create the database in the container, starting it first when it is not up. */
export async function create(
  root: string,
  prefix: string,
  database: string
): Promise<string> {
  await ensureRunning(root);
  await createDatabase(prefix, adminUrl(), database);
  return swapDatabase(CONTAINER_URL, database);
}
