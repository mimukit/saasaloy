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
import { lineDiff } from "../lib/diff.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { loadLock, saveLock } from "../lib/lock.js";
import { loadManifest, saveManifest } from "../lib/manifest.js";
import { isReversibleKind } from "../lib/patch/index.js";
import { findProjectRoot } from "../lib/project.js";
import { buildRemovePlan, executeRemovePlan } from "../lib/remover.js";
import type {
  FileRemoveAction,
  LinkRemoveAction,
  PatchRemoveAction,
  PlannedRemoveFile,
  RemovePlan,
} from "../lib/remover.js";
import { loadConfig, saveConfig } from "../lib/saasaloy-config.js";
import { isInteractive, wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy remove <module>` — the local undo, mirroring `add`'s clack UX and flag
// surface. Fully offline: the plan derives entirely from manifest.json,
// saasaloy.json and saasaloy-lock.json (issue #27). `--dry-run`/`--diff` preview
// without mutating; a drifted managed file is never silently clobbered.

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
  "saasaloy remove [<module>] [--dry-run] [--diff] [--yes] [--force]";
const HELP: CommandHelp = {
  name: "remove",
  describe: DESCRIPTIONS.remove,
  usage: USAGE,
  flags: {
    "--dry-run": "show the plan and delete nothing",
    "--diff": "show what each deletion removes, and delete nothing",
    "-y, --yes": "skip the confirmation prompt (drifted files are kept)",
    "--force": "remove even while another module depends on it",
  },
};

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      positional.push(arg);
    } else if (!KNOWN_FLAGS.has(arg)) {
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

const FILE_ACTION_LABEL: Record<FileRemoveAction, string> = {
  delete: pc.red("delete"),
  drift: pc.yellow("drift → confirm"),
  missing: pc.dim("missing → untrack"),
};

// Under --yes the confirm loop never runs (see the `if (!opts.yes)` gate below), so a
// drifted file always survives untracked rather than pausing for a prompt — label it
// accordingly instead of implying a confirmation that won't happen.
function fileActionLabel(action: FileRemoveAction, yes: boolean): string {
  if (action === "drift" && yes) {
    return pc.yellow("drift → kept (untracked)");
  }
  return FILE_ACTION_LABEL[action];
}

const LINK_ACTION_LABEL: Record<LinkRemoveAction, string> = {
  remove: pc.red("unlink"),
  missing: pc.dim("missing"),
  conflict: pc.yellow("conflict → left"),
};

const PATCH_ACTION_LABEL: Record<PatchRemoveAction, string> = {
  revert: pc.red("revert"),
  refused: pc.yellow("drift → left"),
  gone: pc.dim("already gone"),
  drop: pc.dim("untrack"),
};

// Cap a single file's deletion diff so a big generated file can't flood the terminal
// (same cap as `add`'s renderDiff).
const MAX_DIFF_LINES = 60;

function renderDeleteDiff(file: PlannedRemoveFile): string {
  const lines = lineDiff(file.oldContent ?? "", "");
  const shown = lines
    .slice(0, MAX_DIFF_LINES)
    .map((line) => pc.red(`- ${line.text}`));
  if (lines.length > MAX_DIFF_LINES) {
    shown.push(pc.dim(`  … ${lines.length - MAX_DIFF_LINES} more lines`));
  }
  return shown.join("\n");
}

function summarizeRemovePlan(
  plan: RemovePlan,
  name: string,
  yes: boolean
): void {
  const lines = [`will remove: ${pc.cyan(name)}`, ""];
  for (const file of plan.files) {
    lines.push(`  ${fileActionLabel(file.action, yes)}  ${file.target}`);
  }
  const toDelete = plan.files.filter((f) => f.action === "delete").length;
  const drifted = plan.files.filter((f) => f.action === "drift").length;
  const missing = plan.files.filter((f) => f.action === "missing").length;
  lines.push("");
  const driftNote = yes ? "kept untracked" : "need confirmation";
  lines.push(
    pc.dim(
      `${toDelete} file(s) to delete, ${drifted} drifted (${driftNote}), ${missing} already missing`
    )
  );
  note(wrapForNote(lines.join("\n")), "Plan");

  const ownedLinks = plan.links.filter((l) => l.action !== "missing");
  if (ownedLinks.length > 0) {
    const linkLines = ownedLinks.map(
      (l) => `${LINK_ACTION_LABEL[l.action]}  ${l.path}`
    );
    note(wrapForNote(linkLines.join("\n")), "Skill links");
  }
  // Conflicted skill links are warned about once, post-execute (see `result.linkConflicts`
  // below) — that reflects what actually happened, so we don't also warn here from the plan.

  // A dependents refusal (without --force) returns before this is ever called, so
  // reaching here with dependents means --force is overriding it.
  if (plan.dependents.length > 0) {
    log.warn(
      `${pc.cyan(name)} is still depended on by ${plan.dependents.join(", ")} — proceeding anyway (--force).`
    );
  }
  for (const missingLock of plan.missingLockEntries) {
    log.warn(
      `Installed module ${pc.cyan(missingLock)} has no lock entry — dependent detection is incomplete for it.`
    );
  }

  // `chained-route` is the one kind with an inverse, so it's listed as work rather than
  // warned about; what actually happened is reported post-execute (#83, #36).
  const reversible = plan.patches.filter((p) => p.action !== "drop");
  if (reversible.length > 0) {
    const patchLines = reversible.map(
      (p) =>
        `  ${PATCH_ACTION_LABEL[p.action]}  ${p.entry.file} ${pc.dim(`(${p.entry.patch.kind})`)}${p.reason === undefined ? "" : `\n    ${pc.dim(p.reason)}`}`
    );
    note(wrapForNote(patchLines.join("\n")), "Config patches");
  }
  for (const p of plan.patches) {
    if (p.action !== "drop") {
      continue;
    }
    log.warn(
      `Config patch on ${pc.cyan(p.entry.file)} ${pc.dim(`(${p.entry.patch.kind})`)} is not reversed by \`remove\` — hand-revert it if needed.`
    );
  }
}

