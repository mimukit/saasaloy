import type { Lockfile } from "./lock.js";
import type { Graph } from "./resolve.js";
import type { SaasaloyConfig } from "./schema.js";

// `conflictsWith` enforcement for `saasaloy add` — the deterministic core, kept out of
// commands/add.ts so it can be unit-tested (the commands have no test files).
//
// Two modules can be mutually exclusive: two drivers behind one capability, two mailers
// behind one interface. Either side may be the one that declares it, and the refusal has
// to fire whichever module went in first, so the check runs in both directions:
//
//   forward — a descriptor in the resolved graph names an already-installed module;
//   reverse — an already-installed module's lock entry names a module in the graph.
//
// The reverse direction is why `conflictsWith` is recorded into saasaloy-lock.json beside
// `dependsOn`: descriptors aren't kept after install, so the lock is the only offline
// record of what an installed module refuses to sit beside. Same mechanism buildRemovePlan
// already uses for reverse-dependency detection.
//
// A conflict is reported, never resolved. `add` refuses; it uninstalls nothing.

export interface ModuleConflict {
  /** The module that declared the conflict — in its descriptor, or in its lock entry. */
  declaredBy: string;
  /** The module named in that `conflictsWith` list. */
  conflictsWith: string;
  /**
   * Whichever of the two is already installed, and therefore the one `saasaloy remove`
   * can clear. Undefined when both modules arrive in this same run.
   */
  installed?: string;
}

export interface ConflictReport {
  /** Every conflicting pair found, one per pair. Non-empty means `add` must refuse. */
  conflicts: ModuleConflict[];
  /**
   * Installed modules with no lock entry at all: nothing records what they conflict
   * with, so the reverse direction is unverifiable for them (mirrors
   * `RemovePlan.missingLockEntries`). A lock entry written before this field existed is
   * indistinguishable from one whose module declares no conflicts, so it can't be
   * flagged here — this covers the gap that is actually visible.
   *
   * Only modules the tool actually installed appear here (see `managed`). The scaffold
   * template puts `web` in `installed[]` and never gives it a lock entry, and reporting
   * that on every add would be noise no user can act on.
   */
  missingLockEntries: string[];
}

export interface DetectConflictsArgs {
  /** The resolved `dependsOn` graph for this run — descriptors included. */
  graph: Graph;
  config: SaasaloyConfig;
  lock: Lockfile;
  /**
   * Modules the tool has recorded in `.saasaloy/manifest.json` (`managedModules`). Only
   * these can be reported as missing a lock entry: a name in `installed[]` the tool never
   * applied has no descriptor to declare a conflict, and "re-add it" is advice that
   * cannot be followed for the template's own `web`. Omit it to check every installed
   * name — `add` always passes it.
   */
  managed?: ReadonlySet<string>;
}

// Order-independent key, so a pair both sides declare is reported once. The separator is
// written as the two-character escape, never a raw NUL byte, or git treats this file as
// binary and it stops being reviewable.
function pairKey(a: string, b: string): string {
  return a < b ? `${a}\0${b}` : `${b}\0${a}`;
}

export function detectConflicts(args: DetectConflictsArgs): ConflictReport {
  const { graph, config, lock, managed } = args;
  const installed = new Set(config.installed);
  const conflicts: ModuleConflict[] = [];
  const seen = new Set<string>();

  function record(declaredBy: string, conflictsWith: string): void {
    // A module naming itself is a typo, not a self-conflict — ignore it.
    if (declaredBy === conflictsWith) {
      return;
    }
    const key = pairKey(declaredBy, conflictsWith);
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const installedSide = installed.has(conflictsWith)
      ? conflictsWith
      : installed.has(declaredBy)
        ? declaredBy
        : undefined;
    conflicts.push({
      declaredBy,
      conflictsWith,
      ...(installedSide ? { installed: installedSide } : {}),
    });
  }

  // Forward. A fresh descriptor names something already installed, or something else in
  // this same graph — two mutually exclusive modules pulled in by one `add`.
  for (const [name, mod] of graph.modules) {
    for (const other of mod.item.conflictsWith ?? []) {
      if (installed.has(other) || graph.modules.has(other)) {
        record(name, other);
      }
    }
  }

  // Reverse. An installed module's lock entry names something arriving in this run.
  // Installed modules whose descriptor is in the graph are skipped: the forward pass just
  // read that descriptor, and a fresh descriptor beats a recorded copy of one.
  const missingLockEntries: string[] = [];
  for (const name of config.installed) {
    if (graph.modules.has(name)) {
      continue;
    }
    const entry = lock.modules[name];
    if (!entry) {
      // Silent for anything the tool never installed — the scaffold's `web`, or a hand
      // edit. There is no descriptor behind it, so there is no conflict to miss.
      if (!managed || managed.has(name)) {
        missingLockEntries.push(name);
      }
      continue;
    }
    for (const other of entry.conflictsWith ?? []) {
      if (graph.modules.has(other)) {
        record(name, other);
      }
    }
  }

  return { conflicts, missingLockEntries };
}

// One conflict as a sentence: both module names, which side declared it, and the way out.
// `requested` is what the user typed, so a conflict raised by a transitive prerequisite
// says so rather than naming a module the user never mentioned.
function describe(conflict: ModuleConflict, requested: string): string {
  const { declaredBy, conflictsWith, installed } = conflict;

  if (!installed) {
    const first =
      declaredBy === requested
        ? declaredBy
        : `${declaredBy} (required by ${requested})`;
    return `${first} declares a conflict with ${conflictsWith}, and adding ${requested} installs both. Add only one of them.`;
  }

  const incoming = installed === declaredBy ? conflictsWith : declaredBy;
  const phrase =
    incoming === requested
      ? incoming
      : `${incoming} (required by ${requested})`;
  const sentence =
    installed === declaredBy
      ? `${installed} is already installed and declares a conflict with ${phrase}`
      : `${phrase} declares a conflict with ${installed}, which is already installed`;
  return `${sentence}. Run \`saasaloy remove ${installed}\` first.`;
}

/** The refusal `add` prints. One line per conflicting pair, under a heading. */
export function formatConflicts(
  conflicts: ModuleConflict[],
  requested: string
): string {
  const heading = `Cannot add ${requested} — module conflict${conflicts.length > 1 ? "s" : ""}:`;
  return [heading, ...conflicts.map((c) => `  ${describe(c, requested)}`)].join(
    "\n"
  );
}
