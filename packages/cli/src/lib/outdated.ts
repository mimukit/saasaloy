import { BASE_MODULE } from "./base.js";
import type { LockModule, Lockfile } from "./lock.js";
import { DEFAULT_SOURCE, releaseTag } from "./registry.js";

// The rows `saasaloy outdated` prints (#50, #120), on the render engine (plan 0116). The
// default registry moves as one release (ADR 0062): the base template and every default
// module stand at the lock's `base.cliVersion`, and `update` moves them all to the running
// CLI's release. A module from another registry still moves on its own ref, so its row
// compares the commit the lock recorded with the commit the ref resolves to now.

/**
 * Where an installed module stands:
 *   current       — at the release or commit `update` would move it to
 *   outdated      — `update` would move it
 *   pinned        — the lock's `ref` is itself a SHA, so it is frozen by definition
 *   local         — installed from a working copy; nothing to re-resolve
 *   unresolvable  — no lock entry, or the source couldn't be reached
 *   untracked     — the base only: the lock has no base record
 */
export type UpdateStatus =
  "current" | "outdated" | "pinned" | "local" | "unresolvable" | "untracked";

export interface ModuleComparison {
  name: string;
  /** `owner/repo`, or `local`. */
  source: string;
  /** The ref the row compares on: a release tag, or the lock's ref. */
  ref: string;
  /** The release or the commit the lock records today. */
  current: string;
  /** Where `update` would move it; equal to `current` when nothing moved. */
  latest: string;
  status: UpdateStatus;
  /** Why, for everything that isn't a plain current/outdated. */
  detail?: string;
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

/** What the base row prints where a module prints its `owner/repo`. */
export const BASE_SOURCE = "bundled template";

export interface CompareBaseArgs {
  lock: Lockfile;
  /** `readVersion()` of the running CLI. */
  running: string;
  /** The project still holds a version 1 manifest, which `update` converts. */
  versionOne?: boolean;
}

/**
 * The base's row: the lock's release against the running CLI's. `untracked` when the lock
 * has no base record. A version 1 project is always `outdated`, because its first
 * `update` converts it, even at the same release.
 */
export function compareBase(args: CompareBaseArgs): ModuleComparison {
  const { lock, running } = args;
  if (lock.base === undefined) {
    return {
      current: "untracked",
      detail: "not recorded — run `saasaloy update` to record the base",
      latest: running,
      name: BASE_MODULE,
      ref: releaseTag(running),
      source: BASE_SOURCE,
      status: "untracked",
    };
  }
  const recorded = lock.base.cliVersion;
  return {
    current: recorded,
    latest: running,
    name: BASE_MODULE,
    ref: releaseTag(running),
    source: BASE_SOURCE,
    status:
      recorded === running && args.versionOne !== true ? "current" : "outdated",
    ...(args.versionOne === true
      ? {
          detail:
            "a version 1 project — `saasaloy update` converts it to the render engine",
        }
      : {}),
  };
}

export interface CompareModulesArgs {
  /** Modules to compare: `saasaloy.json`'s `installed`. */
  installed: readonly string[];
  lock: Lockfile;
  /** The running CLI's version: where `update` moves the default registry. */
  running: string;
  /** True when SAASALOY_REGISTRY_DIR is set: a working copy replaces the registry. */
  registryOverride?: boolean;
  /** Resolve a third-party module's ref to a commit SHA. Rejecting marks it unresolvable. */
  resolveRef: (name: string, entry: LockModule, ref: string) => Promise<string>;
}

/**
 * Compare every installed module with where `update` would move it. Never throws: an
 * unreachable source becomes an `unresolvable` row, so one dead repo can't hide the rest.
 */
export async function compareModules(
  args: CompareModulesArgs
): Promise<ModuleComparison[]> {
  const { installed, lock, running, registryOverride, resolveRef } = args;
  const out: ModuleComparison[] = [];
  for (const name of installed) {
    const entry = lock.modules[name];
    if (!entry) {
      out.push({
        current: "unknown",
        detail:
          "no lock entry — reinstall it with `saasaloy add` to record its provenance",
        latest: "unknown",
        name,
        ref: "unknown",
        source: "unknown",
        status: "unresolvable",
      });
      continue;
    }
    if (
      registryOverride === true ||
      entry.source === "local" ||
      entry.resolved === "local"
    ) {
      out.push({
        current: entry.resolved,
        detail: registryOverride
          ? "local install — every module reads the working copy"
          : "installed from a working copy — set SAASALOY_REGISTRY_DIR to update it",
        latest: entry.resolved,
        name,
        ref: entry.ref,
        source: entry.source,
        status: "local",
      });
      continue;
    }
    if (entry.source === DEFAULT_SOURCE) {
      const recorded = lock.base?.cliVersion ?? entry.ref;
      out.push({
        current: recorded,
        latest: running,
        name,
        ref: releaseTag(running),
        source: entry.source,
        status: recorded === running ? "current" : "outdated",
      });
      continue;
    }
    if (SHA_PATTERN.test(entry.ref)) {
      out.push({
        current: entry.resolved,
        detail: "pinned to a commit — nothing to update",
        latest: entry.resolved,
        name,
        ref: entry.ref,
        source: entry.source,
        status: "pinned",
      });
      continue;
    }
    try {
      const latest = await resolveRef(name, entry, entry.ref);
      out.push({
        current: entry.resolved,
        latest,
        name,
        ref: entry.ref,
        source: entry.source,
        status: latest === entry.resolved ? "current" : "outdated",
      });
    } catch (error) {
      out.push({
        current: entry.resolved,
        detail: error instanceof Error ? error.message : String(error),
        latest: entry.resolved,
        name,
        ref: entry.ref,
        source: entry.source,
        status: "unresolvable",
      });
    }
  }
  return out;
}
