import { branchDatabaseName, testDatabaseName } from "./branch-name.ts";
import type { Mapping } from "./mapping.ts";

// The decision `db:prune` makes, kept free of SQL, git and `gh` so a test can drive every
// branch of it. `scripts/prune.ts` gathers the inputs and acts on the answer.
//
// A database is dropped only when its mapped branch is closed:
//
// - From this clone: the branch is in no `refs/heads/*` and no `refs/remotes/*/*`. Closed
//   is enough, so an abandoned branch goes too.
// - From another clone: this clone's refs say nothing about it, so only a merged pull
//   request for the branch counts. With no `gh`, or no merged PR, the database stays.
//
// The default `<prefix>` database and its test database are never candidates, and nor is a
// database with an open session, because the drop would end that session.
//
// Nor is a database of another project. The name guard lets `shop_dev` see the databases of
// a project whose prefix is `shop_dev_tools_dev`. A mapping names its project's prefix, so a
// mapped database of another project is kept. An unmapped name is judged by its shape: every
// prefix ends in `_dev`, so a `dev` segment after this prefix marks another project's name,
// and `--include-unmapped` keeps it too. A branch with a `dev` segment of its own is kept
// the same way, which errs on the side of keeping.

export type SkipReason =
  | "default"
  | "branch open"
  | "foreign, no merged PR"
  | "foreign, gh missing"
  | "unmapped"
  | "other project"
  | "in use";

/** What `gh` says about a branch: a merged PR, none, or nothing because `gh` is missing. */
export type MergeState = "merged" | "not merged" | "gh missing";

export interface DatabaseInfo {
  name: string;
  /** The parsed comment, or `undefined` for a database made before the mapping existed. */
  mapping?: Mapping;
  /** Sessions open on it, the caller's own excluded. */
  sessions: number;
  /** Its size, ready to print. */
  size?: string;
}

export interface PruneInput {
  prefix: string;
  /** This clone's id, from `cloneId`. */
  clone: string;
  databases: DatabaseInfo[];
  /** Branch names from `refs/heads/*`. */
  localBranches: readonly string[];
  /** Branch names from `refs/remotes/<remote>/*`, the remote's name taken off. */
  remoteBranches: readonly string[];
  /**
   * Whether `branch` has a merged pull request. Called only for a database another clone
   * mapped.
   */
  mergedPr: (branch: string) => MergeState;
  /** `--include-unmapped`: judge an unmapped database by the names the refs compute to. */
  includeUnmapped: boolean;
}

export interface Skipped {
  database: DatabaseInfo;
  reason: SkipReason;
}

export interface PrunePlan {
  candidates: DatabaseInfo[];
  skipped: Skipped[];
}

/** The database names every open branch computes to, test databases included. */
function openNames(prefix: string, branches: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const branch of branches) {
    let database: string;
    try {
      database = branchDatabaseName(prefix, branch);
    } catch {
      continue;
    }
    names.add(database);
    names.add(testDatabaseName(database));
  }
  return names;
}

/**
 * True when an unmapped `name` may belong to another project: the part after `<prefix>_`
 * holds a `dev` segment, as `shop_dev_tools_dev` and `shop_dev_tools_dev_feat_a` do for
 * the prefix `shop_dev`.
 */
export function looksForeign(prefix: string, name: string): boolean {
  if (!name.startsWith(`${prefix}_`)) {
    return false;
  }
  return /(?:^|_)dev(?:_|$)/.test(name.slice(prefix.length + 1));
}

/** Why `database` stays, or `undefined` when its branch is closed. */
function keepReason(
  input: PruneInput,
  database: DatabaseInfo,
  open: Set<string>,
  computed: () => Set<string>
): SkipReason | undefined {
  const { mapping } = database;
  if (!mapping) {
    if (!input.includeUnmapped) {
      return "unmapped";
    }
    if (looksForeign(input.prefix, database.name)) {
      return "other project";
    }
    return computed().has(database.name) ? "branch open" : undefined;
  }
  if (mapping.prefix !== input.prefix) {
    return "other project";
  }
  if (mapping.clone === input.clone) {
    return open.has(mapping.branch) ? "branch open" : undefined;
  }
  const merged = input.mergedPr(mapping.branch);
  if (merged === "gh missing") {
    return "foreign, gh missing";
  }
  return merged === "merged" ? undefined : "foreign, no merged PR";
}

export function planPrune(input: PruneInput): PrunePlan {
  const defaults = new Set([input.prefix, testDatabaseName(input.prefix)]);
  const open = new Set([...input.localBranches, ...input.remoteBranches]);
  let names: Set<string> | undefined;
  const computed = (): Set<string> => {
    names ??= openNames(input.prefix, [...open]);
    return names;
  };

  const plan: PrunePlan = { candidates: [], skipped: [] };
  for (const database of input.databases) {
    const reason = defaults.has(database.name)
      ? "default"
      : (keepReason(input, database, open, computed) ??
        (database.sessions > 0 ? "in use" : undefined));
    if (reason) {
      plan.skipped.push({ database, reason });
    } else {
      plan.candidates.push(database);
    }
  }
  return plan;
}

/** `refs/heads/x` and `refs/remotes/<remote>/x` lines, split into local and remote names. */
export function readRefs(lines: readonly string[]): {
  local: string[];
  remote: string[];
} {
  const local: string[] = [];
  const remote: string[] = [];
  for (const line of lines) {
    const ref = line.trim();
    if (ref.startsWith("refs/heads/")) {
      local.push(ref.slice("refs/heads/".length));
    } else if (ref.startsWith("refs/remotes/")) {
      const name = ref
        .slice("refs/remotes/".length)
        .split("/")
        .slice(1)
        .join("/");
      if (name && name !== "HEAD") {
        remote.push(name);
      }
    }
  }
  return { local, remote };
}
