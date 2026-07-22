import { cancel, confirm, intro, isCancel, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import {
  buildPlan,
  executePlan,
  type FileAction,
  type Plan,
  type PlannedFile,
} from "../lib/applier.js";
import { lineDiff } from "../lib/diff.js";
import { loadManifest, saveManifest } from "../lib/manifest.js";
import { planDeps, readRootPackageJson, writeDeps } from "../lib/pkg-json.js";
import { findProjectRoot } from "../lib/project.js";
import { findRegistryDir } from "../lib/registry.js";
import { resolveGraph } from "../lib/resolve.js";
import { loadConfig, saveConfig } from "../lib/saasaloy-config.js";

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
}

function parseArgs(argv: string[]): Options {
  const positional = argv.filter((arg) => !arg.startsWith("-"));
  return {
    name: positional[0],
    dryRun: argv.includes("--dry-run"),
    diff: argv.includes("--diff"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    force: argv.includes("--force"),
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
    note(`${pc.bold(requested)} requires: ${prereqs.map((p) => pc.cyan(p)).join(", ")}`, "Dependencies");
  }
  const willInstall = plan.install.map((m) => pc.cyan(m)).join(pc.dim(" → "));
  const lines = [`will install: ${willInstall}`];

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
  note(lines.join("\n"), "Plan");

  if (Object.keys(plan.envVars).length > 0) {
    const envLines = Object.entries(plan.envVars).map(([k, v]) => `${pc.cyan(k)} ${pc.dim(`— ${v}`)}`);
    note(envLines.join("\n"), "Env vars to set");
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

  if (!opts.name) {
    cancel("Name a module to add, e.g. `saasaloy add waitlist`.");
    return 1;
  }
  const requested = opts.name;

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
  try {
    const registryDir = await findRegistryDir();
    const graph = await resolveGraph(registryDir, requested);
    prereqs = graph.order.filter((n) => n !== requested);

    const install = graph.order.filter(
      (n) => !config.installed.includes(n) || (opts.force && n === requested),
    );
    const alreadyInstalled = graph.order.filter((n) => config.installed.includes(n));

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
    if (pkg && plan.dependencies.length > 0) {
      const { added } = planDeps(pkg, plan.dependencies);
      await writeDeps(root, pkg, added);
      depsAdded = added.map((d) => d.name);
    }

    const result = await executePlan(plan, root, config, manifest);
    await saveManifest(root, manifest);
    await saveConfig(root, config);

    for (const file of result.written) {
      log.step(`${ACTION_LABEL[file.action]}  ${file.target}`);
    }
    if (result.heldBack.length > 0) {
      const merges = result.heldBack.map((f) => `  ${ACTION_LABEL[f.action]}  ${f.target}`).join("\n");
      note(
        `${merges}\n\n${pc.dim("These were left untouched. Hand them to an agent with `--diff` to merge.")}`,
        "Needs merge",
      );
    }
    if (depsAdded.length > 0) {
      note(
        `${depsAdded.map((d) => pc.cyan(d)).join(", ")}\n\n${pc.dim("Run `pnpm install` to fetch them.")}`,
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
  }
}
