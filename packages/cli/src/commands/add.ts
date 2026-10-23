import { cancel, intro, isCancel, log, note, outro } from "@clack/prompts";
import { posix } from "node:path";
import pc from "picocolors";
import { buildPlan, executePlan } from "../lib/applier.js";
import type {
  ApplyResult,
  FileAction,
  Plan,
  PlannedFile,
} from "../lib/applier.js";
import {
  detectCliMismatches,
  formatCliMismatches,
} from "../lib/cli-requires.js";
import { describeStaleOwner } from "../lib/collisions.js";
import { detectConflicts, formatConflicts } from "../lib/conflicts.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  formatFailure,
} from "../lib/exit.js";
import { planWritesUi } from "../lib/design.js";
import { createOutput, printJson } from "../lib/json-output.js";
import type { TuiOptions } from "../lib/json-output.js";
import { ENV_EXAMPLE, writeEnvExample } from "../lib/env-example.js";
import { formatPatchedFiles } from "../lib/format.js";
import { lineDiff } from "../lib/diff.js";
import type { DiffLine } from "../lib/diff.js";
import { runBackfill } from "../lib/backfill.js";
import { persistLedger } from "../lib/ledger.js";
import { loadLock, LOCK_FILE, upsertLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { loadManifest } from "../lib/manifest.js";
import type { Manifest } from "../lib/manifest.js";
import { planDeps, readRootPackageJson, writeDeps } from "../lib/pkg-json.js";
import { confirm, select } from "../lib/prompts.js";
import { findProjectRoot } from "../lib/project.js";
import {
  createRegistrySource,
  DEFAULT_OWNER,
  DEFAULT_REPO,
  parseCoordinate,
  REGISTRY_ENV,
} from "../lib/registry.js";
import type { Coordinate, RegistrySource } from "../lib/registry.js";
import {
  detectMissingRequirements,
  formatMissingRequirements,
  formatUnansweredWith,
} from "../lib/requires.js";
import { mergeGraph, resolveGraph } from "../lib/resolve.js";
import type { Graph } from "../lib/resolve.js";
import { CONFIG_FILE, loadConfig } from "../lib/saasaloy-config.js";
import type { LoadedConfig } from "../lib/saasaloy-config.js";
import { readTestingMode } from "../lib/testing.js";
import type { TestingMode } from "../lib/testing.js";
import { isInteractive, wrapForNote } from "../lib/tui.js";
import { uiBlockFiles } from "../lib/ui-blocks.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { linkAgentSkills } from "../lib/skill-links.js";
import { readVersion } from "../version.js";
import { reportBackfill } from "./backfill-report.js";
import { DESCRIPTIONS } from "./descriptions.js";
import { reportBlockOutcome, setTestingMode } from "./testing.js";

// `saasaloy add <module>` — the local applier. Resolve the dependsOn graph, show the
// plan behind a confirmation prompt, then drop files into their convention-based
// targets, record them in .saasaloy/manifest.json with content hashes, and merge npm
// deps (build spec §2.4/§2.7/§2.9). `--dry-run`/`--diff` preview without mutating.
// `--dry-run --json` prints the plan as one document on stdout and nothing else (#223);
// `--json` without `--dry-run` refuses, because an apply has no plan document to print.

export interface AddOptions {
  name?: string;
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
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
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
const USAGE =
  "saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--with <module>]... [--dry-run [--json]] [--diff] [--yes] [--force]";
const HELP: CommandHelp = {
  name: "add",
  describe: DESCRIPTIONS.add,
  usage: USAGE,
  flags: {
    "--dry-run": "show the plan and write nothing",
    "--diff": "show a per-file diff and write nothing",
    "-y, --yes": "skip the confirmation prompt",
    "--force": "re-apply a module that is already installed",
    "--with <module>":
      "answer a `requiresOneOf` choice, e.g. `--with database-d1` (repeatable)",
    "--json": "with --dry-run, print the plan as one JSON document on stdout",
  },
};

/**
 * Split `add`'s argv into options. Exported for its own tests: the rejection rules here
 * (an unknown flag, a second positional) are the difference between `--forse` doing
 * nothing and `--forse` being reported, and they are worth pinning without driving a
 * whole apply to reach them.
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
  unknown.push(...positional.slice(1));
  return {
    diff: argv.includes("--diff"),
    dryRun: argv.includes("--dry-run"),
    force: argv.includes("--force"),
    json: argv.includes("--json"),
    name: positional[0],
    unknown,
    with: withModules,
    yes: argv.includes("--yes") || argv.includes("-y"),
  };
}

/**
 * Pin a coordinate to the SHA the lock recorded for it, so a re-install reproduces
 * identical bytes (ADR 0012). Three conditions hold it back, and each one means the user
 * asked for something else: `SAASALOY_REGISTRY_DIR` points at a working copy, an explicit
 * `@ref` names the ref to move to, or the entry was installed from a local checkout and
 * carries no SHA to pin to. Returns `coord` unchanged when none applies.
 *
 * A separate function from `runAdd` because reaching this branch through the command
 * means resolving a remote source, and the rule is worth testing on its own.
 */
export function pinToLock(coord: Coordinate, lock: Lockfile): Coordinate {
  if (process.env[REGISTRY_ENV] || !coord.module || coord.ref) {
    return coord;
  }
  const slug = `${coord.owner ?? DEFAULT_OWNER}/${coord.repo ?? DEFAULT_REPO}`;
  const pinned = lock.modules[coord.module];
  if (!pinned || pinned.source !== slug || pinned.resolved === "local") {
    return coord;
  }
  return { ...coord, ref: pinned.resolved };
}

const ACTION_LABEL: Record<FileAction, string> = {
  conflict: pc.yellow("conflict → merge"),
  create: pc.green("create"),
  drift: pc.yellow("drift → merge"),
  overwrite: pc.cyan("overwrite"),
  unchanged: pc.dim("unchanged"),
};

// Cap a single file's diff so a big generated file can't flood the terminal.
const MAX_DIFF_LINES = 60;

// How many `requiresOneOf` prompts one `add` may open. Each pick settles one requirement,
// so this is only reached by a chain of modules that each require the next.
const MAX_REQUIREMENT_PROMPTS = 8;

// Keyed by DiffLine["kind"], so adding a kind to lib/diff.ts is a type error here
// rather than a silently unstyled line.
const DIFF_LINE_STYLE: Record<DiffLine["kind"], (text: string) => string> = {
  add: (text) => pc.green(`+ ${text}`),
  context: (text) => pc.dim(`  ${text}`),
  del: (text) => pc.red(`- ${text}`),
};

function renderDiff(file: PlannedFile): string {
  const lines = lineDiff(file.oldContent ?? "", file.content);
  const shown = lines
    .slice(0, MAX_DIFF_LINES)
    .map((line) => DIFF_LINE_STYLE[line.kind](line.text));
  if (lines.length > MAX_DIFF_LINES) {
    shown.push(pc.dim(`  … ${lines.length - MAX_DIFF_LINES} more lines`));
  }
  return shown.join("\n");
}

/**
 * How the plan names one file. A target alone identifies it, until `onlyWith` lets two
 * descriptor entries share one target (#99) — then the plan has to say which variant it
 * picked, because that is the whole decision the user would want to check. An
 * unconditional file's line is unchanged, so the common plan reads as it always did.
 */
function fileLabel(file: PlannedFile): string {
  return file.onlyWith === undefined
    ? file.target
    : `${file.target} ${pc.dim(`(${file.from})`)}`;
}

function summarizePlan(
  plan: Plan,
  requested: string,
  prereqs: string[],
  tui: TuiOptions = {}
): void {
  if (prereqs.length > 0) {
    note(
      wrapForNote(
        `${pc.bold(requested)} requires: ${prereqs.map((p) => pc.cyan(p)).join(", ")}`
      ),
      "Dependencies",
      tui
    );
  }
  const willInstall = plan.install.map((m) => pc.cyan(m)).join(pc.dim(" → "));
  const lines = [`will install: ${willInstall}`];
  if (plan.alreadyInstalled.length > 0) {
    lines.push(
      pc.dim(`already installed (skipped): ${plan.alreadyInstalled.join(", ")}`)
    );
  }

  const writable = plan.files.filter(
    (f) => f.action !== "drift" && f.action !== "conflict"
  );
  const held = plan.files.filter(
    (f) => f.action === "drift" || f.action === "conflict"
  );
  lines.push("");
  for (const file of plan.files) {
    lines.push(`  ${ACTION_LABEL[file.action]}  ${fileLabel(file)}`);
  }
  lines.push(
    "",
    pc.dim(`${writable.length} file(s) to apply, ${held.length} needing merge`)
  );
  if (plan.dependencies.length > 0) {
    lines.push(pc.dim(`deps: ${plan.dependencies.join(", ")}`));
  }
  if (plan.devDependencies.length > 0) {
    lines.push(pc.dim(`devDeps: ${plan.devDependencies.join(", ")}`));
  }
  note(wrapForNote(lines.join("\n")), "Plan", tui);

  if (Object.keys(plan.envVars).length > 0) {
    const envLines = Object.entries(plan.envVars).map(
      ([k, v]) => `${pc.cyan(k)} ${pc.dim(`— ${v}`)}`
    );
    note(wrapForNote(envLines.join("\n")), "Env vars to set", tui);
  }
  if (Object.keys(plan.aliases).length > 0) {
    const aliasLines = Object.entries(plan.aliases).map(
      ([a, p]) => `${pc.cyan(a)} ${pc.dim(`→ ${p}`)}`
    );
    note(
      wrapForNote(
        `${aliasLines.join("\n")}\n\n${pc.dim("New workspace(s) — run `pnpm install` to link them.")}`
      ),
      "Aliases registered",
      tui
    );
  }
  for (const conflict of plan.aliasConflicts) {
    log.warn(
      `Alias redefinition: ${conflict} ${pc.dim("(scaffold overrides the existing alias)")}.`,
      tui
    );
  }
  // The sentence lives in collisions.ts beside the ownership refusal it mirrors, so the
  // two ownership messages cannot drift apart; the path is accented here the way every
  // other `add` warning accents one (#107).
  for (const stale of plan.staleOwners) {
    log.warn(
      describeStaleOwner({ ...stale, target: pc.cyan(stale.target) }),
      tui
    );
  }
  const newLinks = plan.links.filter((l) => l.action !== "conflict");
  if (newLinks.length > 0) {
    const linkLines = newLinks.map(
      (l) => `${pc.cyan(l.path)} ${pc.dim(`→ ${l.target}`)}`
    );
    note(
      wrapForNote(
        `${linkLines.join("\n")}\n\n${pc.dim("Symlinked for Claude Code — the skill files live in `.agents/skills/`.")}`
      ),
      "Skill links",
      tui
    );
  }
  for (const link of plan.links) {
    if (link.action === "conflict") {
      log.warn(
        `Skill link ${pc.cyan(link.path)} already exists and isn't ours — ` +
          `left untouched ${pc.dim("(remove it to let `add` link the skill)")}.`,
        tui
      );
    }
  }
  const applyPatches = plan.patches.filter((p) => p.action === "apply");
  if (applyPatches.length > 0) {
    const patchLines = applyPatches.map(
      (p) => `${pc.cyan(p.file)} ${pc.dim(`— ${p.patch.kind}`)}`
    );
    note(wrapForNote(patchLines.join("\n")), "Config patches", tui);
  }
  for (const p of plan.patches) {
    if (p.action === "missing") {
      log.warn(
        `Config patch target ${pc.cyan(p.file)} is missing — ${p.patch.kind} not applied ` +
          `${pc.dim(`(is ${p.module}'s prerequisite installed?)`)}.`,
        tui
      );
    }
  }
}

/**
 * The plan as `add --dry-run --json` prints it (#223): every file and every patch the
 * human plan lists, with the action each one takes, plus the dependencies, env vars,
 * aliases and skill links. `plan` is undefined when everything is already installed,
 * which prints the same keys, empty. Pure and exported so the shape is pinned without a
 * registry.
 */
export function planDocument(
  requested: string,
  prereqs: string[],
  plan: Plan | undefined,
  alreadyInstalled: string[] = plan?.alreadyInstalled ?? []
): Record<string, unknown> {
  return {
    requested,
    prerequisites: prereqs,
    install: plan?.install ?? [],
    alreadyInstalled,
    files: (plan?.files ?? []).map((file) => ({
      action: file.action,
      from: file.from,
      module: file.module,
      onlyWith: file.onlyWith ?? null,
      skill: file.isSkill,
      target: file.target,
    })),
    patches: (plan?.patches ?? []).map((patch) => ({
      action: patch.action,
      file: patch.file,
      kind: patch.patch.kind,
      module: patch.module,
    })),
    dependencies: plan?.dependencies ?? [],
    devDependencies: plan?.devDependencies ?? [],
    envVars: plan?.envVars ?? {},
    aliases: plan?.aliases ?? {},
    aliasConflicts: plan?.aliasConflicts ?? [],
    links: (plan?.links ?? []).map((link) => ({
      action: link.action,
      module: link.module,
      path: link.path,
      target: link.target,
    })),
    staleOwners: (plan?.staleOwners ?? []).map((stale) => ({
      claimant: stale.claimant,
      owner: stale.owner,
      target: stale.target,
    })),
    writesUi: plan === undefined ? false : planWritesUi(plan),
  };
}

/**
 * A block the applier wrote into the ui package renders nothing until the owner imports
 * it, because `add` never edits a page — where a block belongs is the owner's decision,
 * not filename sort's (ADR 0030). One line per module: which file arrived, and the skill
 * command whose Wire-up section carries the import and the tag.
 *
 * The `@ui/blocks/` target is the whole signal, so a module that ships one without a
 * skill has nowhere to keep those steps. That is the module author's bug, and it warns
 * rather than refuses — the file itself is fine and the user asked for it.
 */
function wireUpSteps(
  result: ApplyResult,
  aliases: Record<string, string>
): string[] {
  const blocks = uiBlockFiles(
    [...result.written, ...result.refreshed],
    aliases
  );
  if (blocks.length === 0) {
    return [];
  }

  const skillByModule = new Map(
    result.links.map((link) => [link.module, posix.basename(link.path)])
  );
  const byModule = new Map<string, string[]>();
  for (const block of blocks) {
    byModule.set(block.module, [
      ...(byModule.get(block.module) ?? []),
      block.target,
    ]);
  }

  const lines: string[] = [];
  for (const module of [...byModule.keys()].toSorted()) {
    const moduleTargets = (byModule.get(module) ?? []).toSorted();
    const targets = moduleTargets.map((target) => pc.cyan(target)).join(", ");
    const verb = moduleTargets.length === 1 ? "is" : "are";
    const skill = skillByModule.get(module);
    if (skill === undefined) {
      log.warn(
        `${pc.cyan(module)} wrote ${targets} but ships no skill — its wire-up steps are ` +
          `missing. Import the block yourself ${pc.dim("(a module that ships a block should ship a skill with a Wire-up section)")}.`
      );
      continue;
    }
    lines.push(
      `Manual wire-up needed — ${targets} ${verb} on disk but on no page yet. ` +
        `In your AI coding tool, run ${pc.cyan(`/${skill}`)} and follow its Wire-up section.`
    );
  }
  return lines;
}

/**
 * The environment half of the next-steps box.
 *
 * The variable names still print — they are what a reader scans for. Under them are the
 * two commands that fill them in: `saasaloy env` prompts into the gitignored
 * `packages/env/.env`, and `pnpm env:setup` distributes that one file into each service's
 * own `.env`. The example file stays what it is, the checked-in record of what each
 * variable means.
 *
 * Exported so the wording is pinned by a test — it is the one line telling a new user
 * the next command exists.
 */
export function envSteps(
  names: string[],
  devVarsPath: string | undefined
): string[] {
  if (names.length === 0) {
    return [];
  }
  const keys = names.toSorted();
  const where = devVarsPath
    ? ` ${pc.dim(`${devVarsPath} keeps the checked-in description of each.`)}`
    : "";
  return [
    `Set ${keys.map((key) => pc.cyan(key)).join(", ")}.`,
    `Run ${pc.cyan("saasaloy env")} — it prompts for each unset one and writes it to ${pc.cyan("packages/env/.env")}.${where}`,
    `Then run ${pc.cyan("pnpm env:setup")} to write each service's own ${pc.cyan(".env")} from it.`,
  ];
}

/**
 * The line an incomplete apply ends on (#49). A module whose file was edited between the
 * plan and the write is not installed, and staying quiet about it is the bug: the state
 * files say one thing and the closing "Applied" would say another. Name the modules, and
 * name the command that finishes the job — a plain re-run, because they are absent from
 * `config.installed` and so get planned again, drift and all, for a fresh approval.
 *
 * `requested` is the module the user typed, not each incomplete name: re-running it
 * re-plans the whole graph, including an incomplete dependency.
 */
export function formatIncomplete(
  incomplete: string[],
  requested: string
): string {
  const names = incomplete.map((name) => pc.cyan(name)).join(", ");
  const verb = incomplete.length === 1 ? "is" : "are";
  const object = incomplete.length === 1 ? "it" : "them";
  return (
    `${names} ${verb} not installed — files changed while the plan was open. ` +
    `Re-run ${pc.cyan(`saasaloy add ${requested}`)} to complete ${object}.`
  );
}

/**
 * The line a thrown apply ends on (#49). `add` has no rollback by design: whatever
 * landed before the throw stays, and the manifest, config and lock are written to
 * describe it. That is only honest if the user is told, so state the model and name the
 * command that finishes the job — the same plain re-run an incomplete run asks for,
 * since the module never reached `config.installed`.
 */
export function formatRecovery(requested: string): string {
  return (
    "Partial apply — the manifest, config and lock describe what landed. " +
    `Re-run ${pc.cyan(`saasaloy add ${requested}`)} to complete it.`
  );
}

/** What `persistState` needs to write the three state files. */
export interface PersistInput {
  config: LoadedConfig;
  /** The modules `executePlan` reported complete; `[]` when the apply threw. */
  completed: string[];
  graph: Graph;
  lock: Lockfile;
  manifest: Manifest;
  root: string;
  source: Pick<RegistrySource, "provenance">;
}

/**
 * Write the manifest, the config and the lock, and never throw (#49).
 *
 * This runs on the way out of an apply, successful or not, so one broken step here must
 * not take the others with it — nor replace the apply error that sent us this way. Each
 * step is attempted on its own, a failure is reported, and the failures are returned for
 * the caller to decide about.
 *
 * The lock is skipped when the source has no commit SHA to pin to. `provenance()` throws
 * in that case, and it used to throw first, before any save ran: an unresolvable remote
 * cost the user the manifest as well, and reported itself instead of the real error. A
 * lock entry is a pin, not a record of disk, so having none is the correct answer.
 *
 * A separate function from `runAdd` because these rules are what the bug was, and they
 * need injectable failures to test.
 */
export async function persistState(input: PersistInput): Promise<unknown[]> {
  const failures: unknown[] = [];

  // Pin the source + ref + commit SHA per module (ADR 0012). Only the freshly installed
  // ones: an already-installed dependency keeps the SHA it was fetched at, so the lock
  // never misstates on-disk provenance. This is a claim about a fetch rather than a
  // record of disk, so it stays here and never enters the ledger.
  try {
    upsertLock(
      input.lock,
      input.source.provenance(),
      input.completed,
      input.graph
    );
  } catch (error) {
    failures.push(error);
    log.warn(`Couldn't pin ${LOCK_FILE} — ${formatFailure(error)}.`);
  }

  // Record whatever actually landed even if a mid-plan write failed — a written file the
  // manifest doesn't know about would classify as a conflict next run. `persistLedger`
  // owns the rule; this command owns the wording (#150).
  for (const failure of await persistLedger(input)) {
    failures.push(failure.error);
    log.warn(
      `Couldn't write ${failure.file} — ${formatFailure(failure.error)}.`
    );
  }

  return failures;
}

/** What `applyAndPersist` needs beyond the state files `persistState` writes. */
export interface ApplyInput extends Omit<PersistInput, "completed"> {
  /**
   * Called once the apply itself is over, before any state file is written (#49). This
   * is the edge of the window where a failure can leave files on disk, and the caller
   * needs it to decide whether the run owes the user a recovery line.
   */
  onApplied?: () => void;
  plan: Plan;
}

/**
 * Run the plan and record what it did, whichever way it goes (#98, #49).
 *
 * All three state files leave `add` through this one path, so no exit skips one of them.
 * They pin what the apply reported complete rather than what the plan intended, so a run
 * that threw pins nothing and `config.installed` and the lock never disagree, not even
 * under `--force`, where the module was already installed before the run.
 *
 * A failed apply propagates its own error; a failed save on an otherwise clean apply
 * propagates that instead, because a run whose state files didn't land is not a success.
 * The two are not the same failure, though, so `onApplied` marks the boundary between
 * them for the caller.
 */
export async function applyAndPersist(input: ApplyInput): Promise<ApplyResult> {
  let result: ApplyResult;
  try {
    result = await executePlan(
      input.plan,
      input.root,
      input.config,
      input.manifest
    );
  } catch (error) {
    await persistState({ ...input, completed: [] });
    throw error;
  }
  input.onApplied?.();

  const failures = await persistState({
    ...input,
    completed: result.completed,
  });
  if (failures.length > 0) {
    throw failures[0];
  }
  return result;
}

/**
 * The closing box: where the module's procedure is written down, and what the project
 * still needs from the operator. `add waitlist` used to end at "Applied" while the
 * project 500s until `db:generate` and `db:migrate:local` run, and the env vars it
 * printed at plan time had scrolled away behind the confirmation (#98).
 *
 * There is deliberately no `nextSteps` field on the descriptor. The skill is the single
 * source of a module's procedure; a second copy in the descriptor would drift from it,
 * and this box points at the skill rather than paraphrasing it.
 */
function printNextSteps(
  plan: Plan,
  result: ApplyResult,
  devVarsPath: string | undefined,
  aliases: Record<string, string>
): void {
  const lines: string[] = [...wireUpSteps(result, aliases)];

  const skills = result.links
    .map((link) => posix.basename(link.path))
    .toSorted();
  if (skills.length > 0) {
    lines.push(
      `Read the module's own procedure — in your AI coding tool, run ${skills
        .map((name) => pc.cyan(`/${name}`))
        .join(" or ")}.`
    );
  }

  lines.push(...envSteps(Object.keys(plan.envVars), devVarsPath));

  if (lines.length === 0) {
    return;
  }
  note(wrapForNote(lines.join("\n\n")), "Next steps");
}

/** The mode `add` of an `enablesTesting` module turns testing on to (#242, ADR 0054). */
const ENABLED_MODE: TestingMode = "tests-after";

/**
 * The first module this run applies that turns testing on, when the project's mode is
 * `off` (#242 Q15). `tests-after` and `tdd` are left alone: the owner already chose, and a
 * module has no business picking test-first for them.
 */
export function testingEnabler(
  config: LoadedConfig,
  install: string[],
  graph: Pick<Graph, "modules">
): string | undefined {
  if (readTestingMode(config) !== "off") {
    return undefined;
  }
  return install.find(
    (name) => graph.modules.get(name)?.item.enablesTesting === true
  );
}

/**
 * Save the mode an `enablesTesting` module turned on, and rewrite the `AGENTS.md` block to
 * match. Runs only after the apply, and only for an enabler the apply reported complete
 * (#242 Q11): a refused or failed `add` leaves the mode where it was, and so does an
 * enabler whose files changed under the confirmation, which stays uninstalled. Returns
 * the module that turned testing on, or `undefined` when none did.
 */
export async function saveEnabledMode(input: {
  completed: string[];
  config: LoadedConfig;
  graph: Pick<Graph, "modules">;
  manifest: Manifest;
  root: string;
}): Promise<string | undefined> {
  const { completed, config, graph, manifest, root } = input;
  const enabler = testingEnabler(config, completed, graph);
  if (enabler === undefined) {
    return undefined;
  }
  const saved = await setTestingMode({
    config,
    manifest,
    mode: ENABLED_MODE,
    root,
  });
  // The backfill below reads the mode off this same config object.
  config.testing = saved.config.testing;
  log.info(
    `${pc.cyan(enabler)} turns testing on — ${CONFIG_FILE} now sets the testing mode to ${pc.cyan(ENABLED_MODE)}.`
  );
  reportBlockOutcome(saved.outcome);
  return enabler;
}

export async function runAdd(argv: string[]): Promise<number> {
  // Parse before anything answers, so `--help --forse` reports the typo instead of
  // printing help over it. Help is then answered before the intro rail opens, so it reads
  // as plain output a person can pipe into a pager rather than as a clack box.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  const out = createOutput(opts.json);
  const { tui } = out;
  intro(pc.bgCyan(pc.black(" saasaloy add ")), tui);

  if (opts.unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }
  // Only the dry run has a document to print. An apply reports as it writes, and `--diff`
  // is a per-file text diff, so both refuse `--json` rather than print half a contract.
  if (opts.json && (!opts.dryRun || opts.diff)) {
    return out.refuse(
      "`--json` prints the `--dry-run` plan — pass `--dry-run --json`, without `--diff`.",
      EXIT_REFUSED
    );
  }

  let coord: ReturnType<typeof parseCoordinate>;
  try {
    coord = parseCoordinate(opts.name);
  } catch (error) {
    return out.fail(error);
  }

  // The "Proceed?" confirm below reads stdin. With no terminal there it can never be
  // answered, so `saasaloy add x </dev/null` printed the whole plan, took the closed
  // stream as "no", and exited 0 having written nothing — a silent success. `update`
  // already refuses in this situation; both commands now answer it the same way (#98).
  // A preview writes nothing and needs no confirmation, so it is exempt. With no module
  // named the picker's own non-interactive refusal below is the more specific message,
  // so leave that case to it. The refusal itself waits until after the `requiresOneOf`
  // check: an unmet requirement names the modules to pick from, and `--yes` would not
  // have answered it anyway (#229).
  const cannotConfirm =
    Boolean(coord.module) &&
    !opts.yes &&
    !opts.dryRun &&
    !opts.diff &&
    !process.stdin.isTTY;

  let root: string;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    root = await findProjectRoot();
    config = await loadConfig(root);
  } catch (error) {
    return out.fail(error);
  }

  let plan: Plan;
  let prereqs: string[];
  let source: RegistrySource | undefined;
  // Set to the requested module once the apply starts. It tells the catch below whether
  // a failure could have left files on disk, so only those failures carry the re-run
  // instruction — a bad coordinate or a missing descriptor writes nothing (#49).
  let partial: string | undefined;
  try {
    // Load the lock up front so a named remote add can pin to the SHA it recorded — a
    // re-install then reproduces identical bytes (ADR 0012). Explicit `@ref` or the
    // `update` flow (#17) are the sanctioned ways to move off the lock.
    const lock = await loadLock(root);
    coord = pinToLock(coord, lock);

    source = createRegistrySource(coord);
    if (process.env[REGISTRY_ENV] && (coord.owner || coord.repo)) {
      log.warn(
        `Ignoring source "${coord.owner}/${coord.repo}" — ${REGISTRY_ENV} override is set.`,
        tui
      );
    }

    // No module named (bare `add`, or `owner/repo` with no module) → pick from the source.
    let requested = coord.module;
    if (!requested) {
      // No terminal to pick in (CI, piped stdin, `saasaloy add | cat`) means the prompt
      // below could never be answered — it would hang the pipeline. Say what was missing
      // instead, before the registry is even fetched.
      // `--json` never prompts, so it takes the same refusal on a terminal too.
      if (!isInteractive() || opts.json) {
        return out.refuse(
          `No module named and no terminal to pick one in — usage: \`${USAGE}\`.`,
          EXIT_REFUSED
        );
      }
      const offered = await source.listModules();
      if (offered.length === 0) {
        cancel(`No modules found in ${source.label}.`);
        return EXIT_REFUSED;
      }
      // Picking something already installed took the user through a plan preview to
      // "Nothing to do", which reads as a bug in the picker rather than an answer.
      // `--force` re-applies one, and that path names the module explicitly (#98).
      const installed = new Set(config.installed);
      const available = offered.filter((n) => !installed.has(n));
      if (available.length === 0) {
        note(
          `Every module in ${source.label} is already installed.`,
          "Nothing to add"
        );
        outro(pc.dim("use `saasaloy add <module> --force` to re-apply one"));
        return EXIT_OK;
      }
      const picked = await select({
        answeredBy: "a module name",
        message: `Pick a module to add ${pc.dim(`(from ${source.label}, ${installed.size} already installed)`)}`,
        options: available.map((n) => ({ label: n, value: n })),
      });
      if (isCancel(picked)) {
        cancel("add cancelled");
        return EXIT_FAILURE;
      }
      requested = picked;
    }

    let graph = await resolveGraph(source, requested);

    // `requires.saasaloy` — the descriptor's floor on the CLI reading it (#50). Checked
    // before the driver prompt and before a single file is planned, because a CLI too old
    // to understand the descriptor cannot be trusted to resolve the rest of it either.
    // The graph holds every transitive prerequisite, so a range declared three levels down
    // refuses here and the message names that module, not the one the user typed.
    const cliVersion = await readVersion();
    const cliCheckFails = (): boolean => {
      const mismatches = detectCliMismatches({ cliVersion, graph });
      if (mismatches.length === 0) {
        return false;
      }
      out.refuse(
        formatCliMismatches(mismatches, requested, cliVersion),
        EXIT_REFUSED
      );
      return true;
    };
    if (cliCheckFails()) {
      return EXIT_REFUSED;
    }

    // `requiresOneOf` — a capability naming its mutually exclusive drivers. Settle it
    // before the conflict check below, so that check reads the graph a picked driver is
    // already part of (#98).
    let unmet = detectMissingRequirements({ config, graph });
    // `--with` answers those choices up front, so a run with no terminal can pick a
    // driver (#223). Each one joins the graph only when it is an option of a requirement
    // still unmet, re-checked after each merge: a picked module may declare a requirement
    // that a later `--with` answers. One that answers nothing is refused rather than
    // installed on the side — the flag picks a driver, it is not a second `add`.
    // Deleting the current entry while iterating a Set is safe, and it keeps argv order.
    const pending = new Set(opts.with);
    for (let progressed = true; pending.size > 0 && progressed;) {
      progressed = false;
      for (const name of pending) {
        if (!unmet.some((requirement) => requirement.options.includes(name))) {
          continue;
        }
        graph = mergeGraph(graph, await resolveGraph(source, name));
        pending.delete(name);
        unmet = detectMissingRequirements({ config, graph });
        progressed = true;
      }
    }
    if (pending.size > 0) {
      return out.refuse(
        formatUnansweredWith([...pending], requested),
        EXIT_REFUSED
      );
    }
    if (unmet.length > 0 && (!isInteractive() || opts.yes || opts.json)) {
      // `--yes` means "don't ask me", not "choose a driver for my project", and a
      // pipeline has no terminal to answer in. `--json` never prompts. All three refuse
      // and name the options.
      return out.refuse(
        formatMissingRequirements(unmet, requested),
        EXIT_REFUSED
      );
    }
    // One prompt per unmet requirement, re-checked after each pick: a single driver can
    // satisfy two capabilities, and a picked module may declare a requirement of its own.
    // The round cap keeps a descriptor that requires its way in a circle from prompting
    // forever; whatever is still unmet when it runs out is refused below.
    for (
      let round = 0;
      unmet.length > 0 && round < MAX_REQUIREMENT_PROMPTS;
      round++
    ) {
      const requirement = unmet[0];
      if (!requirement) {
        break;
      }
      const picked = await select({
        answeredBy: `\`--with <${requirement.options.join(" | ")}>\``,
        message: `${pc.cyan(requirement.declaredBy)} needs one of these — pick one`,
        options: requirement.options.map((n) => ({ label: n, value: n })),
      });
      if (isCancel(picked)) {
        cancel("add cancelled");
        return EXIT_FAILURE;
      }
      graph = mergeGraph(graph, await resolveGraph(source, picked));
      unmet = detectMissingRequirements({ config, graph });
    }
    if (unmet.length > 0) {
      return out.refuse(
        formatMissingRequirements(unmet, requested),
        EXIT_REFUSED
      );
    }
    if (cannotConfirm) {
      return out.refuse(
        "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview.",
        EXIT_REFUSED
      );
    }

    // A driver the user just picked is a descriptor this run never saw above, so its own
    // `requires` is checked here too — still before anything is planned.
    if (cliCheckFails()) {
      return EXIT_REFUSED;
    }

    prereqs = graph.order.filter((n) => n !== requested);

    // Mutually exclusive modules are refused before anything is written, and `--force`
    // doesn't bypass it — force means "re-apply this module", not "install it anyway".
    const manifest = await loadManifest(root);
    const conflicts = detectConflicts({ graph, config, lock });
    if (conflicts.missingLockEntries.length > 0) {
      log.warn(
        `No lock entry for ${conflicts.missingLockEntries.map((m) => pc.cyan(m)).join(", ")} — ` +
          `any conflict they declare can't be checked ${pc.dim("(re-add them to record it)")}.`,
        tui
      );
    }
    if (conflicts.conflicts.length > 0) {
      return out.refuse(
        formatConflicts(conflicts.conflicts, requested),
        EXIT_REFUSED
      );
    }

    const install = graph.order.filter(
      (n) => !config.installed.includes(n) || (opts.force && n === requested)
    );
    // Installed and not being (re-)applied — a forced module belongs to `install`, not here.
    const alreadyInstalled = graph.order.filter(
      (n) => config.installed.includes(n) && !install.includes(n)
    );

    if (install.length === 0) {
      if (opts.json) {
        printJson(
          planDocument(requested, prereqs, undefined, alreadyInstalled)
        );
      }
      note(
        `${pc.cyan(requested)} and its dependencies are already installed.`,
        "Nothing to do",
        tui
      );
      outro(pc.dim("use --force to re-apply"), tui);
      return EXIT_OK;
    }

    // A module that turns testing on is planned in the mode it will leave behind, so its
    // own gated files and every other module's land in this same run. The mode itself is
    // saved only once the apply succeeds, and a preview saves nothing (#242 Q11).
    const enabler = testingEnabler(config, install, graph);
    plan = await buildPlan({
      alreadyInstalled,
      config,
      install,
      manifest,
      modules: graph.modules,
      requested,
      root,
      ...(enabler === undefined ? {} : { testingMode: ENABLED_MODE }),
    });

    summarizePlan(plan, requested, prereqs, tui);
    if (enabler !== undefined && (opts.dryRun || opts.diff)) {
      log.info(
        `${pc.cyan(enabler)} turns testing on — applying this sets the testing mode to ${pc.cyan(ENABLED_MODE)}.`,
        tui
      );
    }

    if (planWritesUi(plan)) {
      log.info(
        `This module writes ${pc.cyan("packages/ui/")}. Run ${pc.cyan("/saasaloy-design update")} after it applies.`,
        tui
      );
    }

    if (opts.diff) {
      for (const file of plan.files) {
        if (file.action === "unchanged") {
          continue;
        }
        note(
          renderDiff(file),
          `${ACTION_LABEL[file.action]}  ${fileLabel(file)}`
        );
      }
      for (const p of plan.patches) {
        if (p.action !== "apply") {
          continue;
        }
        note(p.diff, `${pc.green("patch")}  ${p.file}`);
      }
    }

    // --dry-run and --diff both preview only; nothing is written.
    if (opts.dryRun || opts.diff) {
      if (opts.json) {
        printJson(planDocument(requested, prereqs, plan));
      }
      outro(
        pc.dim(
          opts.diff
            ? "diff only — nothing applied"
            : "dry run — nothing applied"
        ),
        tui
      );
      return EXIT_OK;
    }

    if (!opts.yes) {
      const proceed = await confirm({
        answeredBy: "`--yes` to apply, or `--dry-run` to preview",
        message: "Proceed?",
      });
      if (isCancel(proceed)) {
        cancel("add cancelled");
        return EXIT_FAILURE;
      }
      if (!proceed) {
        outro(pc.dim("aborted — nothing applied"));
        return EXIT_OK;
      }
    }

    // For the length of the apply a failure can leave files on disk, so the catch below
    // owes the user the re-run that completes them (#49). `onApplied` closes that window
    // the moment the apply is over: a save that fails afterwards is its own story, and
    // the re-run the recovery line advises would have nothing left to complete.
    partial = requested;
    const result = await applyAndPersist({
      config,
      graph,
      lock,
      manifest,
      onApplied: () => {
        partial = undefined;
      },
      plan,
      root,
      source,
    });

    // Merge npm deps into the project root package.json (best-effort — never blocks the
    // apply). This trails `executePlan` on purpose (#98): a mid-plan failure throws past
    // here, so a run that wrote no files leaves no package.json advertising packages
    // nothing installed. Rolling back what `executePlan` itself wrote is #49.
    const pkg = await readRootPackageJson(root);
    let depsAdded: string[] = [];
    const allDeps = [...plan.dependencies, ...plan.devDependencies];
    if (allDeps.length > 0) {
      if (pkg) {
        const {
          added,
          devAdded,
          conflicts: depConflicts,
        } = planDeps(pkg, plan.dependencies, plan.devDependencies);
        await writeDeps(root, pkg, added, devAdded);
        depsAdded = [...added, ...devAdded].map((d) => d.name);
        for (const conflict of depConflicts) {
          log.warn(`Dependency version conflict — ${conflict}.`);
        }
      } else {
        // Best-effort means "don't block", not "fail silently".
        log.warn(
          `No package.json at the project root — add ${allDeps.join(", ")} yourself.`
        );
      }
    }

    for (const file of result.written) {
      log.step(`${ACTION_LABEL[file.action]}  ${file.target}`);
    }
    for (const file of result.refreshed) {
      log.step(`${ACTION_LABEL[file.action]}  ${file.target}`);
    }
    for (const link of result.links) {
      const label =
        link.action === "create" ? pc.green("link") : pc.dim("link");
      log.step(`${label}  ${link.path} ${pc.dim(`→ ${link.target}`)}`);
    }
    for (const link of result.linkConflicts) {
      log.warn(
        `Skill link ${pc.cyan(link.path)} left untouched — a non-saasaloy path already occupies it.`
      );
    }
    // A module's own links are planned above and recorded for `remove`. Every other folder
    // in `.agents/skills/` gets its link here too: a project's own skill, or a base skill
    // that arrived after `init` (ADR 0015).
    const moduleSkills = new Set(
      [...result.links, ...result.linkConflicts].map((link) =>
        posix.basename(link.path)
      )
    );
    const projectSkills = await linkAgentSkills(root);
    for (const name of projectSkills.created) {
      log.step(
        `${pc.green("link")}  .claude/skills/${name} ${pc.dim(`→ .agents/skills/${name}`)}`
      );
    }
    for (const name of projectSkills.conflicts) {
      if (!moduleSkills.has(name)) {
        log.warn(
          `Skill link ${pc.cyan(`.claude/skills/${name}`)} left untouched — a non-saasaloy path already occupies it.`
        );
      }
    }
    for (const failure of [
      ...projectSkills.failures,
      ...(projectSkills.unreadable === undefined
        ? []
        : [{ name: ".agents/skills", message: projectSkills.unreadable }]),
    ]) {
      log.warn(
        `Couldn't link skill ${pc.cyan(failure.name)}: ${failure.message} ${pc.dim("(the skill files are still in `.agents/skills/`)")}.`
      );
    }
    for (const p of result.patched) {
      log.step(
        `${pc.green("patch")}  ${p.file} ${pc.dim(`— ${p.patch.kind}`)}`
      );
    }
    await formatPatchedFiles(
      root,
      result.patched.map((p) => p.file)
    );
    for (const p of result.patchConflicts) {
      log.warn(
        `Config patch target ${pc.cyan(p.file)} missing — ${p.patch.kind} skipped.`
      );
    }
    // A refusal is not an idempotent no-op: the patch would have written something wrong,
    // so nothing was written and nothing was tracked. Name the file and the reason.
    for (const r of result.patchRefusals) {
      log.warn(
        `Config patch on ${pc.cyan(r.patch.file)} skipped — ${r.reason}. Wire it by hand.`
      );
    }
    if (result.lateDrift.length > 0) {
      const lines = result.lateDrift
        .map((f) => `  ${pc.yellow("kept")}  ${f.target}`)
        .join("\n");
      note(
        wrapForNote(
          `${lines}\n\n${pc.dim("Changed while the plan was open — left alone rather than overwritten.")}`
        ),
        "Changed under us"
      );
    }
    // Which of those kept files cost their module its install, stated plainly. The run
    // still exits 0: nothing failed, the user's own edit simply outranked the plan.
    const incomplete = plan.install.filter(
      (name) => !result.completed.includes(name)
    );
    if (incomplete.length > 0) {
      log.warn(formatIncomplete(incomplete, requested));
    }
    if (result.heldBack.length > 0) {
      const merges = result.heldBack
        .map((f) => `  ${ACTION_LABEL[f.action]}  ${f.target}`)
        .join("\n");
      note(
        wrapForNote(
          `${merges}\n\n${pc.dim("These were left untouched. Hand them to an agent with `--diff` to merge.")}`
        ),
        "Needs merge"
      );
    }
    if (depsAdded.length > 0) {
      note(
        wrapForNote(
          `${depsAdded.map((d) => pc.cyan(d)).join(", ")}\n\n${pc.dim("Run `pnpm install` to fetch them.")}`
        ),
        "Dependencies added"
      );
    }

    // The env vars printed at plan time, several boxes and a confirmation ago. Write
    // them where the project can keep them, and say where that is (#98).
    // A descriptor with no `envServices` routed by the `PUBLIC_` prefix alone. Say which
    // module, so a third-party descriptor gets fixed rather than quietly guessed at.
    if (plan.envServicesGuessed.length > 0) {
      log.warn(
        `${plan.envServicesGuessed.join(", ")} declare env vars without \`envServices\`, so the PUBLIC_ prefix decided which service reads each one. Check ${ENV_EXAMPLE}.`
      );
    }
    let devVarsPath: string | undefined;
    try {
      devVarsPath = await writeEnvExample({
        devVars: plan.devVars,
        envVars: plan.envVars,
        optional: plan.envOptional,
        services: plan.envServices,
        root,
      });
    } catch (error) {
      // Best-effort, like the dependency merge: an unwritable example file must not
      // undo an apply that already landed.
      log.warn(`Couldn't write ${ENV_EXAMPLE} — ${formatFailure(error)}.`);
    }

    await saveEnabledMode({
      completed: result.completed,
      config,
      graph,
      manifest,
      root,
    });
    // Another installed module may ship an entry this add made true: a `when.installed`
    // naming the module just added, or a test once the mode turned on (#242 Q8). The
    // modules applied above were planned in the current mode already.
    try {
      await reportBackfill(
        root,
        await runBackfill({
          config,
          exclude: new Set(result.completed),
          lock,
          manifest,
          root,
        })
      );
    } catch (error) {
      // The add itself landed. A backfill that stopped is finished by the next update.
      log.warn(
        `Backfill stopped — ${formatFailure(error)}. Run ${pc.cyan("saasaloy update")} to finish it.`
      );
    }

    printNextSteps(plan, result, devVarsPath, config.aliases);

    // The closing line names what was installed, not what was planned (#49). When
    // everything landed the two lists are the same and this reads as it always did.
    outro(
      result.completed.length > 0
        ? pc.green(
            `Applied ${result.completed.map((m) => pc.bold(m)).join(", ")} ${pc.dim(`(${result.written.length} files)`)}`
          )
        : pc.yellow(
            `Nothing installed ${pc.dim(`(${result.written.length} files written)`)}`
          )
    );
    return EXIT_OK;
  } catch (error) {
    // A failure after the apply started leaves part of the module on disk. Nothing is
    // rolled back, so say what the state files now describe and how to finish the job
    // (#49) before the error itself closes the run.
    if (partial) {
      log.warn(formatRecovery(partial));
    }
    return out.fail(error);
  } finally {
    // A remote source extracts each module to a temp dir; drop them once applied.
    await source?.cleanup?.();
  }
}
