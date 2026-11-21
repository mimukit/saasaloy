import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { cancel, intro, isCancel, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { apply } from "../engine/apply.js";
import type { ApplyReport } from "../engine/apply.js";
import { ensureCachedSnapshot } from "../engine/payload.js";
import {
  assertReadyToRun,
  isLocalRegistry,
  loadSide,
  readProjectState,
} from "../engine/project.js";
import type { LoadedSide, ProjectState } from "../engine/project.js";
import { closure, fixedOrder } from "../engine/render.js";
import {
  detectCliMismatches,
  formatCliMismatches,
} from "../lib/cli-requires.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  EXIT_WORK_PENDING,
  RefusalError,
} from "../lib/exit.js";
import { pathExists, resolveWithinRoot } from "../lib/fs-utils.js";
import { createOutput, printJson } from "../lib/json-output.js";
import type { Output } from "../lib/json-output.js";
import { multiselect, select } from "../lib/prompts.js";
import { findProjectRoot } from "../lib/project.js";
import {
  DEFAULT_OWNER,
  DEFAULT_REPO,
  DEFAULT_SOURCE,
  parseCoordinate,
  REGISTRY_ENV,
  releaseTag,
  RemoteRegistrySource,
} from "../lib/registry.js";
import type { Coordinate } from "../lib/registry.js";
import { listLabel } from "../lib/requested.js";
import { isInteractive, wrapForNote } from "../lib/tui.js";
import { uiBlockFiles } from "../lib/ui-blocks.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import {
  abortRun,
  assertSameRelease,
  confirmApply,
  graphOf,
  NO_TERMINAL_TO_CONFIRM,
  printDiffs,
  printReportLines,
  printSteps,
  shownResults,
  sideSpec,
  summarize,
  unmetRequirements,
} from "./apply-run.js";
import type { Unmet } from "./apply-run.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy add <module>...`: one apply from the lock's `requested` list to that list plus
// the named modules (plan 0116). The run renders both sets at the project's release,
// shows the plan, asks once, and writes. `--dry-run` and `--diff` preview and write
// nothing; `--dry-run --json` prints the plan as one document on stdout and nothing else
// (#223). Several names resolve into one set and print one plan (#233).
//
// The clean-tree rule (plan 0116, "Commands and safety"): `add` refuses only when the run
// must merge or delete a file with uncommitted changes. A write of a new file needs no
// clean tree. `--force` overrides it.

const USAGE =
  "saasaloy add [<module>...|<owner/repo[@ref]/module>...|<owner/repo>] [--with <module>]... [--dry-run [--json]] [--diff] [--yes] [--force] | saasaloy add --abort";
const HELP: CommandHelp = {
  name: "add",
  describe: DESCRIPTIONS.add,
  usage: USAGE,
  flags: {
    "--dry-run": "show the plan and write nothing",
    "--diff": "show a per-file diff and write nothing",
    "-y, --yes": "skip the confirmation prompt",
    "--force":
      "write even over uncommitted changes, overwrite edited generated files, and write the deleted files of a named module again",
    "--with <module>":
      "answer a `requiresOneOf` choice, e.g. `--with database-postgres` (repeatable)",
    "--json": "with --dry-run, print the plan as one JSON document on stdout",
    "--abort":
      "put back the files the last add, remove, update or testing run changed",
  },
};

/**
 * The `schemaVersion` of every document `add --json` prints. 2 since `requested` became a
 * list (#233), 3 since the render engine: `files[].action` is a result kind, each file
 * names its class, and `patches` is gone (plan 0116).
 */
export const ADD_JSON_SCHEMA_VERSION = 3;

export interface AddOptions {
  /** Every positional, in argv order and unparsed: a module name or a coordinate. */
  names: string[];
  dryRun: boolean;
  diff: boolean;
  yes: boolean;
  force: boolean;
  abort: boolean;
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
  "--abort",
  "--help",
  "-h",
]);

/**
 * Split `add`'s argv into options. Exported for its own tests: the rejection rule here
 * (an unknown flag) is the difference between `--forse` doing nothing and `--forse` being
 * reported. Every positional is a name (#233); `parseModuleRequest` parses them.
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
    abort: argv.includes("--abort"),
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
 * goes through `parseCoordinate`, so a malformed one refuses. Two coordinates naming
 * different owners, repos or refs refuse and say which two, because one run resolves one
 * set from one source. `owner/repo` with no module asks for the picker, which only makes
 * sense alone. A repeated name is dropped without a message.
 */
export function parseModuleRequest(inputs: readonly string[]): ModuleRequest {
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
      `"${bare}" names a registry and no module, and it cannot be mixed with other names — usage: \`${USAGE}\`.`
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
  // A coordinate that spells the source out keeps it, so the override warning still
  // fires for `acme/kit/widget waitlist`.
  const spelled = coords.find((coord) => coord.owner) ?? first;
  return { names, source: { ...spelled, module: names[0] } };
}