export async function runRemove(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  const opts = parseArgs(argv);
  intro(pc.bgCyan(pc.black(" saasaloy remove ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
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

  try {
    let name = opts.name;
    if (!name) {
      if (config.installed.length === 0) {
        note("Nothing installed.", "Nothing to do");
        outro(pc.dim("0 modules"));
        return EXIT_OK;
      }
      // Same hazard as `add`: without a terminal this prompt can never be answered, so
      // it would hang rather than fail.
      if (!isInteractive()) {
        cancel(
          `No module named and no terminal to pick one in — usage: \`${USAGE}\`.`
        );
        return EXIT_REFUSED;
      }
      const picked = await select({
        message: "Pick a module to remove",
        options: config.installed.map((n) => ({ value: n, label: n })),
      });
      if (isCancel(picked)) {
        cancel("remove cancelled");
        return EXIT_FAILURE;
      }
      name = picked;
    }

    if (!config.installed.includes(name)) {
      cancel(`${pc.cyan(name)} isn't installed — nothing to remove.`);
      return EXIT_REFUSED;
    }

    const manifest = await loadManifest(root);
    const lock = await loadLock(root);
    const plan = await buildRemovePlan({ root, name, config, manifest, lock });

    if (plan.dependents.length > 0 && !opts.force) {
      cancel(
        `${pc.cyan(name)} is still depended on by ${plan.dependents.join(", ")} — refusing ` +
          `${pc.dim("(use --force to remove it anyway)")}.`
      );
      return EXIT_REFUSED;
    }

    summarizeRemovePlan(plan, name, opts.yes);

    if (opts.diff) {
      for (const file of plan.files) {
        if (file.action === "missing") {
          continue;
        }
        note(
          renderDeleteDiff(file),
          `${fileActionLabel(file.action, opts.yes)}  ${file.target}`
        );
      }
      // A reversal is a destructive edit to someone else's file, so it previews like one.
      // The diff comes from the plan's pure `reversePatch` run; nothing has been written.
      for (const p of plan.patches) {
        if (p.action !== "revert") {
          continue;
        }
        note(p.diff, `${pc.red("revert")}  ${p.entry.file}`);
      }
    }

    // --dry-run and --diff both preview only; nothing is written.
    if (opts.dryRun || opts.diff) {
      outro(
        pc.dim(
          opts.diff
            ? "diff only — nothing removed"
            : "dry run — nothing removed"
        )
      );
      return EXIT_OK;
    }

    // Drift is sacred: confirm per file before deleting hand-edited content.
    // Under --yes, no prompts run at all — drifted files always survive, untracked.
    const deleteDrifted = new Set<string>();
    if (!opts.yes) {
      for (const file of plan.files) {
        if (file.action !== "drift") {
          continue;
        }
        const proceed = await confirm({
          message: `${file.target} was hand-edited since it was applied — delete it anyway?`,
          initialValue: false,
        });
        if (isCancel(proceed)) {
          cancel("remove cancelled");
          return EXIT_FAILURE;
        }
        if (proceed) {
          deleteDrifted.add(file.target);
        }
      }
    }

    if (!opts.yes) {
      const proceed = await confirm({ message: "Proceed?" });
      if (isCancel(proceed)) {
        cancel("remove cancelled");
        return EXIT_FAILURE;
      }
      if (!proceed) {
        outro(pc.dim("aborted — nothing removed"));
        return EXIT_OK;
      }
    }

    let result: Awaited<ReturnType<typeof executeRemovePlan>>;
    try {
      result = await executeRemovePlan(plan, {
        root,
        config,
        manifest,
        lock,
        deleteDrifted,
      });
    } finally {
      // Record whatever actually happened even if a mid-plan step failed — the
      // ledger must reflect the real on-disk state (same rationale as `add`).
      await saveManifest(root, manifest);
      await saveConfig(root, config);
      await saveLock(root, lock);
    }

    for (const file of result.deleted) {
      log.step(`${pc.red("delete")}  ${file.target}`);
    }
    for (const file of result.missingUntracked) {
      log.step(
        `${pc.dim("untrack")}  ${file.target} ${pc.dim("(already gone)")}`
      );
    }
    for (const link of result.linksRemoved) {
      log.step(`${pc.red("unlink")}  ${link.path}`);
    }
    for (const link of result.linkConflicts) {
      log.warn(
        `Skill link ${pc.cyan(link.path)} left untouched — not ours to remove.`
      );
    }
    for (const p of result.patchesReversed) {
      log.step(`${pc.red("revert")}  ${p.file} ${pc.dim(`(${p.patch.kind})`)}`);
    }
    // A reversible entry that landed in `patchesDropped` either had nothing left to undo —
    // the link was hand-removed, or the file is gone — or the inverse refused it, which is
    // a different thing to say. Never claim a revert; the non-reversible kinds were already
    // warned about from the plan.
    const refusals = new Map(
      result.patchRefusals.map((r) => [r.patch, r.reason])
    );
    for (const p of result.patchesDropped) {
      if (!isReversibleKind(p.patch.kind)) {
        continue;
      }
      const reason = refusals.get(p);
      log.warn(
        reason === undefined
          ? `Config patch on ${pc.cyan(p.file)} ${pc.dim(`(${p.patch.kind})`)} was already gone — nothing to revert.`
          : `Config patch on ${pc.cyan(p.file)} ${pc.dim(`(${p.patch.kind})`)} left untouched — ${reason}.`
      );
    }
    for (const dir of result.prunedDirs) {
      log.step(`${pc.dim("prune")}  ${dir}`);
    }
    for (const alias of result.droppedAliases) {
      log.warn(
        `Alias ${pc.cyan(alias)} dropped — its target directory is gone.`
      );
    }

    // Drift survivors are the designed outcome, not a failure — exit 0 either way.
    if (result.driftSurvivors.length > 0) {
      const survivorLines = result.driftSurvivors
        .map((f) => `  ${pc.yellow("kept")}  ${f.target}`)
        .join("\n");
      note(
        wrapForNote(
          `${survivorLines}\n\n${pc.dim("Hand-edited since — left on disk, now untracked.")}`
        ),
        "Drift survivors"
      );
    }

    outro(
      pc.green(
        `Removed ${pc.bold(name)} ${pc.dim(`(${result.deleted.length} files)`)}`
      )
    );
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }
}
