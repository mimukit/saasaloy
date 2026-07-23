import { cancel, confirm, intro, isCancel, log, note, outro, select } from "@clack/prompts";
import pc from "picocolors";
import {
  type ApplyResult,
  buildPlan,
  executePlan,
  type FileAction,
  type Plan,
  type PlannedFile,
} from "../lib/applier.js";
import { lineDiff } from "../lib/diff.js";
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
  type RegistrySource,
} from "../lib/registry.js";
import { resolveGraph } from "../lib/resolve.js";
import { loadConfig, saveConfig } from "../lib/saasaloy-config.js";
import { wrapForNote } from "../lib/tui.js";

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
const USAGE = "saasaloy add [<module>|<owner/repo[@ref]/module>|<owner/repo>] [--dry-run] [--diff] [--yes] [--force]";

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
    name: positional[0],
    dryRun: argv.includes("--dry-run"),
    diff: argv.includes("--diff"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    force: argv.includes("--force"),
    unknown,
  };
}

const ACTION_LABEL: Record<FileAction, string> = {
  create: pc.green("create"),
  overwrite: pc.cyan("overwrite"),
  unchanged: pc.dim("unchanged"),
  drift: pc.yellow("drift → merge"),
  conflict: pc.yellow("conflict → merge"),
};

// Cap a single file's diff so a big generated file can't flood the terminal.
const MAX_DIFF_LINES = 60;

function renderDiff(file: PlannedFile): string {
  const lines = lineDiff(file.oldContent ?? "", file.content);
  const shown = lines.slice(0, MAX_DIFF_LINES).map((line) => {
    switch (line.kind) {
      case "add":
        return pc.green(`+ ${line.text}`);
      case "del":
        return pc.red(`- ${line.text}`);
      default:
        return pc.dim(`  ${line.text}`);
    }
  });
  if (lines.length > MAX_DIFF_LINES) {
    shown.push(pc.dim(`  … ${lines.length - MAX_DIFF_LINES} more lines`));
  }
  return shown.join("\n");
}

function summarizePlan(plan: Plan, requested: string, prereqs: string[]): void {
  if (prereqs.length > 0) {
    note(
      wrapForNote(`${pc.bold(requested)} requires: ${prereqs.map((p) => pc.cyan(p)).join(", ")}`),
      "Dependencies",
    );
  }
  const willInstall = plan.install.map((m) => pc.cyan(m)).join(pc.dim(" → "));
  const lines = [`will install: ${willInstall}`];
  if (plan.alreadyInstalled.length > 0) {
    lines.push(pc.dim(`already installed (skipped): ${plan.alreadyInstalled.join(", ")}`));
  }

  const writable = plan.files.filter((f) => f.action !== "drift" && f.action !== "conflict");
  const held = plan.files.filter((f) => f.action === "drift" || f.action === "conflict");
  lines.push("");
  for (const file of plan.files) {
    lines.push(`  ${ACTION_LABEL[file.action]}  ${file.target}`);
  }
  lines.push("");
  lines.push(pc.dim(`${writable.length} file(s) to apply, ${held.length} needing merge`));
  if (plan.dependencies.length > 0) {
    lines.push(pc.dim(`deps: ${plan.dependencies.join(", ")}`));
  }
  note(wrapForNote(lines.join("\n")), "Plan");

  if (Object.keys(plan.envVars).length > 0) {
    const envLines = Object.entries(plan.envVars).map(([k, v]) => `${pc.cyan(k)} ${pc.dim(`— ${v}`)}`);
    note(wrapForNote(envLines.join("\n")), "Env vars to set");
  }
  if (plan.deferredPatches.length > 0 || plan.deferredScaffolds.length > 0) {
    const both = [...new Set([...plan.deferredPatches, ...plan.deferredScaffolds])];
    log.warn(
      `Config patches/scaffolds for ${both.join(", ")} are not applied by this engine yet ` +
        `${pc.dim("(patch engine — issue #7)")}.`,
    );
  }
}

