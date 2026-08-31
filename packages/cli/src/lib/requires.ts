import type { Graph } from "./resolve.js";
import type { SaasaloyConfig } from "./schema.js";

// `requiresOneOf` enforcement for `saasaloy add` — the deterministic core, kept out of
// commands/add.ts so it can be unit-tested, mirroring conflicts.ts.
//
// `dependsOn` says "install this too". `conflictsWith` says "refuse this beside me".
// Neither can say "pick one of these", which is what a capability split across mutually
// exclusive drivers needs: `database` scaffolds `packages/db` and declares the `./client`
// export, but the file behind that export ships in `database-d1` or `database-postgres`.
// Installing the core alone leaves a project whose `@repo/db/client` import resolves to
// nothing, and nothing said so at `add` time (#98, ADR 0026's amendment).
//
// So the descriptor gains `requiresOneOf`: a list of modules, exactly one of which has to
// be present. "Present" means installed already, or arriving in this same resolved graph —
// a driver pulled in by `auth`'s `dependsOn` satisfies the core's requirement without the
// user naming it.
//
// The check reports; it never resolves. `add` refuses, or offers the list as a prompt on
// an interactive terminal.

export interface MissingRequirement {
  /** The module whose descriptor declared `requiresOneOf`. */
  declaredBy: string;
  /** The candidates, exactly one of which has to be installed. Descriptor order. */
  options: string[];
}

export interface DetectMissingRequirementsArgs {
  /** The resolved `dependsOn` graph for this run — descriptors included. */
  graph: Graph;
  config: SaasaloyConfig;
}

/**
 * Every module in the graph whose `requiresOneOf` list nothing satisfies, in topological
 * order. Empty means the run may proceed.
 */
export function detectMissingRequirements(
  args: DetectMissingRequirementsArgs
): MissingRequirement[] {
  const { graph, config } = args;
  const installed = new Set(config.installed);
  const missing: MissingRequirement[] = [];

  // `graph.order` rather than `graph.modules`, so a prerequisite is reported before the
  // module that dragged it in — the order the user would install them in.
  for (const name of graph.order) {
    const options = graph.modules.get(name)?.item.requiresOneOf ?? [];
    // An empty list is "no requirement", not "nothing can satisfy me". An author who
    // writes `"requiresOneOf": []` gets a no-op rather than a module nobody can add.
    if (options.length === 0) {
      continue;
    }
    const satisfied = options.some(
      (option) => graph.modules.has(option) || installed.has(option)
    );
    if (!satisfied) {
      missing.push({ declaredBy: name, options: [...options] });
    }
  }

  return missing;
}

// One unmet requirement as a sentence. `requested` is what the user typed, so a
// requirement raised by a transitive prerequisite says so rather than naming a module the
// user never mentioned — same shape as conflicts.ts's `describe`.
function describe(missing: MissingRequirement, requested: string): string {
  const { declaredBy, options } = missing;
  const subject =
    declaredBy === requested
      ? declaredBy
      : `${declaredBy} (required by ${requested})`;
  const first = options[0];
  const suggestion = first
    ? ` Run \`saasaloy add ${first}\` first, or pick another from that list.`
    : "";
  return `${subject} needs one of: ${options.join(", ")}, and none is installed.${suggestion}`;
}

/** The refusal `add` prints. One line per unmet requirement, under a heading. */
export function formatMissingRequirements(
  missing: MissingRequirement[],
  requested: string
): string {
  const heading = `Cannot add ${requested} — unmet requirement${missing.length > 1 ? "s" : ""}:`;
  return [heading, ...missing.map((m) => `  ${describe(m, requested)}`)].join(
    "\n"
  );
}
