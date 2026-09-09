import { cancel, intro, log, note, outro } from "@clack/prompts";
import { join, relative } from "node:path";
import pc from "picocolors";
import { readBaseDeclaration } from "../lib/base.js";
import {
  checkBase,
  checkPartialInstalls,
  checkProject,
  checkTarget,
  resolveDoctorTarget,
} from "../lib/doctor.js";
import type { BaseReport, ModuleReport } from "../lib/doctor.js";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { pathExists } from "../lib/fs-utils.js";
import { loadLock } from "../lib/lock.js";
import { loadManifest } from "../lib/manifest.js";
import { CONFIG_FILE, loadConfig } from "../lib/saasaloy-config.js";
import { baseTemplateDir } from "../lib/scaffold.js";
import { wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy doctor [path]` — validate module descriptors before they reach a stranger's
// machine. It checks a local folder: one module (`doctor modules/waitlist`) or a whole
// registry (`doctor modules`). Nothing named defaults to the current directory. Validating
// a remote coordinate — the consumer asking "is this module safe to add?" — is a separate
// command and a follow-up issue.
//
// A path carrying a `saasaloy.json` is checked as a project instead: the rules there read
// `installed` against `.saasaloy/manifest.json` and report a module that owns no files
// (#107), and a Base section says whether the template is recorded and which of its
// files drifted (#120). Drift there is information, not a problem: it never fails the
// run, and nothing here writes.
//
// The rules live in `lib/doctor.ts`; this file is presentation and exit codes only. An
// invalid descriptor is bad input, so a run with findings exits 2 (the refusal code),
// which is what makes `doctor` usable as a pre-publish gate in CI.

interface Options {
  path?: string;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--help", "-h"]);
const USAGE = "saasaloy doctor [<path>]";
const HELP: CommandHelp = {
  name: "doctor",
  describe: DESCRIPTIONS.doctor,
  usage: USAGE,
  flags: {},
};

/** The directory checked when nothing is named — the current directory. */
const DEFAULT_PATH = ".";

export function parseArgs(argv: string[]): Options {
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
  return { path: positional[0], unknown };
}

function renderReport(report: ModuleReport, root: string): string {
  const lines = report.findings.map(
    (found) => `  ${pc.yellow(found.where)}  ${found.message}`
  );
  return [pc.cyan(relative(root, report.dir) || report.module), ...lines].join(
    "\n"
  );
}

/** The Base box: record or `untracked`, the recorded CLI, per-file drift, and the seed list. */
function renderBase(report: BaseReport): string {
  if (report.status === "untracked" || !report.record) {
    return [
      `${pc.yellow("untracked")} — no record of which template scaffolded this project.`,
      pc.dim(
        "Run `saasaloy update` to record the base at this CLI; nothing is applied on that run."
      ),
    ].join("\n");
  }
  const lines = [
    `${pc.cyan(report.record.name)} ${pc.dim(`recorded at CLI ${report.record.cliVersion} (template ${report.record.templateHash.slice(0, 7)})`)}`,
    `${pc.green("✔")} ${report.matching} file${report.matching === 1 ? "" : "s"} match the record`,
    ...report.drifted.map(
      (target) =>
        `${pc.yellow("✎")} ${target} ${pc.dim("edited since it was recorded")}`
    ),
    ...report.missing.map(
      (target) =>
        `${pc.red("✗")} ${target} ${pc.dim("missing — `saasaloy update` restores it")}`
    ),
  ];
  if (report.seed.length > 0) {
    lines.push(pc.dim(`seed, not checked: ${report.seed.join(", ")}`));
  }
  return lines.join("\n");
}

/** The project side of `doctor`: what `saasaloy.json` and the manifest say about each other. */
async function reportProject(path: string): Promise<number> {
  const config = await loadConfig(path);
  const manifest = await loadManifest(path);
  const lock = await loadLock(path);
  const base = await checkBase({
    root: path,
    lock,
    manifest,
    seedFiles: (await readBaseDeclaration(await baseTemplateDir())).seedFiles,
  });
  note(wrapForNote(renderBase(base)), "Base");
  // Two halves of the same question: a module installed that owns nothing (#107), and a
  // module that owns work but was never marked installed (#49).
  const findings = [
    ...checkProject({ config, manifest }),
    ...checkPartialInstalls({ installed: config.installed, manifest }),
  ];
  if (findings.length === 0) {
    const count = config.installed.length;
    note(
      wrapForNote(
        config.installed.map((name) => `${pc.green("✔")} ${name}`).join("\n") ||
          pc.dim("No modules installed.")
      ),
      `Checked ${count} installed module${count === 1 ? "" : "s"}`
    );
    outro(pc.green("No problems found."));
    return EXIT_OK;
  }

  note(
    wrapForNote(
      findings
        .map((found) => `${pc.yellow(found.module)}  ${found.message}`)
        .join("\n")
    ),
    `${pc.yellow("Project state")} ${pc.dim(`(${findings.length})`)}`
  );
  cancel(
    `${findings.length} problem${findings.length === 1 ? "" : "s"} in ${CONFIG_FILE}.`
  );
  return EXIT_REFUSED;
}

export async function runDoctor(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  intro(pc.bgCyan(pc.black(" saasaloy doctor ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  const path = opts.path ?? DEFAULT_PATH;
  try {
    if (!(await pathExists(path))) {
      cancel(
        `No such path: ${path} — point \`doctor\` at a module folder or at a directory of them.`
      );
      return EXIT_REFUSED;
    }

    // A path carrying a `saasaloy.json` is a project, not a registry, so the project
    // rules run instead of the descriptor ones (#107). The default path is the current
    // directory, so `saasaloy doctor` picks project or registry mode by what's there.
    if (await pathExists(join(path, CONFIG_FILE))) {
      return await reportProject(path);
    }

    const target = await resolveDoctorTarget(path);
    if (target.names.length === 0) {
      cancel(
        `No module folders in ${path} — a module folder is one that carries a registry-item.json.`
      );
      return EXIT_REFUSED;
    }

    const reports = await checkTarget(target);
    const bad = reports.filter((report) => report.findings.length > 0);
    const total = bad.reduce((sum, report) => sum + report.findings.length, 0);

    if (bad.length === 0) {
      const checked = reports.map((report) => report.module);
      note(
        wrapForNote(
          checked.map((name) => `${pc.green("✔")} ${name}`).join("\n")
        ),
        `Checked ${checked.length} module${checked.length === 1 ? "" : "s"}`
      );
      outro(pc.green("No problems found."));
      return EXIT_OK;
    }

    for (const report of bad) {
      note(
        wrapForNote(renderReport(report, target.registryDir)),
        `${pc.yellow(report.module)} ${pc.dim(`(${report.findings.length})`)}`
      );
    }
    log.info(
      pc.dim(
        `Checked ${reports.length} module${reports.length === 1 ? "" : "s"}; ${reports.length - bad.length} clean.`
      )
    );
    cancel(
      `${total} problem${total === 1 ? "" : "s"} in ${bad.length} module${bad.length === 1 ? "" : "s"}.`
    );
    return EXIT_REFUSED;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }
}
