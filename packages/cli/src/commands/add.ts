import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
} from "@clack/prompts";
import { posix } from "node:path";
import pc from "picocolors";
import { buildPlan, executePlan } from "../lib/applier.js";
import type {
  ApplyResult,
  FileAction,
  Plan,
  PlannedFile,
} from "../lib/applier.js";
import { detectConflicts, formatConflicts } from "../lib/conflicts.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { planWritesUi } from "../lib/design.js";
import { DEV_VARS_EXAMPLE, writeDevVarsExample } from "../lib/dev-vars.js";
import { lineDiff } from "../lib/diff.js";
import type { DiffLine } from "../lib/diff.js";
import { loadLock, saveLock, upsertLock } from "../lib/lock.js";
import { loadManifest, saveManifest } from "../lib/manifest.js";
import { planDeps, readRootPackageJson, writeDeps } from "../lib/pkg-json.js";
import { findProjectRoot } from "../lib/project.js";
import {
  createRegistrySource,
  DEFAULT_OWNER,
  DEFAULT_REPO,
  parseCoordinate,
  REGISTRY_ENV,
} from "../lib/registry.js";
import type { RegistrySource } from "../lib/registry.js";
import {
  detectMissingRequirements,
  formatMissingRequirements,
} from "../lib/requires.js";
import { mergeGraph, resolveGraph } from "../lib/resolve.js";
import { loadConfig, saveConfig } from "../lib/saasaloy-config.js";
import { isInteractive, wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy add <module>` — the local applier. Resolve the dependsOn graph, show the
// plan behind a confirmation prompt, then drop files into their convention-based
// targets, record them in .saasaloy/manifest.json with content hashes, and merge npm
// deps (build spec §2.4/§2.7/§2.9). `--dry-run`/`--diff` preview without mutating.

interface Options {
  name?: string;
  dryRun: boolean;
  diff: boolean;
  yes: boolean;
  force: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set([
  "--dry-run",
  "--diff",
  "--yes",
  "-y",
  "--force",
  "--help",
  "-h",
]);
const USAGE =
  "saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--dry-run] [--diff] [--yes] [--force]";
const HELP: CommandHelp = {
  name: "add",
  describe: DESCRIPTIONS.add,
  usage: USAGE,
  flags: {
    "--dry-run": "show the plan and write nothing",
    "--diff": "show a per-file diff and write nothing",
    "-y, --yes": "skip the confirmation prompt",
    "--force": "re-apply a module that is already installed",
  },
};

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
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
    name: positional[0],
    unknown,
    yes: argv.includes("--yes") || argv.includes("-y"),
  };
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

function summarizePlan(plan: Plan, requested: string, prereqs: string[]): void {
  if (prereqs.length > 0) {
    note(
      wrapForNote(
        `${pc.bold(requested)} requires: ${prereqs.map((p) => pc.cyan(p)).join(", ")}`
      ),
      "Dependencies"
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
    lines.push(`  ${ACTION_LABEL[file.action]}  ${file.target}`);
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
  note(wrapForNote(lines.join("\n")), "Plan");

  if (Object.keys(plan.envVars).length > 0) {
    const envLines = Object.entries(plan.envVars).map(
      ([k, v]) => `${pc.cyan(k)} ${pc.dim(`— ${v}`)}`
    );
    note(wrapForNote(envLines.join("\n")), "Env vars to set");
  }
  if (Object.keys(plan.aliases).length > 0) {
    const aliasLines = Object.entries(plan.aliases).map(
      ([a, p]) => `${pc.cyan(a)} ${pc.dim(`→ ${p}`)}`
    );
    note(
      wrapForNote(
        `${aliasLines.join("\n")}\n\n${pc.dim("New workspace(s) — run `pnpm install` to link them.")}`
      ),
      "Aliases registered"
    );
  }
  for (const conflict of plan.aliasConflicts) {
    log.warn(
      `Alias redefinition: ${conflict} ${pc.dim("(scaffold overrides the existing alias)")}.`
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
      "Skill links"
    );
  }
  for (const link of plan.links) {
    if (link.action === "conflict") {
      log.warn(
        `Skill link ${pc.cyan(link.path)} already exists and isn't ours — ` +
          `left untouched ${pc.dim("(remove it to let `add` link the skill)")}.`
      );
    }
  }
  const applyPatches = plan.patches.filter((p) => p.action === "apply");
  if (applyPatches.length > 0) {
    const patchLines = applyPatches.map(
      (p) => `${pc.cyan(p.file)} ${pc.dim(`— ${p.patch.kind}`)}`
    );
    note(wrapForNote(patchLines.join("\n")), "Config patches");
  }
  for (const p of plan.patches) {
    if (p.action === "missing") {
      log.warn(
        `Config patch target ${pc.cyan(p.file)} is missing — ${p.patch.kind} not applied ` +
          `${pc.dim(`(is ${p.module}'s prerequisite installed?)`)}.`
      );
    }
  }
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
  devVarsPath: string | undefined
): void {
  const lines: string[] = [];

  const skills = result.links
    .map((link) => posix.basename(link.path))
    .toSorted();
  if (skills.length > 0) {
    lines.push(
      `Read the module's own procedure — in Claude Code, run ${skills
        .map((name) => pc.cyan(`/${name}`))
        .join(" or ")}.`
    );
  }

  const envKeys = Object.keys(plan.envVars).toSorted();
  if (envKeys.length > 0) {
    lines.push(
      `Set ${envKeys.map((key) => pc.cyan(key)).join(", ")}.`,
      devVarsPath
        ? `${pc.cyan(devVarsPath)} lists each one with its description — copy it to ${pc.cyan(".dev.vars")} and fill it in.`
        : pc.dim("Each one is described in the plan above.")
    );
  }

  if (lines.length === 0) {
    return;
  }
  note(wrapForNote(lines.join("\n\n")), "Next steps");
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

  intro(pc.bgCyan(pc.black(" saasaloy add ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  let coord: ReturnType<typeof parseCoordinate>;
  try {
    coord = parseCoordinate(opts.name);
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }

  // The "Proceed?" confirm below reads stdin. With no terminal there it can never be
  // answered, so `saasaloy add x </dev/null` printed the whole plan, took the closed
  // stream as "no", and exited 0 having written nothing — a silent success. `update`
  // already refuses in this situation; both commands now answer it the same way (#98).
  // A preview writes nothing and needs no confirmation, so it is exempt. With no module
  // named the picker's own non-interactive refusal below is the more specific message,
  // so leave that case to it.
  if (
    coord.module &&
    !opts.yes &&
    !opts.dryRun &&
    !opts.diff &&
    !process.stdin.isTTY
  ) {
    cancel(
      "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview."
    );
    return EXIT_REFUSED;
  }

  let root: string;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    root = await findProjectRoot();
    config = await loadConfig(root);
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }

  let plan: Plan;
  let prereqs: string[];
  let source: RegistrySource | undefined;
  try {
    // Load the lock up front so a named remote add can pin to the SHA it recorded — a
    // re-install then reproduces identical bytes (ADR 0012). Explicit `@ref` or the
    // `update` flow (#17) are the sanctioned ways to move off the lock.
    const lock = await loadLock(root);
    if (!process.env[REGISTRY_ENV] && coord.module && !coord.ref) {
      const slug = `${coord.owner ?? DEFAULT_OWNER}/${coord.repo ?? DEFAULT_REPO}`;
      const pinned = lock.modules[coord.module];
      if (pinned && pinned.source === slug && pinned.resolved !== "local") {
        coord = { ...coord, ref: pinned.resolved };
      }
    }

    source = createRegistrySource(coord);
    if (process.env[REGISTRY_ENV] && (coord.owner || coord.repo)) {
      log.warn(
        `Ignoring source "${coord.owner}/${coord.repo}" — ${REGISTRY_ENV} override is set.`
      );
    }

    // No module named (bare `add`, or `owner/repo` with no module) → pick from the source.
    let requested = coord.module;
    if (!requested) {
      // No terminal to pick in (CI, piped stdin, `saasaloy add | cat`) means the prompt
      // below could never be answered — it would hang the pipeline. Say what was missing
      // instead, before the registry is even fetched.
      if (!isInteractive()) {
        cancel(
          `No module named and no terminal to pick one in — usage: \`${USAGE}\`.`
        );
        return EXIT_REFUSED;
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

    // `requiresOneOf` — a capability naming its mutually exclusive drivers. Settle it
    // before the conflict check below, so that check reads the graph a picked driver is
    // already part of (#98).
    let unmet = detectMissingRequirements({ config, graph });
    if (unmet.length > 0 && (!isInteractive() || opts.yes)) {
      // `--yes` means "don't ask me", not "choose a driver for my project", and a
      // pipeline has no terminal to answer in. Both refuse and name the options.
      cancel(formatMissingRequirements(unmet, requested));
      return EXIT_REFUSED;
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
      cancel(formatMissingRequirements(unmet, requested));
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
          `any conflict they declare can't be checked ${pc.dim("(re-add them to record it)")}.`
      );
    }
    if (conflicts.conflicts.length > 0) {
      cancel(formatConflicts(conflicts.conflicts, requested));
      return EXIT_REFUSED;
    }

    const install = graph.order.filter(
      (n) => !config.installed.includes(n) || (opts.force && n === requested)
    );
    // Installed and not being (re-)applied — a forced module belongs to `install`, not here.
    const alreadyInstalled = graph.order.filter(
      (n) => config.installed.includes(n) && !install.includes(n)
    );

    if (install.length === 0) {
      note(
        `${pc.cyan(requested)} and its dependencies are already installed.`,
        "Nothing to do"
      );
      outro(pc.dim("use --force to re-apply"));
      return EXIT_OK;
    }

    plan = await buildPlan({
      alreadyInstalled,
      config,
      install,
      manifest,
      modules: graph.modules,
      root,
    });

    summarizePlan(plan, requested, prereqs);

    if (planWritesUi(plan)) {
      log.info(
        `This module writes ${pc.cyan("packages/ui/")}. Run ${pc.cyan("/saasaloy-design update")} after it applies.`
      );
    }

    if (opts.diff) {
      for (const file of plan.files) {
        if (file.action === "unchanged") {
          continue;
        }
        note(renderDiff(file), `${ACTION_LABEL[file.action]}  ${file.target}`);
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
      outro(
        pc.dim(
          opts.diff
            ? "diff only — nothing applied"
            : "dry run — nothing applied"
        )
      );
      return EXIT_OK;
    }

    if (!opts.yes) {
      const proceed = await confirm({ message: "Proceed?" });
      if (isCancel(proceed)) {
        cancel("add cancelled");
        return EXIT_FAILURE;
      }
      if (!proceed) {
        outro(pc.dim("aborted — nothing applied"));
        return EXIT_OK;
      }
    }

    let result: ApplyResult;
    try {
      result = await executePlan(plan, root, config, manifest);
    } finally {
      // Record whatever actually landed even if a mid-plan write failed — a written
      // file the manifest doesn't know about would classify as a conflict next run.
      //
      // The lock saves here too (#98): all three state files leave `add` through one
      // path, so no exit skips one of them. It pins what `config.installed` records
      // rather than what the plan intended — `executePlan` writes that list last, so a
      // run that threw records no module in either file, and the two never disagree.
      //
      // Pin the source + ref + commit SHA per module (ADR 0012). Only the freshly
      // installed ones: an already-installed dependency keeps the SHA it was fetched at,
      // so the lock never misstates on-disk provenance.
      const installed = plan.install.filter((name) =>
        config.installed.includes(name)
      );
      upsertLock(lock, source.provenance(), installed, graph);
      await saveManifest(root, manifest);
      await saveConfig(root, config);
      await saveLock(root, lock);
    }

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
    for (const p of result.patched) {
      log.step(
        `${pc.green("patch")}  ${p.file} ${pc.dim(`— ${p.patch.kind}`)}`
      );
    }
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
    let devVarsPath: string | undefined;
    try {
      devVarsPath = await writeDevVarsExample({
        aliases: config.aliases,
        devVars: plan.devVars,
        envVars: plan.envVars,
        root,
      });
    } catch (error) {
      // Best-effort, like the dependency merge: an unwritable example file must not
      // undo an apply that already landed.
      log.warn(`Couldn't write ${DEV_VARS_EXAMPLE} — ${formatFailure(error)}.`);
    }

    printNextSteps(plan, result, devVarsPath);

    outro(
      pc.green(
        `Applied ${plan.install.map((m) => pc.bold(m)).join(", ")} ${pc.dim(`(${result.written.length} files)`)}`
      )
    );
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  } finally {
    // A remote source extracts each module to a temp dir; drop them once applied.
    await source?.cleanup?.();
  }
}
