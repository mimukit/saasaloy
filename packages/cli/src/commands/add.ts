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
import pc from "picocolors";
import { buildPlan, executePlan } from "../lib/applier.js";
import type {
  ApplyResult,
  FileAction,
  Plan,
  PlannedFile,
} from "../lib/applier.js";
import { detectConflicts, formatConflicts } from "../lib/conflicts.js";
import { planWritesUi } from "../lib/design.js";
import { lineDiff } from "../lib/diff.js";
import type { DiffLine } from "../lib/diff.js";
import { loadLock, saveLock, upsertLock } from "../lib/lock.js";
import { loadManifest, managedModules, saveManifest } from "../lib/manifest.js";
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

const KNOWN_FLAGS = new Set(["--dry-run", "--diff", "--yes", "-y", "--force"]);
const USAGE =
  "saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--dry-run] [--diff] [--yes] [--force]";

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

export async function runAdd(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  intro(pc.bgCyan(pc.black(" saasaloy add ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return 1;
  }

  let coord: ReturnType<typeof parseCoordinate>;
  try {
    coord = parseCoordinate(opts.name);
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    return 1;
  }

  let root: string;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    root = await findProjectRoot();
    config = await loadConfig(root);
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    return 1;
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
        return 1;
      }
      const available = await source.listModules();
      if (available.length === 0) {
        cancel(`No modules found in ${source.label}.`);
        return 1;
      }
      const picked = await select({
        message: `Pick a module to add ${pc.dim(`(from ${source.label})`)}`,
        options: available.map((n) => ({ label: n, value: n })),
      });
      if (isCancel(picked)) {
        cancel("add cancelled");
        return 1;
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
      return 1;
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
        return 1;
      }
      graph = mergeGraph(graph, await resolveGraph(source, picked));
      unmet = detectMissingRequirements({ config, graph });
    }
    if (unmet.length > 0) {
      cancel(formatMissingRequirements(unmet, requested));
      return 1;
    }

    prereqs = graph.order.filter((n) => n !== requested);

    // Mutually exclusive modules are refused before anything is written, and `--force`
    // doesn't bypass it — force means "re-apply this module", not "install it anyway".
    const manifest = await loadManifest(root);
    const conflicts = detectConflicts({
      graph,
      config,
      lock,
      // Only modules this tool applied. The scaffold template lists `web` in `installed[]`
      // and never writes it a lock entry, so checking every name warns on every add.
      managed: managedModules(manifest),
    });
    if (conflicts.missingLockEntries.length > 0) {
      log.warn(
        `No lock entry for ${conflicts.missingLockEntries.map((m) => pc.cyan(m)).join(", ")} — ` +
          `any conflict they declare can't be checked ${pc.dim("(re-add them to record it)")}.`
      );
    }
    if (conflicts.conflicts.length > 0) {
      cancel(formatConflicts(conflicts.conflicts, requested));
      return 1;
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
      return 0;
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
      return 0;
    }

    if (!opts.yes) {
      const proceed = await confirm({ message: "Proceed?" });
      if (isCancel(proceed)) {
        cancel("add cancelled");
        return 1;
      }
      if (!proceed) {
        outro(pc.dim("aborted — nothing applied"));
        return 0;
      }
    }

    let result: ApplyResult;
    try {
      result = await executePlan(plan, root, config, manifest);
    } finally {
      // Record whatever actually landed even if a mid-plan write failed — a written
      // file the manifest doesn't know about would classify as a conflict next run.
      await saveManifest(root, manifest);
      await saveConfig(root, config);
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

    // Pin what was actually applied in the lockfile: source + ref + commit SHA per module
    // (ADR 0012). Only the freshly-installed modules — an already-installed dep keeps the
    // SHA it was fetched at, so the lock never misstates on-disk provenance.
    upsertLock(lock, source.provenance(), plan.install, graph);
    await saveLock(root, lock);

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

    outro(
      pc.green(
        `Applied ${plan.install.map((m) => pc.bold(m)).join(", ")} ${pc.dim(`(${result.written.length} files)`)}`
      )
    );
    return 0;
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    // A remote source extracts each module to a temp dir; drop them once applied.
    await source?.cleanup?.();
  }
}
