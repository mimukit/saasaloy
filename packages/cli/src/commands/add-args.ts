import { RefusalError } from "../lib/exit.js";
import {
  DEFAULT_OWNER,
  DEFAULT_REPO,
  parseCoordinate,
} from "../lib/registry.js";
import type { Coordinate } from "../lib/registry.js";

// `add`'s argument parsing, shared by the old engine (`add.ts`) and the render engine
// (`next.ts`) while both exist in the #365 branch. Phase 6 folds it back into `add.ts`.

/**
 * The `schemaVersion` of every document `add --json` prints. 2 since `requested` became
 * a list (#233); the other commands are still at `JSON_SCHEMA_VERSION`.
 */
export const ADD_JSON_SCHEMA_VERSION = 2;

export interface AddOptions {
  /** Every positional, in argv order and unparsed: a module name or a coordinate. */
  names: string[];
  dryRun: boolean;
  diff: boolean;
  yes: boolean;
  force: boolean;
  /** `--json` with `--dry-run`: the plan as one JSON document on stdout. */
  json: boolean;
  /**
   * `--with <module>`, repeatable: a module that answers a `requiresOneOf` choice, so a
   * run with no terminal can pick a driver (#223). Command-line order.
   */
  with: string[];
  /** Flags we don't know — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set([
  "--dry-run",
  "--diff",
  "--yes",
  "-y",
  "--force",
  "--json",
  "--help",
  "-h",
]);
/**
 * Split `add`'s argv into options. Exported for its own tests: the rejection rule here
 * (an unknown flag) is the difference between `--forse` doing nothing and `--forse` being
 * reported, and it is worth pinning without driving a whole apply to reach it. Every
 * positional is a name (#233); `requestedModules` parses and checks them.
 */
export function parseArgs(argv: string[]): AddOptions {
  const positional: string[] = [];
  const unknown: string[] = [];
  const withModules: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--with") {
      // A value flag: the next argument is the module, never a positional. A missing or
      // flag-shaped value is reported, so `--with --yes` cannot eat the `--yes`.
      const value = argv[i + 1];
      if (value === undefined || value === "" || value.startsWith("-")) {
        unknown.push("--with (needs a module name)");
      } else {
        withModules.push(value);
        i++;
      }
    } else if (arg.startsWith("--with=")) {
      const value = arg.slice("--with=".length);
      if (value === "") {
        unknown.push("--with (needs a module name)");
      } else {
        withModules.push(value);
      }
    } else if (!arg.startsWith("-")) {
      positional.push(arg);
    } else if (!KNOWN_FLAGS.has(arg)) {
      // A typo'd flag (`--forse`) silently running without force is worse than an error.
      unknown.push(arg);
    }
  }
  return {
    diff: argv.includes("--diff"),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    json: argv.includes("--json"),
    names: positional,
    unknown,
    with: withModules,
    yes: argv.includes("--yes") || argv.includes("-y"),
  };
}
// The registry a coordinate reads from, as a message names it: a bare name and
// `mimukit/saasaloy/<name>` are the same source.
function sourceLabel(coord: Coordinate): string {
  const slug = `${coord.owner ?? DEFAULT_OWNER}/${coord.repo ?? DEFAULT_REPO}`;
  return coord.ref ? `${slug}@${coord.ref}` : slug;
}

/** The positionals of one `add` run, parsed: one source, and the modules to add. */
export interface ModuleRequest {
  /** The registry every name resolves from, with the first name as `module`. */
  source: Coordinate;
  /** The named modules, in argv order, de-duplicated. Empty means "show a picker". */
  names: string[];
}

/**
 * Parse every positional and check that the set reads from one registry (#233). Each
 * goes through `parseCoordinate`, so a malformed one refuses as it always did. Two
 * coordinates naming different owners, repos or refs refuse and say which two, because
 * one run resolves one graph from one source. `owner/repo` with no module asks for the
 * picker, which only makes sense alone, so mixed with other positionals it refuses with
 * the usage line. A repeated name is dropped without a message.
 */
export function parseModuleRequest(
  inputs: readonly string[],
  usage: string
): ModuleRequest {
  const coords = inputs.map((input) => parseCoordinate(input));
  const [first] = coords;
  if (!first) {
    return { names: [], source: {} };
  }
  if (coords.length === 1) {
    return { names: first.module ? [first.module] : [], source: first };
  }
  const bare = inputs.find((_, i) => !coords[i]?.module);
  if (bare !== undefined) {
    throw new RefusalError(
      `"${bare}" names a registry and no module, and it cannot be mixed with other names — usage: \`${usage}\`.`
    );
  }
  const firstLabel = sourceLabel(first);
  const other = coords.findIndex((coord) => sourceLabel(coord) !== firstLabel);
  const otherCoord = coords[other];
  if (otherCoord) {
    throw new RefusalError(
      `Cannot add modules from two sources in one run — "${inputs[0]}" reads ${firstLabel} and ` +
        `"${inputs[other]}" reads ${sourceLabel(otherCoord)}. Add them in separate runs.`
    );
  }
  const names = [
    ...new Set(coords.map((coord) => coord.module ?? "").filter(Boolean)),
  ];
  // A coordinate that spells the source out keeps it, so the override warning below
  // still fires for `acme/kit/widget waitlist`.
  const spelled = coords.find((coord) => coord.owner) ?? first;
  return { names, source: { ...spelled, module: names[0] } };
}
