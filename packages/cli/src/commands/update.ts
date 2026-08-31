import { mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
} from "@clack/prompts";
import pc from "picocolors";
import { detectConflicts, formatConflicts } from "../lib/conflicts.js";
import { lineDiff } from "../lib/diff.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { LOCK_FILE, loadLock, saveLock } from "../lib/lock.js";
import { loadManifest, MANIFEST_FILE, saveManifest } from "../lib/manifest.js";
import { renderMergePlan } from "../lib/merge-plan.js";
import { readRootPackageJson } from "../lib/pkg-json.js";
import { findProjectRoot } from "../lib/project.js";
import {
  createRegistrySource,
  REGISTRY_ENV,
  RemoteRegistrySource,
} from "../lib/registry.js";
import type { LoadedModule, RegistrySource } from "../lib/registry.js";
import { resolveGraph } from "../lib/resolve.js";
import { CONFIG_FILE, loadConfig, saveConfig } from "../lib/saasaloy-config.js";
import { TUI_ON_STDERR, wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";
import {
  buildUpdatePlan,
  compareInstalled,
  executeUpdatePlan,
  recordRefRewrites,
} from "../lib/updater.js";
import type {
  ModuleComparison,
  ModuleUpdateInput,
  ModuleUpdatePlan,
  PlannedUpdateFile,
  UpdateFileAction,
  UpdatePlan,
  UpdateResult,
} from "../lib/updater.js";

// `saasaloy update [<module>]` — re-resolve each installed module's ref, apply what can
// be applied deterministically, and emit an agent-consumable merge plan for everything
// that can't (issue #48). The copy-in tool's answer to "you own the code, so you can
// never update it": clean files are overwritten, hand-edited files are never touched,
// and the difference between the two is written down in enough detail for an agent to
// resolve it.
//
// stdout belongs to the merge plan and nothing else, so the whole clack TUI goes to
// stderr (`TUI_ON_STDERR`) and `saasaloy update email | claude` works with no flag.

interface Options {
  name?: string;
  /** `--ref <branch|tag|sha>`: the explicit unpin. Requires a named module. */
  ref?: string;
  /** `--out <path>`: write the merge plan here instead of stdout. */
  out?: string;
  dryRun: boolean;
  diff: boolean;
  yes: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set([
  "--dry-run",
  "--diff",
  "--yes",
  "-y",
  "--help",
  "-h",
]);
const VALUE_FLAGS = new Set(["--ref", "--out"]);
const USAGE =
  "saasaloy update [<module>] [--ref <ref>] [--out <path>] [--dry-run] [--diff] [--yes]";
const HELP: CommandHelp = {
  name: "update",
  describe: DESCRIPTIONS.update,
  usage: USAGE,
  flags: {
    "--ref <ref>": "update one module to this branch, tag, or SHA",
    "--out <path>": "write the merge plan to a file instead of stdout",
    "--dry-run": "show the plan and write nothing",
    "--diff": "show a per-file diff and write nothing",
    "-y, --yes": "skip the confirmation prompt",
  },
};

function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  const values: Record<string, string> = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) {
      positional.push(arg);
      continue;
    }
    // Accept both `--ref v2` and `--ref=v2`; a value flag with nothing after it is a
    // usage error, not a silently-empty ref. In the space-separated form the next token
    // must not itself be a flag, or `--ref --dry-run` pins the ref to "--dry-run" and
    // reaches the registry with it instead of reporting the usage error.
    const eq = arg.indexOf("=");
    const flag = eq === -1 ? arg : arg.slice(0, eq);
    if (VALUE_FLAGS.has(flag)) {
      const next = eq === -1 ? argv[i + 1] : arg.slice(eq + 1);
      if (!next || (eq === -1 && next.startsWith("-"))) {
        unknown.push(`${flag} (missing value)`);
        continue;
      }
      if (eq === -1) {
        i++;
      }
      values[flag] = next;
      continue;
    }
    if (!KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  unknown.push(...positional.slice(1));

  return {
    name: positional[0],
    ref: values["--ref"],
    out: values["--out"],
    dryRun: argv.includes("--dry-run"),
    diff: argv.includes("--diff"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    unknown,
  };
}

const ACTION_LABEL: Record<UpdateFileAction, string> = {
  skip: pc.dim("unchanged upstream"),
  create: pc.green("create"),
  overwrite: pc.cyan("update"),
  restore: pc.green("restore"),
  unchanged: pc.dim("unchanged"),
  drift: pc.yellow("drift → merge"),
  conflict: pc.yellow("conflict → merge"),
  delete: pc.red("delete"),
  "delete-drift": pc.yellow("dropped → kept"),
  "delete-missing": pc.dim("untrack"),
};

// Actions worth a line in the summary — `skip`/`unchanged` are counted, not listed, so
// a big module doesn't bury the handful of paths that actually move.
const QUIET: ReadonlySet<UpdateFileAction> = new Set<UpdateFileAction>([
  "skip",
  "unchanged",
]);

// Cap a single file's diff so a big generated file can't flood the terminal (same cap as `add`).
const MAX_DIFF_LINES = 60;

function renderDiff(file: PlannedUpdateFile): string {
  const lines = lineDiff(file.mine ?? "", file.theirs ?? "");
  const shown = lines.slice(0, MAX_DIFF_LINES).map((line) => {
    switch (line.kind) {
      case "add": {
        return pc.green(`+ ${line.text}`);
      }
      case "del": {
        return pc.red(`- ${line.text}`);
      }
      default: {
        return pc.dim(`  ${line.text}`);
      }
    }
  });
  if (lines.length > MAX_DIFF_LINES) {
    shown.push(pc.dim(`  … ${lines.length - MAX_DIFF_LINES} more lines`));
  }
  return shown.join("\n");
}

function short(sha: string): string {
  return /^[0-9a-f]{40}$/i.test(sha) ? sha.slice(0, 7) : sha;
}

function summarizeModule(mod: ModuleUpdatePlan): string[] {
  const lines = [
    `${pc.cyan(mod.name)} ${pc.dim(`${short(mod.comparison.current)} → ${short(mod.comparison.latest)} (${mod.comparison.ref})`)}`,
  ];
  if (mod.noMergeBase) {
    lines.push(pc.dim(`  no merge base — ${mod.noMergeBase}`));
  }
  for (const name of mod.prereqNames) {
    lines.push(
      `  ${pc.green("install")}  ${pc.cyan(name)} ${pc.dim("(new prerequisite)")}`
    );
  }
  for (const file of [...mod.files, ...mod.removals]) {
    if (QUIET.has(file.action)) {
      continue;
    }
    lines.push(`  ${ACTION_LABEL[file.action]}  ${file.target}`);
  }
  const quiet = [...mod.files, ...mod.removals].filter((f) =>
    QUIET.has(f.action)
  ).length;
  if (quiet > 0) {
    lines.push(pc.dim(`  ${quiet} file(s) already up to date`));
  }
  for (const bump of mod.depBumps) {
    lines.push(
      `  ${pc.cyan("bump")}  ${bump.name} ${pc.dim(`${bump.from} → ${bump.to}`)}`
    );
  }
  for (const dep of [...mod.depAdds, ...mod.devDepAdds]) {
    lines.push(`  ${pc.green("dep")}  ${dep.name}@${dep.version}`);
  }
  return lines;
}

function summarizePlan(plan: UpdatePlan): void {
  const lines: string[] = [];
  for (const mod of plan.modules) {
    lines.push(...summarizeModule(mod), "");
  }
  const merging = plan.modules.reduce(
    (n, m) =>
      n +
      m.files.filter((f) => f.action === "drift" || f.action === "conflict")
        .length +
      m.removals.filter((f) => f.action === "delete-drift").length,
    0
  );
  const writing = plan.modules.reduce(
    (n, m) =>
      n +
      m.files.filter(
        (f) =>
          !QUIET.has(f.action) &&
          f.action !== "drift" &&
          f.action !== "conflict"
      ).length,
    0
  );
  lines.push(pc.dim(`${writing} file(s) to apply, ${merging} needing merge`));
  note(wrapForNote(lines.join("\n")), "Plan", TUI_ON_STDERR);

  // A module with no lock entry already arrives here as an `unresolvable` comparison
  // carrying that reason, so `plan.missingLockEntries` isn't reported a second time.
  for (const comparison of plan.skipped) {
    log.info(
      `${pc.cyan(comparison.name)} ${pc.dim(`— ${skipReason(comparison)}`)}`,
      TUI_ON_STDERR
    );
  }
  for (const mod of plan.modules) {
    for (const conflict of mod.depConflicts) {
      log.warn(`Dependency version conflict — ${conflict}.`, TUI_ON_STDERR);
    }
    for (const patch of mod.patches) {
      if (patch.action === "missing") {
        log.warn(
          `Config patch target ${pc.cyan(patch.file)} is missing — ${patch.patch.kind} not applied.`,
          TUI_ON_STDERR
        );
      }
    }
  }
  // Named before the confirmation, in their own box, because a secret the new version
  // started requiring is the one thing that breaks the project after a clean update and
  // the one thing the file list can't tell you (#98).
  const envVars = new Map<string, string>();
  for (const mod of plan.modules) {
    for (const [key, description] of Object.entries(mod.newEnvVars)) {
      envVars.set(key, description);
    }
  }
  if (envVars.size > 0) {
    const envLines = [...envVars].map(
      ([key, description]) => `${pc.cyan(key)} ${pc.dim(`— ${description}`)}`
    );
    note(wrapForNote(envLines.join("\n")), "Env vars to set", TUI_ON_STDERR);
  }
  if (plan.migrationCommand) {
    note(
      wrapForNote(
        `${pc.cyan(plan.migrationCommand)}\n\n${pc.dim("The update changed the database schema — run this to regenerate migrations.")}`
      ),
      "Migrations",
      TUI_ON_STDERR
    );
  }
  note(
    wrapForNote(
      `${pc.cyan(plan.verifyCommand)}\n\n${pc.dim("Named, not run — an update usually precedes `pnpm install`.")}`
    ),
    "Verify with",
    TUI_ON_STDERR
  );
}

function skipReason(comparison: ModuleComparison, preview = false): string {
  switch (comparison.status) {
    case "current": {
      const at = `already at ${short(comparison.current)}`;
      if (!comparison.refRewrite) {
        return at;
      }
      // The SHA didn't move but the ref did — say so, or "already at <sha7>" would read
      // as though `--ref` had been ignored.
      return preview
        ? `${at} — \`--ref\` would move the lock onto \`${comparison.ref}\``
        : `${at} — now tracking \`${comparison.ref}\``;
    }
    default: {
      return comparison.detail ?? comparison.status;
    }
  }
}

// The three files Saasaloy owns. `--out` writes after the ledger saves, so a path
// pointing at one of these replaces real state with merge-plan prose and breaks the
// next command. Refuse the path up front rather than at the write.
const STATE_FILES = [CONFIG_FILE, LOCK_FILE, MANIFEST_FILE];

/** Why `--out <path>` is refused, or `undefined` when the path is safe to write. */
async function stateFileRefusal(
  root: string,
  out: string | undefined
): Promise<undefined | string> {
  if (!out) {
    return undefined;
  }
  const target = await canonicalPath(resolvePlanOut(out));
  for (const file of STATE_FILES) {
    if ((await canonicalPath(resolve(root, file))) === target) {
      return `Refusing to write the merge plan to ${pc.cyan(out)} — that is Saasaloy's own ${pc.cyan(file)}. Pick another path.`;
    }
  }
  return undefined;
}

// Compare through realpath, not lexically: `/var/…` is a symlink to `/private/var/…` on
// macOS, so two absolute paths naming the same file can differ character for character
// and a lexical check would wave the state file through. A path that isn't on disk yet
// still has a real parent, and one that has neither is already lexically resolved.
async function canonicalPath(path: string): Promise<string> {
  try {
    return await realpath(path);
  } catch {
    try {
      return join(await realpath(dirname(path)), basename(path));
    } catch {
      return path;
    }
  }
}

/** `--out <path>` resolved against the working directory, the one place that mapping lives. */
function resolvePlanOut(out: string): string {
  return isAbsolute(out) ? out : resolve(process.cwd(), out);
}

/** Emit the merge plan: `--out <path>` when given, otherwise stdout — and nothing else ever. */
async function emitMergePlan(
  document: string,
  out: string | undefined
): Promise<void> {
  if (!out) {
    process.stdout.write(document);
    return;
  }
  const target = resolvePlanOut(out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, document, "utf-8");
  log.success(`Merge plan written to ${pc.cyan(out)}`, TUI_ON_STDERR);
}

/** `owner/repo` → the two halves, or undefined when the lock's source isn't a remote slug. */
function splitSlug(slug: string): [string, string] | undefined {
  const [owner, repo, ...rest] = slug.split("/");
  if (!owner || !repo || rest.length > 0) {
    return undefined;
  }
  return [owner, repo];
}

export async function runUpdate(argv: string[]): Promise<number> {
  if (wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  const opts = parseArgs(argv);
  intro(pc.bgCyan(pc.black(" saasaloy update ")), TUI_ON_STDERR);

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      TUI_ON_STDERR
    );
    return EXIT_REFUSED;
  }
  // A bare `update --ref v2` would silently move every module onto one ref, which is
  // never what someone means — the unpin is per module by construction (decision 10).
  if (opts.ref && !opts.name) {
    cancel(
      `\`--ref\` needs an explicit module — usage: \`${USAGE}\`.`,
      TUI_ON_STDERR
    );
    return EXIT_REFUSED;
  }

  let root: string;
  let config: Awaited<ReturnType<typeof loadConfig>>;
  try {
    root = await findProjectRoot();
    config = await loadConfig(root);
  } catch (error) {
    cancel(formatFailure(error), TUI_ON_STDERR);
    return exitCodeFor(error);
  }

  const outRefusal = await stateFileRefusal(root, opts.out);
  if (outRefusal) {
    cancel(outRefusal, TUI_ON_STDERR);
    return EXIT_REFUSED;
  }

  // The merge plan goes to stdout, so `saasaloy update email | claude` is the designed
  // pipeline and a redirected stdout says nothing about who is watching. This command
  // used to read it as "a script is driving me" and set `--yes` for itself, which made
  // `saasaloy update | tee log` overwrite every clean file unconfirmed (#98). stdin is
  // the stream the confirmation actually reads: no terminal there means the prompt can
  // never be answered, so refuse and name the two ways forward. A preview writes nothing,
  // so it is exempt.
  const preview = opts.dryRun || opts.diff;
  if (!opts.yes && !preview && !process.stdin.isTTY) {
    cancel(
      "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview.",
      TUI_ON_STDERR
    );
    // Refused by design, like every other bad-usage exit here (#98's 0/1/2 scheme).
    return EXIT_REFUSED;
  }

  const sources: RegistrySource[] = [];
  try {
    if (opts.name && !config.installed.includes(opts.name)) {
      cancel(
        `${pc.cyan(opts.name)} isn't installed — nothing to update.`,
        TUI_ON_STDERR
      );
      return EXIT_REFUSED;
    }
    const targets = opts.name ? [opts.name] : config.installed;
    if (targets.length === 0) {
      note("Nothing installed.", "Nothing to do", TUI_ON_STDERR);
      outro(pc.dim("0 modules"), TUI_ON_STDERR);
      return EXIT_OK;
    }

    const manifest = await loadManifest(root);
    const lock = await loadLock(root);
    const registryOverride = !!process.env[REGISTRY_ENV];

    // Cache one source per (repo, ref) so a bare `update` resolves each ref once.
    const resolvers = new Map<string, RemoteRegistrySource>();
    const remote = (slug: string, ref: string): RemoteRegistrySource => {
      const key = `${slug}@${ref}`;
      const cached = resolvers.get(key);
      if (cached) {
        return cached;
      }
      const parts = splitSlug(slug);
      if (!parts) {
        throw new Error(
          `Lock entry source "${slug}" isn't an owner/repo coordinate.`
        );
      }
      const source = new RemoteRegistrySource(parts[0], parts[1], ref);
      resolvers.set(key, source);
      sources.push(source);
      return source;
    };

    if (registryOverride) {
      const fromRemote = targets.filter((name) => {
        const entry = lock.modules[name];
        return entry && entry.source !== "local";
      });
      if (fromRemote.length > 0) {
        log.warn(
          `${REGISTRY_ENV} is set, so ${fromRemote.join(", ")} will be updated from that working ` +
            `copy rather than ${pc.cyan(lock.modules[fromRemote[0]!]?.source ?? "the registry")} — ` +
            `${pc.dim("there is no merge base for a working copy")}.`,
          TUI_ON_STDERR
        );
      }
    }

    const comparisons = await compareInstalled({
      installed: targets,
      lock,
      overrideRef: opts.ref,
      registryOverride,
      resolveRef: (_name, entry, ref) => remote(entry.source, ref).resolveSha(),
    });

    const outdated = comparisons.filter((c) => c.status === "outdated");
    const skipped = comparisons.filter((c) => c.status !== "outdated");
    if (outdated.length === 0) {
      // `--ref` onto a tag that already points at the SHA the lock records moves no
      // files, but it is still the explicit unpin — record it here or the module stays
      // pinned forever. `--dry-run`/`--diff` preview only, so they write nothing.
      if (!preview && recordRefRewrites(lock, comparisons).length > 0) {
        await saveLock(root, lock);
      }
      for (const comparison of skipped) {
        log.info(
          `${pc.cyan(comparison.name)} ${pc.dim(`— ${skipReason(comparison, preview)}`)}`,
          TUI_ON_STDERR
        );
      }
      outro(pc.green("Everything is up to date."), TUI_ON_STDERR);
      return EXIT_OK;
    }

    // Fetch each outdated module twice — at the new SHA (theirs) and at the SHA the lock
    // records (base). Refetching base is what makes a real three-way merge possible; a
    // base we can't reach degrades the document rather than failing the update.
    const inputs: ModuleUpdateInput[] = [];
    // Mutually exclusive modules, checked the way `add` checks them (#98). A new version
    // can introduce a `dependsOn` on a second driver, and `update` installs a new
    // prerequisite as part of the same plan — so without this the command lands the exact
    // pair `add` refuses. Collected across every module and reported once, before
    // anything is written: `executeUpdatePlan` applies the whole plan under one
    // confirmation, so a refusal here has to stop the run, not one module of it.
    const conflictRefusals: string[] = [];
    const missingLockEntries = new Set<string>();
    for (const comparison of outdated) {
      // One module's fetch failing is that module's problem: a dead tarball, a renamed
      // dependency, a network blip. It is reported and skipped, never fatal, so a bare
      // `update` still lands every other module (criterion 17).
      try {
        const theirsSource = registryOverride
          ? createRegistrySource({})
          : remote(comparison.source, comparison.latest);
        if (registryOverride) {
          sources.push(theirsSource);
        }

        const graph = await resolveGraph(theirsSource, comparison.name);
        const theirs = graph.modules.get(comparison.name);
        if (!theirs) {
          throw new Error(
            `${comparison.name} isn't in the registry at ${short(comparison.latest)}.`
          );
        }

        const report = detectConflicts({ graph, config, lock });
        for (const name of report.missingLockEntries) {
          missingLockEntries.add(name);
        }
        if (report.conflicts.length > 0) {
          conflictRefusals.push(
            formatConflicts(report.conflicts, comparison.name, "update")
          );
          continue;
        }

        let base: LoadedModule | undefined;
        let noMergeBase: string | undefined;
        if (registryOverride || comparison.current === "local") {
          noMergeBase = "local install";
        } else {
          try {
            base = await remote(
              comparison.source,
              comparison.current
            ).readModule(comparison.name);
          } catch (error) {
            // A force-pushed branch, a deleted tag, a repo gone private — the clean path
            // has already been decided, so refusing here would leave the user worse off.
            noMergeBase =
              error instanceof Error ? error.message : String(error);
          }
        }

        const intent =
          base && !registryOverride
            ? await theirsSource.commitSubjects(
                `modules/${comparison.name}`,
                comparison.current,
                comparison.latest
              )
            : [];

        inputs.push({
          comparison,
          theirs,
          ...(base ? { base } : {}),
          ...(noMergeBase ? { noMergeBase } : {}),
          intent,
          prereqs: {
            order: graph.order.filter((n) => n !== comparison.name),
            modules: graph.modules,
          },
        });
      } catch (error) {
        skipped.push({
          ...comparison,
          status: "unresolvable",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (missingLockEntries.size > 0) {
      log.warn(
        `No lock entry for ${[...missingLockEntries].map((m) => pc.cyan(m)).join(", ")} — ` +
          `any conflict they declare can't be checked ${pc.dim("(re-add them to record it)")}.`,
        TUI_ON_STDERR
      );
    }
    if (conflictRefusals.length > 0) {
      cancel(conflictRefusals.join("\n"), TUI_ON_STDERR);
      return EXIT_REFUSED;
    }

    // Everything outdated failed to fetch — there is no plan to summarize or confirm.
    if (inputs.length === 0) {
      for (const comparison of skipped) {
        // Only a fetch failure is a warning here — a `current` module is just news.
        const line = `${pc.cyan(comparison.name)} ${pc.dim(`— ${skipReason(comparison)}`)}`;
        if (comparison.status === "unresolvable") {
          log.warn(line, TUI_ON_STDERR);
        } else {
          log.info(line, TUI_ON_STDERR);
        }
      }
      // Every candidate failed to fetch — a failure, not a refusal: a retry may work.
      outro(pc.yellow("Nothing could be updated."), TUI_ON_STDERR);
      return EXIT_FAILURE;
    }

    const pkg = await readRootPackageJson(root);
    if (!pkg) {
      log.warn(
        "No package.json at the project root — dependency pins won't be updated.",
        TUI_ON_STDERR
      );
    }
    const plan = await buildUpdatePlan({
      root,
      config,
      manifest,
      lock,
      inputs,
      considered: targets,
      skipped,
      pkg,
    });

    summarizePlan(plan);

    if (opts.diff) {
      for (const file of [
        ...plan.modules.flatMap((m) => m.files),
        ...plan.modules.flatMap((m) => m.removals),
      ]) {
        if (QUIET.has(file.action)) {
          continue;
        }
        note(
          renderDiff(file),
          `${ACTION_LABEL[file.action]}  ${file.target}`,
          TUI_ON_STDERR
        );
      }
    }

    // --dry-run and --diff both preview only: nothing is written anywhere, including
    // `--out`. The merge plan still renders to stdout so the preview is complete.
    if (preview) {
      const document = renderMergePlan(plan);
      if (document) {
        process.stdout.write(document);
      }
      outro(
        pc.dim(
          opts.diff
            ? "diff only — nothing applied"
            : "dry run — nothing applied"
        ),
        TUI_ON_STDERR
      );
      return EXIT_OK;
    }

    if (!opts.yes) {
      const proceed = await confirm({ message: "Proceed?", ...TUI_ON_STDERR });
      if (isCancel(proceed)) {
        cancel("update cancelled", TUI_ON_STDERR);
        return EXIT_FAILURE;
      }
      if (!proceed) {
        outro(pc.dim("aborted — nothing applied"), TUI_ON_STDERR);
        return EXIT_OK;
      }
    }

    // Capture the outcome rather than letting it throw, so the ledger writes below
    // still run on the failure path and the original error still wins afterwards.
    const outcome = await executeUpdatePlan(plan, {
      root,
      config,
      manifest,
      lock,
      pkg,
    }).then(
      (value) => ({ ok: true as const, value }),
      (error: unknown) => ({ ok: false as const, error })
    );

    // Record whatever actually landed even if a mid-plan write failed — the ledger must
    // describe the real on-disk state (`add`'s invariant; #49 owns real transactionality
    // for both commands). All three are attempted together: awaiting them in sequence
    // would let a failed manifest save skip the config and lock, which is the same
    // partial ledger this step exists to prevent.
    const saves = await Promise.allSettled([
      saveManifest(root, manifest),
      saveConfig(root, config),
      saveLock(root, lock),
    ]);
    if (!outcome.ok) {
      throw outcome.error;
    }
    const failedSave = saves.find((save) => save.status === "rejected");
    if (failedSave) {
      throw failedSave.reason;
    }
    const result: UpdateResult = outcome.value;

    reportResult(result);

    // Phase 4: the merge plan is emitted only after the clean path has run, so it
    // describes what is actually left to do rather than what might have been.
    const document = renderMergePlan(plan);
    if (document) {
      await emitMergePlan(document, opts.out);
      note(
        wrapForNote(
          pc.dim(
            opts.out
              ? "Hand that file to an agent — your edits were left untouched."
              : "That merge plan is on stdout — pipe it to an agent. Your edits were left untouched."
          )
        ),
        "Needs merge",
        TUI_ON_STDERR
      );
    }

    // Drift routing to a merge plan is the designed outcome, not a failure — exit 0
    // whether or not anything was left for the agent to reconcile.
    outro(summarizeOutcome(plan, result), TUI_ON_STDERR);
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error), TUI_ON_STDERR);
    return exitCodeFor(error);
  } finally {
    // Each remote source extracted its modules to a temp dir; drop them all.
    for (const source of sources) {
      await source.cleanup?.();
    }
  }
}

/** The closing line: what landed, and what is still waiting on a merge. */
function summarizeOutcome(plan: UpdatePlan, result: UpdateResult): string {
  const changed = result.written.length + result.deleted.length;
  const merging = plan.modules.filter((m) => m.needsMerge).map((m) => m.name);
  const applied =
    changed > 0
      ? `Updated ${[
          ...new Set(
            [...result.written, ...result.deleted].map((f) => f.module)
          ),
        ]
          .map((n) => pc.bold(n))
          .join(
            ", "
          )} ${pc.dim(`(${result.written.length} written, ${result.deleted.length} removed)`)}`
      : "";

  if (merging.length === 0) {
    return pc.green(applied || "Already up to date.");
  }
  const names = merging.map((n) => pc.bold(n)).join(", ");
  const verb = merging.length === 1 ? "needs" : "need";
  const merge = pc.yellow(
    applied
      ? `${names} still ${verb} a merge — see the plan above.`
      : `${names} ${verb} a merge — see the plan above.`
  );
  return applied ? `${pc.green(applied)} ${merge}` : merge;
}

function reportResult(result: UpdateResult): void {
  for (const name of result.prereqsInstalled) {
    log.step(
      `${pc.green("install")}  ${pc.cyan(name)} ${pc.dim("(new prerequisite)")}`,
      TUI_ON_STDERR
    );
  }
  for (const file of result.written) {
    log.step(`${ACTION_LABEL[file.action]}  ${file.target}`, TUI_ON_STDERR);
  }
  for (const file of result.deleted) {
    log.step(`${pc.red("delete")}  ${file.target}`, TUI_ON_STDERR);
  }
  for (const file of result.untracked) {
    log.step(
      `${pc.dim("untrack")}  ${file.target} ${pc.dim("(already gone)")}`,
      TUI_ON_STDERR
    );
  }
  for (const patch of result.patched) {
    log.step(
      `${pc.green("patch")}  ${patch.file} ${pc.dim(`— ${patch.patch.kind}`)}`,
      TUI_ON_STDERR
    );
  }
  for (const link of result.linkConflicts) {
    log.warn(
      `Skill link ${pc.cyan(link.path)} left untouched — not ours to replace.`,
      TUI_ON_STDERR
    );
  }
  for (const dep of result.depsWritten) {
    log.step(`${pc.cyan("dep")}  ${dep.name}@${dep.version}`, TUI_ON_STDERR);
  }
  if (result.lateDrift.length > 0) {
    const lines = result.lateDrift
      .map((f) => `  ${pc.yellow("kept")}  ${f.target}`)
      .join("\n");
    note(
      wrapForNote(
        `${lines}\n\n${pc.dim("Edited while the plan was open — left alone rather than overwritten.")}`
      ),
      "Changed under us",
      TUI_ON_STDERR
    );
  }
  if (result.driftSurvivors.length > 0) {
    const lines = result.driftSurvivors
      .map((f) => `  ${pc.yellow("kept")}  ${f.target}`)
      .join("\n");
    note(
      wrapForNote(
        `${lines}\n\n${pc.dim("Hand-edited — left on disk, now untracked.")}`
      ),
      "Drift survivors",
      TUI_ON_STDERR
    );
  }
}
