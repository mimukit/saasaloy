import { cancel, intro, log, note, outro } from "@clack/prompts";
import { join, relative } from "node:path";
import pc from "picocolors";
import { readBaseDeclaration } from "../lib/base.js";
import {
  checkBase,
  checkDeploy,
  checkEnv,
  checkConfigValues,
  checkPartialInstalls,
  checkPolicyBindings,
  checkProject,
  checkRetiredInfra,
  checkUnmetRequirements,
  checkTarget,
  hasRetiredInfra,
  readDeployState,
  readEnvState,
  readConfigState,
  readPolicyState,
  resolveDoctorTarget,
} from "../lib/doctor.js";
import type { BaseReport, Finding, ModuleReport } from "../lib/doctor.js";
import { EXIT_OK, EXIT_REFUSED } from "../lib/exit.js";
import { pathExists, readIfPresent } from "../lib/fs-utils.js";
import { createOutput, printJson } from "../lib/json-output.js";
import type { Output } from "../lib/json-output.js";
import { loadLock } from "../lib/lock.js";
import { loadManifest } from "../lib/manifest.js";
import { ROOT_MANIFEST, rootVersion } from "../lib/root-version.js";
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
// run, and nothing here writes. The deploy warnings (ADR 0048) follow the same rule.
//
// The rules live in `lib/doctor.ts`; this file is presentation and exit codes only. An
// invalid descriptor is bad input, so a run with findings exits 2 (the refusal code),
// which is what makes `doctor` usable as a pre-publish gate in CI.
//
// `--json` prints the same findings as one document on stdout, with the exit code
// unchanged (#223). `mode` says which rule set ran: `registry` or `project`.

