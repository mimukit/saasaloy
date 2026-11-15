import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname } from "node:os";
import { resolve } from "node:path";
import { assertManagedDatabase } from "./branch-name.ts";

// The database mapping: which branch, worktree and clone a development or test database
// belongs to. `db:setup` and the test setup write it as the database's comment, and
// `db:prune` reads it back to decide whether the branch is closed. A comment, not a table,
// so the project's drizzle schema never sees it.
//
// The comment is JSON: `{"saasaloy":1,"branch":…,"worktree":…,"clone":…}`. A comment that
// does not parse to that shape is not a mapping, and `db:prune` treats the database as
// unmapped.

export interface Mapping {
  /** The branch the checkout was on when it wrote the mapping. */
  branch: string;
  /** Absolute path of the checkout. */
  worktree: string;
  /** Which clone wrote it: every worktree of one clone shares the id. */
  clone: string;
}

/** Hex characters of the SHA-1 kept as the clone id. */
const CLONE_ID_LENGTH = 12;

/**
 * The clone id for a host and a git common dir. Every worktree of one clone shares the
 * common dir, so they share the id; a second clone on the same machine, or the same path on
 * another machine, gets another.
 */
export function cloneIdOf(host: string, commonDir: string): string {
  return createHash("sha1")
    .update(`${host}\n${commonDir}`)
    .digest("hex")
    .slice(0, CLONE_ID_LENGTH);
}

/** The clone id of the checkout at `root`, from `git rev-parse --git-common-dir`. */
export function cloneId(root: string): string {
  const result = spawnSync("git", ["rev-parse", "--git-common-dir"], {
    cwd: root,
    encoding: "utf-8",
  });
  const dir = result.status === 0 ? result.stdout.trim() : "";
  // git prints the common dir relative to `root` in the main checkout, absolute elsewhere.
  return cloneIdOf(hostname(), dir ? resolve(root, dir) : root);
}

/** The comment text for a mapping. */
export function formatMapping(mapping: Mapping): string {
  return JSON.stringify({
    saasaloy: 1,
    branch: mapping.branch,
    worktree: mapping.worktree,
    clone: mapping.clone,
  });
}

/** A mapping read back from a comment, or `undefined` when the comment is not one. */
export function parseMapping(
  comment: string | null | undefined
): Mapping | undefined {
  if (!comment) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(comment);
  } catch {
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const { branch, worktree, clone } = record;
  if (
    record.saasaloy !== 1 ||
    typeof branch !== "string" ||
    typeof worktree !== "string" ||
    typeof clone !== "string" ||
    !clone
  ) {
    return undefined;
  }
  return { branch, worktree, clone };
}

/**
 * The `COMMENT ON DATABASE` statement that writes `mapping` on `database`. PostgreSQL takes
 * no bind parameter in a `COMMENT`, so the text is a quoted literal with each `'` doubled,
 * and the name passes `assertManagedDatabase` before it is quoted.
 */
export function mappingStatement(
  prefix: string,
  database: string,
  mapping: Mapping
): string {
  assertManagedDatabase(prefix, database);
  const text = formatMapping(mapping).replaceAll("'", "''");
  return `COMMENT ON DATABASE "${database}" IS '${text}'`;
}
