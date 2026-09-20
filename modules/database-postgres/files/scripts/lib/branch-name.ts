import { createHash } from "node:crypto";

// The name a development database gets. One project on one server may hold several: the
// plain `<prefix>_dev` for the default branch, and `<prefix>_dev_<branch>` for every
// branch that carries a migration nobody has merged yet.
//
// The names are built so `assertManagedDatabase` can quote them into `CREATE DATABASE`:
// every one of them is `[a-z0-9_]` only.

/** PostgreSQL cuts an identifier past 63 bytes, so two long branches would collide. */
const MAX_IDENTIFIER_BYTES = 63;

/** `_` plus the first 6 hex characters of the branch's SHA-1. */
const HASH_LENGTH = 6;

/** A branch `issue-<N>-<title>` keeps only its issue number, e.g. `issue-87-add-...`. */
const ISSUE_BRANCH = /^issue-(\d+)(?:-|$)/i;

function hashOf(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, HASH_LENGTH);
}

/** Lowercase, every run outside `[a-z0-9]` to `_`, no leading or trailing `_`. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "_")
    .replaceAll(/^_+|_+$/g, "");
}

/**
 * The prefix every database of this project shares: the project's name, slugified, with
 * `_dev` after it. `@acme/shop` becomes `acme_shop_dev`, so two projects on one shared
 * server never pick the same name.
 *
 * A name that slugifies to nothing, or one starting with a digit, falls back to `app_dev`:
 * an unquoted PostgreSQL identifier may not start with a digit.
 */
export function databasePrefix(projectName: string): string {
  const slug = slugify(projectName);
  if (!slug || /^\d/.test(slug)) {
    return "app_dev";
  }
  return `${slug}_dev`;
}

/**
 * Turn `branch` into its database name. An `issue-<N>-<title>` branch drops the title and
 * becomes `<prefix>_issue_<N>_` plus a SHA-1 prefix of the full branch name, because the
 * title is long and says nothing the number does not. Any other branch is slugified. A
 * name over 63 bytes is cut and gets `_` plus the SHA-1 prefix.
 *
 * Throws for a branch that leaves nothing to name.
 */
export function branchDatabaseName(prefix: string, branch: string): string {
  const issue = ISSUE_BRANCH.exec(branch);
  if (issue) {
    return `${prefix}_issue_${issue[1]}_${hashOf(branch)}`;
  }
  const slug = slugify(branch);
  if (!slug) {
    throw new Error(`Cannot name a database for the branch "${branch}".`);
  }

  const name = `${prefix}_${slug}`;
  if (name.length <= MAX_IDENTIFIER_BYTES) {
    return name;
  }
  const kept = name
    .slice(0, MAX_IDENTIFIER_BYTES - HASH_LENGTH - 1)
    .replace(/_+$/, "");
  return `${kept}_${hashOf(branch)}`;
}

/**
 * Throw unless `database` is one this project's scripts may create or drop: the plain
 * `<prefix>` or `<prefix>_<something>`, `[a-z0-9_]` only and inside 63 bytes.
 *
 * Every `CREATE DATABASE` and `DROP DATABASE` passes through here first. A name that
 * passes carries no quote, no space and no semicolon, which is what lets the backends
 * quote it into `sql.unsafe`.
 */
export function assertManagedDatabase(prefix: string, database: string): void {
  const managed = new RegExp(`^${prefix}(_[a-z0-9_]+)?$`);
  if (!managed.test(database) || database.length > MAX_IDENTIFIER_BYTES) {
    throw new Error(
      `Refusing to create or drop "${database}": these scripts only touch ${prefix} and ${prefix}_<branch> databases.`
    );
  }
}