interface Options {
  path?: string;
  /** `--json`: one JSON document on stdout, the TUI on stderr. */
  json: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--json", "--help", "-h"]);
const USAGE = "saasaloy doctor [<path>] [--json]";
const HELP: CommandHelp = {
  name: "doctor",
  describe: DESCRIPTIONS.doctor,
  usage: USAGE,
  flags: {
    "--json": "print the findings as one JSON document on stdout",
  },
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
  return { json: argv.includes("--json"), path: positional[0], unknown };
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

/** A finding as `doctor --json` prints it: the module, the pointer and the sentence. */
function findingJson(
  found: Finding
): Pick<Finding, "message" | "module" | "where"> {
  return { message: found.message, module: found.module, where: found.where };
}

/** The project side of `doctor`: what `saasaloy.json` and the manifest say about each other. */
async function reportProject(path: string, out: Output): Promise<number> {
  const config = await loadConfig(path);
  const manifest = await loadManifest(path);
  const lock = await loadLock(path);
  const templateDir = await baseTemplateDir();
  const base = await checkBase({
    root: path,
    lock,
    manifest,
    seedFiles: (await readBaseDeclaration(templateDir)).seedFiles,
    templateVersion: rootVersion(
      await readIfPresent(join(templateDir, ROOT_MANIFEST))
    ),
  });
  note(wrapForNote(renderBase(base)), "Base", out.tui);
  // The deploy rules (ADR 0048) are warnings, like base drift: each prints its fix and
  // none of them turns exit 0 into 2. `pnpm deploy:production` refuses the same state on
  // its own, so this only says it sooner.
  const warnings = checkDeploy(await readDeployState(path));
  if (warnings.length > 0) {
    note(
      wrapForNote(
        warnings.map((found) => `${pc.yellow("!")} ${found.message}`).join("\n")
      ),
      `${pc.yellow("Deploy warnings")} ${pc.dim(`(${warnings.length})`)}`,
      out.tui
    );
  }
  // Two halves of the same question: a module installed that owns nothing (#107), and a
  // module that owns work but was never marked installed (#49). A core whose
  // `requiresOneOf` no installed module meets is one more (#229).
  // A third question, asked only on a project running `kv-cloudflare`: does every rate
  // limit policy registered in `packages/kv` have the `RL_<NAME>` binding its `consume`
  // resolves to (#129)?
  // A fourth: is there a leftover `.dev.vars` hiding `.env` from wrangler (#153)?
  // A fifth: is the retired Pulumi `infra/` workspace still there (ADR 0043)?
  // A sixth, asked of every project: is the superseded `BILLING_APP_NAME` still set in a
  // `.env` (#154)?
  const policyState = await readPolicyState(path, config.installed);
  const envState = await readEnvState(path);
  const findings = [
    ...checkProject({ config, manifest }),
    ...checkPartialInstalls({ installed: config.installed, manifest }),
    ...checkUnmetRequirements({ installed: config.installed, lock }),
    ...(policyState ? checkPolicyBindings(policyState) : []),
    ...checkEnv(envState),
    ...checkRetiredInfra(await hasRetiredInfra(path)),
    ...checkConfigValues(await readConfigState(path)),
  ];
  if (out.json) {
    printJson({
      base,
      findings: findings.map(findingJson),
      installed: config.installed,
      mode: "project",
      path,
      problems: findings.length,
      warnings: warnings.map(findingJson),
    });
  }
  if (findings.length === 0) {
    const count = config.installed.length;
    note(
      wrapForNote(
        config.installed.map((name) => `${pc.green("✔")} ${name}`).join("\n") ||
          pc.dim("No modules installed.")
      ),
      `Checked ${count} installed module${count === 1 ? "" : "s"}`,
      out.tui
    );
    outro(pc.green("No problems found."), out.tui);
    return EXIT_OK;
  }

  note(
    wrapForNote(
      findings
        .map((found) => `${pc.yellow(found.module)}  ${found.message}`)
        .join("\n")
    ),
    `${pc.yellow("Project state")} ${pc.dim(`(${findings.length})`)}`,
    out.tui
  );
  // The report, not a refusal: under `--json` the findings document is already on
  // stdout, so this closes the rail without a second document.
  cancel(
    `${findings.length} problem${findings.length === 1 ? "" : "s"} in ${CONFIG_FILE}.`,
    out.tui
  );
  return EXIT_REFUSED;
}

export async function runDoctor(argv: string[]): Promise<number> {
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  const out = createOutput(opts.json);
  intro(pc.bgCyan(pc.black(" saasaloy doctor ")), out.tui);

  if (opts.unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }

  const path = opts.path ?? DEFAULT_PATH;
  try {
    if (!(await pathExists(path))) {
      return out.refuse(
        `No such path: ${path} — point \`doctor\` at a module folder or at a directory of them.`,
        EXIT_REFUSED
      );
    }

    // A path carrying a `saasaloy.json` is a project, not a registry, so the project
    // rules run instead of the descriptor ones (#107). The default path is the current
    // directory, so `saasaloy doctor` picks project or registry mode by what's there.
    if (await pathExists(join(path, CONFIG_FILE))) {
      return await reportProject(path, out);
    }

    const target = await resolveDoctorTarget(path);
    if (target.names.length === 0) {
      return out.refuse(
        `No module folders in ${path} — a module folder is one that carries a registry-item.json.`,
        EXIT_REFUSED
      );
    }

    const reports = await checkTarget(target);
    const bad = reports.filter((report) => report.findings.length > 0);
    const total = bad.reduce((sum, report) => sum + report.findings.length, 0);
    if (opts.json) {
      printJson({
        mode: "registry",
        modules: reports.map((report) => ({
          findings: report.findings.map(findingJson),
          module: report.module,
          warnings: report.warnings.map(findingJson),
        })),
        path,
        problems: total,
      });
    }

    // Warnings print whatever the problems say, and none of them turns exit 0 into 2.
    const warned = reports.flatMap((report) => report.warnings);
    if (warned.length > 0) {
      note(
        wrapForNote(
          warned
            .map(
              (found) =>
                `${pc.yellow("!")} ${pc.cyan(found.module)} ${pc.yellow(found.where)}  ${found.message}`
            )
            .join("\n")
        ),
        `${pc.yellow("Warnings")} ${pc.dim(`(${warned.length})`)}`,
        out.tui
      );
    }

    if (bad.length === 0) {
      const checked = reports.map((report) => report.module);
      note(
        wrapForNote(
          checked.map((name) => `${pc.green("✔")} ${name}`).join("\n")
        ),
        `Checked ${checked.length} module${checked.length === 1 ? "" : "s"}`,
        out.tui
      );
      outro(pc.green("No problems found."), out.tui);
      return EXIT_OK;
    }

    for (const report of bad) {
      note(
        wrapForNote(renderReport(report, target.registryDir)),
        `${pc.yellow(report.module)} ${pc.dim(`(${report.findings.length})`)}`,
        out.tui
      );
    }
    log.info(
      pc.dim(
        `Checked ${reports.length} module${reports.length === 1 ? "" : "s"}; ${reports.length - bad.length} clean.`
      ),
      out.tui
    );
    cancel(
      `${total} problem${total === 1 ? "" : "s"} in ${bad.length} module${bad.length === 1 ? "" : "s"}.`,
      out.tui
    );
    return EXIT_REFUSED;
  } catch (error) {
    return out.fail(error);
  }
}