/** The plan as `add --dry-run --json` prints it. */
export function planDocument(args: {
  requested: readonly string[];
  prerequisites: readonly string[];
  install: readonly string[];
  alreadyInstalled: readonly string[];
  report: ApplyReport | undefined;
}): Record<string, unknown> {
  const { report } = args;
  return {
    alreadyInstalled: [...args.alreadyInstalled],
    files: (report === undefined ? [] : shownResults(report)).map((result) => ({
      action: result.kind,
      class: result.class,
      module: result.module,
      target: result.path,
    })),
    install: [...args.install],
    onceChanged: report?.onceChanged ?? [],
    pendingMerges: report?.pendingMerges ?? [],
    prerequisites: [...args.prerequisites],
    requested: [...args.requested],
    warnings: report?.warnings ?? [],
  };
}

export async function runAdd(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }
  const out = createOutput(opts.json, ADD_JSON_SCHEMA_VERSION);
  const { tui } = out;
  intro(pc.bgCyan(pc.black(" saasaloy add ")), tui);
  if (opts.unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  if (opts.json && (!opts.dryRun || opts.diff)) {
    return out.refuse(
      "`--json` prints the `--dry-run` plan — pass `--dry-run --json`, without `--diff`.",
      EXIT_REFUSED
    );
  }
  try {
    const root = await findProjectRoot();
    if (opts.abort) {
      return await abortRun(root, tui);
    }
    return await addModules(root, opts, out);
  } catch (error) {
    return out.fail(error);
  }
}

async function listModuleDirs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names: string[] = [];
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      (await pathExists(join(dir, entry.name, "registry-item.json")))
    ) {
      names.push(entry.name);
    }
  }
  return names.toSorted();
}

/** The modules the picker offers: the default registry at the project's release. */
async function listOffered(
  cliVersion: string,
  state: ProjectState
): Promise<string[]> {
  if (isLocalRegistry()) {
    return listModuleDirs(resolve(process.env[REGISTRY_ENV] ?? ""));
  }
  const { snapshot } = await ensureCachedSnapshot({
    ref: releaseTag(state.version ?? cliVersion),
    source: DEFAULT_SOURCE,
  });
  return listModuleDirs(snapshot.modulesDir);
}

/**
 * The box after a write: the skills the run added, the wire-up a ui block needs, and the
 * environment keys the new modules declare. There is no `nextSteps` field on the
 * descriptor: the skill is the one source of a module's procedure, and this box points at
 * it rather than paraphrasing it.
 */
function printNextSteps(
  report: ApplyReport,
  next: LoadedSide,
  install: readonly string[],
  aliases: Record<string, string>,
  tui: Output["tui"]
): void {
  const written = report.results.filter((result) => result.kind === "new");
  const skillOf = new Map<string, string>();
  for (const result of written) {
    const match = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/.exec(result.path);
    if (match?.[1] !== undefined) {
      skillOf.set(result.module, match[1]);
    }
  }
  const lines: string[] = [];
  const blocks = uiBlockFiles(
    written.map((result) => ({ module: result.module, target: result.path })),
    aliases
  );
  for (const module of new Set(blocks.map((block) => block.module))) {
    const targets = blocks
      .filter((block) => block.module === module)
      .map((block) => pc.cyan(block.target))
      .join(", ");
    const skill = skillOf.get(module);
    lines.push(
      skill === undefined
        ? `${targets} ${pc.dim(`(${module})`)} is on disk but on no page yet. Import the block where you want it.`
        : `Manual wire-up needed — ${targets} is on disk but on no page yet. In your AI coding tool, run ${pc.cyan(`/${skill}`)} and follow its Wire-up section.`
    );
  }
  const skills = [...new Set(skillOf.values())].toSorted();
  if (skills.length > 0) {
    lines.push(
      `Read the module's own procedure — in your AI coding tool, run ${skills
        .map((name) => pc.cyan(`/${name}`))
        .join(" or ")}.`
    );
  }
  const keys = [
    ...new Set(
      install.flatMap((name) =>
        Object.keys(next.side.payload.modules.get(name)?.item.envVars ?? {})
      )
    ),
  ].toSorted();
  if (keys.length > 0) {
    lines.push(
      `Set ${keys.map((key) => pc.cyan(key)).join(", ")}.`,
      `Run ${pc.cyan("saasaloy env")} — it prompts for each unset one and writes it to ${pc.cyan("packages/env/.env")}.`,
      `Then run ${pc.cyan("pnpm env:setup")} to write each service's own ${pc.cyan(".env")} from it.`
    );
  }
  if (lines.length > 0) {
    note(wrapForNote(lines.join("\n\n")), "Next steps", tui);
  }
}

