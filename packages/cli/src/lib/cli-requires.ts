import { isValidRange, satisfies } from "./semver.js";
import type { Graph } from "./resolve.js";

// `requires.saasaloy` enforcement — "this descriptor needs a CLI at least this new".
//
// A descriptor sets `additionalProperties: false`, so an old CLI meeting a field it has
// never heard of already fails. It fails as an Ajv dump about an unexpected property,
// which tells the user nothing about what to do, and a field whose *meaning* changed
// fails not at all: the old CLI reads it the old way and half-applies the module. One
// declared range turns both cases into the same sentence, before anything is written.
//
// Kept apart from `requires.ts`, which enforces `requiresOneOf` — a module-choice rule
// with nothing to do with the CLI's version. Two unrelated meanings of "requires" in one
// file would be a permanent reading tax.
//
// The check is fatal, never a warning. A module that says it needs a newer CLI is saying
// the applier in front of it will get the module wrong, and a warning would leave the
// project half-written with no way back.

/** How a consumer gets a newer CLI. Named in every refusal so the fix is in the message. */
export const UPGRADE_COMMAND = "pnpm add --global saasaloy@latest";

/** What `readVersion()` returns when the CLI's own package.json will not parse. */
export const UNKNOWN_VERSION = "unknown";

/** Why one module's `requires` could not be satisfied. */
export type MismatchReason =
  /** The range parsed and the running CLI falls outside it. */
  | "unsatisfied"
  /** The range is not a range — an author error, reported rather than assumed to pass. */
  | "unparseable"
  /** The CLI cannot read its own version, so no range can be honestly evaluated. */
  | "unknown-version";

export interface CliMismatch {
  /** The module whose descriptor declared the range. May be a transitive prerequisite. */
  declaredBy: string;
  /** The range exactly as the descriptor spells it. */
  range: string;
  reason: MismatchReason;
}

export interface DetectCliMismatchesArgs {
  /** The resolved `dependsOn` graph for this run — every descriptor it touched. */
  graph: Graph;
  /** The running CLI's version, from `readVersion()`. */
  cliVersion: string;
}

/**
 * Every module in the graph whose `requires.saasaloy` the running CLI fails, in
 * topological order so a prerequisite is reported before the module that dragged it in.
 * Empty means the run may proceed.
 *
 * Transitive by construction: the graph holds every descriptor resolution touched, not
 * only the one the user named, so a prerequisite's range is enforced exactly like the
 * requested module's.
 */
export function detectCliMismatches(
  args: DetectCliMismatchesArgs
): CliMismatch[] {
  const { graph, cliVersion } = args;
  const mismatches: CliMismatch[] = [];

  for (const name of graph.order) {
    const range = graph.modules.get(name)?.item.requires?.saasaloy;
    // The field is optional, and its absence means "any CLI" — every descriptor written
    // before the field existed keeps working, on every version.
    if (range === undefined) {
      continue;
    }
    if (!isValidRange(range)) {
      mismatches.push({ declaredBy: name, range, reason: "unparseable" });
      continue;
    }
    // An unreadable version refuses rather than passing silently: "I could not check"
    // is not "you are fine", and the failure mode of guessing is a half-applied module.
    if (cliVersion === UNKNOWN_VERSION) {
      mismatches.push({ declaredBy: name, range, reason: "unknown-version" });
      continue;
    }
    if (!satisfies(cliVersion, range)) {
      mismatches.push({ declaredBy: name, range, reason: "unsatisfied" });
    }
  }

  return mismatches;
}

// One mismatch as a sentence. `requested` is what the user typed, so a range raised by a
// transitive prerequisite says so rather than naming a module the user never mentioned —
// the same shape `requires.ts` and `conflicts.ts` use.
function describe(
  mismatch: CliMismatch,
  requested: string,
  cliVersion: string
): string {
  const { declaredBy, range, reason } = mismatch;
  const subject =
    declaredBy === requested
      ? declaredBy
      : `${declaredBy} (required by ${requested})`;
  if (reason === "unparseable") {
    return `${subject} declares requires.saasaloy "${range}", which isn't a semver range — the module's author has to fix it.`;
  }
  if (reason === "unknown-version") {
    return `${subject} needs saasaloy ${range}, and this CLI's own version could not be read. Upgrade with \`${UPGRADE_COMMAND}\`.`;
  }
  return `${subject} needs saasaloy ${range}, and ${cliVersion} is installed. Upgrade with \`${UPGRADE_COMMAND}\`.`;
}

/** The refusal a command prints. One line per mismatch, under a heading. */
export function formatCliMismatches(
  mismatches: CliMismatch[],
  requested: string,
  cliVersion: string
): string {
  const heading = `Cannot apply ${requested} — this CLI is too old for ${mismatches.length > 1 ? "these modules" : "it"}:`;
  return [
    heading,
    ...mismatches.map((m) => `  ${describe(m, requested, cliVersion)}`),
    `Nothing was written.`,
  ].join("\n");
}
