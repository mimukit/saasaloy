import dns from "node:dns";
import net from "node:net";
import { assertManagedDatabase } from "../lib/branch-name.ts";
import { withSql } from "../lib/context.ts";
import { directHost, stripChannelBinding, swapDatabase } from "../lib/url.ts";
import { MAINTENANCE_DATABASE } from "./server.ts";

// The `pnpm db:setup --neon` backend: an unclaimed neon.new project that deletes itself a
// few days after it is created. It covers a machine with no Docker and no server to reach.
//
// neon.new runs PostgreSQL 17, which has no `uuidv7()`, so `prepare` creates a SQL shim
// before the migrations run. The shim is not monotonic within one millisecond, unlike
// PostgreSQL 18's. A schema that does not call `uuidv7()` never notices either way.

const API = "https://neon.new/api/v1/database";

export const NEON_UNREACHABLE = "Cannot reach neon.new";
export const NEON_NOTE = "PostgreSQL 17 with a uuidv7() shim";

/** Node's dual-stack connect times out against neon hosts on some networks. */
export const IPV4_NODE_OPTIONS =
  "--dns-result-order=ipv4first --no-network-family-autoselection";

/** A version-7 UUID: 48 bits of Unix milliseconds over a random v4, version bits set to 7. */
const UUIDV7_SHIM = `
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
  SELECT encode(
    set_bit(set_bit(
      overlay(uuid_send(gen_random_uuid())
        placing substring(int8send(floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint) FROM 3)
        FROM 1 FOR 6),
      52, 1), 53, 1),
    'hex')::uuid;
$$ LANGUAGE sql VOLATILE;`;

interface NeonResponse {
  connection_string?: string;
  expires_at?: string;
  claim_url?: string;
}

/** The in-process twin of `IPV4_NODE_OPTIONS`, for this script's own fetch and connection. */
export function forceIpv4(): void {
  dns.setDefaultResultOrder("ipv4first");
  net.setDefaultAutoSelectFamily(false);
}

/** Ask neon.new for a project, then create `database` in it. */
export async function createDatabase(
  prefix: string,
  database: string
): Promise<{ url: string; expires?: string; claim?: string }> {
  assertManagedDatabase(prefix, database);
  const response = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ref: database }),
  });
  if (!response.ok) {
    const text = await response.text();
    const detail = text.slice(0, 200);
    throw new Error(
      `neon.new answered ${response.status} ${response.statusText}${
        detail ? `: ${detail}` : ""
      }. Run pnpm db:setup --docker to use a local container instead.`
    );
  }

  const body = (await response.json()) as NeonResponse;
  if (!body.connection_string) {
    throw new Error("neon.new answered with no connection_string.");
  }
  const pooled = stripChannelBinding(body.connection_string);
  await withSql(directHost(pooled), NEON_UNREACHABLE, async (sql) => {
    // The name passed `assertManagedDatabase`, so it is `[a-z0-9_]` only and safe to quote.
    await sql.unsafe(`CREATE DATABASE "${database}"`);
  });
  return {
    url: swapDatabase(pooled, database),
    ...(body.expires_at ? { expires: body.expires_at } : {}),
    ...(body.claim_url ? { claim: body.claim_url } : {}),
  };
}

/**
 * Drop the database inside the neon.new project, over the direct endpoint and from the
 * maintenance database, because a session cannot drop the database it is connected to.
 *
 * The project itself stays. neon.new owns it and deletes it when it expires, and dropping
 * a database is the one thing `db:drop` promises on every backend.
 */
export async function dropDatabase(
  prefix: string,
  url: string,
  database: string
): Promise<void> {
  assertManagedDatabase(prefix, database);
  const admin = directHost(swapDatabase(url, MAINTENANCE_DATABASE));
  await withSql(admin, NEON_UNREACHABLE, async (sql) => {
    await sql.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  });
}

/** Create the `uuidv7()` shim. Safe to repeat. */
export async function prepare(url: string): Promise<void> {
  await withSql(directHost(url), NEON_UNREACHABLE, async (sql) => {
    await sql.unsafe(UUIDV7_SHIM);
  });
}