export async function runAdd(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  intro(pc.bgCyan(pc.black(" saasaloy add ")));

  if (opts.unknown.length > 0) {
    cancel(`Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`);
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
        `Ignoring source "${coord.owner}/${coord.repo}" — ${REGISTRY_ENV} override is set.`,
      );
    }

    // No module named (bare `add`, or `owner/repo` with no module) → pick from the source.
    let requested = coord.module;
    if (!requested) {
      const available = await source.listModules();
      if (available.length === 0) {
        cancel(`No modules found in ${source.label}.`);
        return 1;
      }
      const picked = await select({
        message: `Pick a module to add ${pc.dim(`(from ${source.label})`)}`,
        options: available.map((n) => ({ value: n, label: n })),
      });
      if (isCancel(picked)) {
        cancel("add cancelled");
        return 1;
      }
      requested = picked as string;
    }

    const graph = await resolveGraph(source, requested);
    prereqs = graph.order.filter((n) => n !== requested);

    const install = graph.order.filter(
      (n) => !config.installed.includes(n) || (opts.force && n === requested),
    );
    // Installed and not being (re-)applied — a forced module belongs to `install`, not here.
    const alreadyInstalled = graph.order.filter(
      (n) => config.installed.includes(n) && !install.includes(n),
    );

    if (install.length === 0) {
      note(`${pc.cyan(requested)} and its dependencies are already installed.`, "Nothing to do");
      outro(pc.dim("use --force to re-apply"));
      return 0;
    }

    const manifest = await loadManifest(root);
    plan = await buildPlan({
      root,
      install,
      alreadyInstalled,
      modules: graph.modules,
      config,
      manifest,
    });

    summarizePlan(plan, requested, prereqs);

    if (opts.diff) {
      for (const file of plan.files) {
        if (file.action === "unchanged") continue;
        note(renderDiff(file), `${ACTION_LABEL[file.action]}  ${file.target}`);
      }
    }

    // --dry-run and --diff both preview only; nothing is written.
    if (opts.dryRun || opts.diff) {
      outro(pc.dim(opts.diff ? "diff only — nothing applied" : "dry run — nothing applied"));
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

    // Merge npm deps into the project root package.json (best-effort — never blocks the apply).
    const pkg = await readRootPackageJson(root);
    let depsAdded: string[] = [];
    if (plan.dependencies.length > 0) {
      if (pkg) {
        const { added, conflicts } = planDeps(pkg, plan.dependencies);
        await writeDeps(root, pkg, added);
        depsAdded = added.map((d) => d.name);
        for (const conflict of conflicts) {
          log.warn(`Dependency version conflict — ${conflict}.`);
        }
      } else {
        // Best-effort means "don't block", not "fail silently".
        log.warn(
          `No package.json at the project root — add ${plan.dependencies.join(", ")} yourself.`,
        );
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

    // Pin what was actually applied in the lockfile: source + ref + commit SHA per module
    // (ADR 0012). Only the freshly-installed modules — an already-installed dep keeps the
    // SHA it was fetched at, so the lock never misstates on-disk provenance.
    upsertLock(lock, source.provenance(), plan.install, graph);
    await saveLock(root, lock);

    for (const file of result.written) {
      log.step(`${ACTION_LABEL[file.action]}  ${file.target}`);
    }
    if (result.heldBack.length > 0) {
      const merges = result.heldBack.map((f) => `  ${ACTION_LABEL[f.action]}  ${f.target}`).join("\n");
      note(
        wrapForNote(
          `${merges}\n\n${pc.dim("These were left untouched. Hand them to an agent with `--diff` to merge.")}`,
        ),
        "Needs merge",
      );
    }
    if (depsAdded.length > 0) {
      note(
        wrapForNote(
          `${depsAdded.map((d) => pc.cyan(d)).join(", ")}\n\n${pc.dim("Run `pnpm install` to fetch them.")}`,
        ),
        "Dependencies added",
      );
    }

    outro(
      pc.green(
        `Applied ${plan.install.map((m) => pc.bold(m)).join(", ")} ${pc.dim(`(${result.written.length} files)`)}`,
      ),
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