async function addModules(
  root: string,
  opts: AddOptions,
  out: Output
): Promise<number> {
  const { tui } = out;
  const cliVersion = await readVersion();
  const request = parseModuleRequest(opts.names);
  const coord = request.source;
  let { names } = request;
  await assertReadyToRun(root);
  const state = await readProjectState(root);
  assertSameRelease(state, cliVersion, "add");

  // Where the named modules come from: the default registry at the project's release, a
  // third-party registry at a commit, or a local checkout.
  const coordinates = new Map(state.coordinates);
  const thirdParty =
    coord.owner !== undefined &&
    `${coord.owner}/${coord.repo ?? ""}` !== DEFAULT_SOURCE;
  if (isLocalRegistry()) {
    if (coord.owner !== undefined || coord.repo !== undefined) {
      log.warn(
        `Ignoring source "${coord.owner ?? ""}/${coord.repo ?? ""}" — ${REGISTRY_ENV} override is set.`,
        tui
      );
    }
  } else if (thirdParty) {
    const remote = new RemoteRegistrySource(
      coord.owner ?? "",
      coord.repo ?? "",
      coord.ref
    );
    await remote.resolveSha();
    const provenance = remote.provenance();
    for (const name of names) {
      coordinates.set(name, provenance);
    }
  } else if (coord.ref !== undefined) {
    throw new RefusalError(
      `The default registry moves as one release, so \`@${coord.ref}\` cannot pin one module. Run \`saasaloy update\` to move every module to this CLI's release.`
    );
  }

  const installed = new Set(state.installed);
  if (names.length === 0) {
    if (!isInteractive() || opts.json) {
      return out.refuse(
        `No module named and no terminal to pick one in — usage: \`${USAGE}\`.`,
        EXIT_REFUSED
      );
    }
    const available = (await listOffered(cliVersion, state)).filter(
      (name) => !installed.has(name)
    );
    if (available.length === 0) {
      note("Every module is already installed.", "Nothing to add", tui);
      outro(pc.dim("nothing to do"), tui);
      return EXIT_OK;
    }
    const picked = await multiselect({
      answeredBy: "one or more module names",
      message: `Pick modules to add ${pc.dim(`(${installed.size} already installed)`)}`,
      options: available.map((name) => ({ label: name, value: name })),
      required: true,
    });
    if (isCancel(picked)) {
      cancel("add cancelled", tui);
      return EXIT_FAILURE;
    }
    names = picked;
  }

  const forced = opts.force ? names.filter((name) => installed.has(name)) : [];
  const fresh = names.filter((name) => !installed.has(name));
  const withRefusal = (pending: readonly string[]): string =>
    `Cannot add ${listLabel(names)} — ${pending.map((name) => `--with ${name}`).join(", ")} answers no unmet requirement. ` +
    "`--with` picks one option of a `requiresOneOf` list; add any other module with its own `saasaloy add`.";
  if (fresh.length === 0 && forced.length === 0) {
    // Nothing to add leaves no requirement for `--with` to answer (#223).
    if (opts.with.length > 0) {
      return out.refuse(withRefusal(opts.with), EXIT_REFUSED);
    }
    if (opts.json) {
      printJson(
        planDocument({
          alreadyInstalled: names,
          install: [],
          prerequisites: [],
          report: undefined,
          requested: names,
        }),
        ADD_JSON_SCHEMA_VERSION
      );
    }
    note(
      `${listLabel(names.map((name) => pc.cyan(name)))} ${names.length === 1 ? "is" : "are"} already installed.`,
      "Nothing to do",
      tui
    );
    outro(
      pc.dim("use --force to write a named module's deleted files again"),
      tui
    );
    return EXIT_OK;
  }

  const cannotConfirm =
    !opts.yes && !opts.dryRun && !opts.diff && !process.stdin.isTTY;
  const version = state.version ?? cliVersion;
  const requested = [...new Set([...state.requested, ...fresh])];
  const load = (list: readonly string[]): Promise<LoadedSide> =>
    loadSide(sideSpec(state, list, version, coordinates), { cliVersion });

  // `requiresOneOf`: `--with` answers a choice up front, a terminal gets one prompt per
  // unmet choice, and anything else refuses and names the options.
  let next = await load([...requested, ...opts.with]);
  let unmet = unmetRequirements(next.side.payload, requested);
  const pending = new Set(opts.with);
  for (let progressed = true; pending.size > 0 && progressed;) {
    progressed = false;
    for (const name of pending) {
      if (!unmet.some((requirement) => requirement.options.includes(name))) {
        continue;
      }
      requested.push(name);
      pending.delete(name);
      unmet = unmetRequirements(next.side.payload, requested);
      progressed = true;
    }
  }
  if (pending.size > 0) {
    return out.refuse(withRefusal([...pending]), EXIT_REFUSED);
  }
  const unmetMessage = (list: Unmet[]): string =>
    [
      `Cannot add ${listLabel(names)} — unmet requirement${list.length > 1 ? "s" : ""}:`,
      ...list.map(
        (requirement) =>
          `  ${requirement.declaredBy} needs one of: ${requirement.options.join(", ")}, and none is installed. Re-run as \`saasaloy add ${names.join(" ")} --with ${requirement.options[0] ?? ""}\`, or pick another from that list.`
      ),
    ].join("\n");
  if (unmet.length > 0 && (!isInteractive() || opts.yes || opts.json)) {
    return out.refuse(unmetMessage(unmet), EXIT_REFUSED);
  }
  for (let round = 0; unmet.length > 0 && round < 8; round++) {
    const requirement = unmet[0];
    if (requirement === undefined) {
      break;
    }
    const picked = await select({
      answeredBy: `\`--with <${requirement.options.join(" | ")}>\``,
      message: `${pc.cyan(requirement.declaredBy)} needs one of these — pick one`,
      options: requirement.options.map((name) => ({
        label: name,
        value: name,
      })),
    });
    if (isCancel(picked)) {
      cancel("add cancelled", tui);
      return EXIT_FAILURE;
    }
    requested.push(picked);
    next = await load(requested);
    unmet = unmetRequirements(next.side.payload, requested);
  }
  if (unmet.length > 0) {
    return out.refuse(unmetMessage(unmet), EXIT_REFUSED);
  }
  if (cannotConfirm) {
    return out.refuse(NO_TERMINAL_TO_CONFIRM, EXIT_REFUSED);
  }
  next = await load(requested);

  const nextSet = closure(next.side.payload, requested);
  const mismatches = detectCliMismatches({
    cliVersion,
    graph: graphOf(next.side.payload, nextSet),
  });
  if (mismatches.length > 0) {
    return out.refuse(
      formatCliMismatches(mismatches, names.join(" "), cliVersion),
      EXIT_REFUSED
    );
  }
  const install = fixedOrder(next.side.payload.modules, nextSet).filter(
    (name) => !installed.has(name)
  );
  const prerequisites = install.filter((name) => !names.includes(name));
  const alreadyInstalled = names.filter(
    (name) => installed.has(name) && !forced.includes(name)
  );

  // `--force` on an installed module writes its tracked files the project deleted again.
  const restore: string[] = [];
  for (const [path, record] of Object.entries(state.manifest.files)) {
    if (
      forced.includes(record.module) &&
      !(await pathExists(resolveWithinRoot(root, path)))
    ) {
      restore.push(path);
    }
  }
  const previous = await load(state.requested);
  const run = (dryRun: boolean): Promise<ApplyReport> =>
    apply({
      cleanTree: dryRun ? "none" : "touched",
      dryRun,
      force: opts.force,
      next: next.side,
      previous: previous.side,
      provenance: next.provenance,
      restore,
      root,
      version: cliVersion,
    });

  const preview = await run(true);
  summarize(preview, "Plan", tui);
  if (opts.diff) {
    printDiffs(preview, tui);
  }
  if (opts.dryRun || opts.diff) {
    printReportLines(preview, tui);
    if (opts.json) {
      printJson(
        planDocument({
          alreadyInstalled,
          install,
          prerequisites,
          report: preview,
          requested: names,
        }),
        ADD_JSON_SCHEMA_VERSION
      );
    }
    outro(
      pc.dim(
        opts.diff ? "diff only — nothing applied" : "dry run — nothing applied"
      ),
      tui
    );
    return EXIT_OK;
  }
  const declined = await confirmApply(opts.yes, "add", tui);
  if (declined !== undefined) {
    return declined;
  }
  const report = await run(false);
  printSteps(report, tui);
  printReportLines(report, tui);
  printNextSteps(report, next, install, state.config.aliases, tui);
  if (report.changed.includes("package.json")) {
    log.info(
      `Run ${pc.cyan("pnpm install")} to fetch the new dependencies.`,
      tui
    );
  }
  const applied = install.length > 0 ? install : names;
  outro(
    report.exitCode === EXIT_WORK_PENDING
      ? pc.yellow(
          `Applied ${applied.join(", ")} with conflict markers — resolve them, then run \`pnpm check\`.`
        )
      : pc.green(
          `Applied ${applied.map((name) => pc.bold(name)).join(", ")} ${pc.dim(`(${report.changed.length} files)`)}`
        ),
    tui
  );
  return report.exitCode;
}
