// Postgres connection URLs, read and rewritten with WHATWG `URL`. The `postgres:` scheme is
// not a special one, but a URL with `//` still carries a host, a path and a query.

/** The database name the URL's path names. */
export function databaseOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
}

/** `host:port`, for a message. A URL carries a password, so never print the URL itself. */
export function hostOf(url: string): string {
  return new URL(url).host;
}

/** The same server, role and query, pointed at another database. */
export function swapDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${encodeURIComponent(database)}`;
  return parsed.toString();
}

/** neon.new hands out `channel_binding=require`, which postgres.js does not read. */
export function stripChannelBinding(url: string): string {
  const parsed = new URL(url);
  parsed.searchParams.delete("channel_binding");
  return parsed.toString();
}

/** A neon pooled host minus `-pooler`: the direct endpoint, which `CREATE DATABASE` needs. */
export function directHost(url: string): string {
  const parsed = new URL(url);
  parsed.hostname = parsed.hostname.replace("-pooler.", ".");
  return parsed.toString();
}
