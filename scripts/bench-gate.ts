// Which release needs an agent benchmark run, and which score report clears it (plan 0109,
// "Which releases need a run"; issue #347). `scripts/release-preflight.ts` calls it.
//
// The rule. A release whose changed paths since the last tag touch a base skill, the
// unattended CLI contract or a module of the MVP set needs a score report for every
// benchmark brief, run in interview mode, at a revision that covers the release, with no
// FAIL line. Any other release needs no report.
//
// The definitions:
//   - A base skill: any file under `packages/cli/templates/base/_agents/skills/`.
//   - The unattended CLI contract: the files that hold ADR 0046's no-TTY refusals, the
//     exit codes, the `--json` documents, `env --from-file` and `list --json`; the
//     `UNATTENDED_CLI_CONTRACT` list below. Their tests are not the contract.
//   - The MVP set: `MVP_MODULES` in `scripts/scaffold-check.ts`, the list the `scaffold`
//     CI job builds; a module is any file under `modules/<name>/`.
//   - A benchmark brief: each folder under `scripts/agent-bench/briefs/`.
//   - A score report: a file in `docs/research/` named
//     `NNNN-research-agent-bench-<slug>-YYYY-MM-DD.md`. It holds one `score.md` of
//     `scripts/agent-bench.ts` for each brief, whose `Brief:`, `Mode:` and `Revision:` lines
//     the gate reads, and a FAIL line is a table row whose result is FAIL or a line that
//     starts with `FAIL`.
//   - A report covers the release when, for each brief, its revision is an ancestor of HEAD
//     and no gated path changed between that revision and HEAD. The newest covering report
//     decides.
//
// Imports node: builtins and the scaffold check's module list. Node 24 strips the types.

import { readdirSync } from "node:fs";
import { join } from "node:path";

import { MVP_MODULES } from "./scaffold-check.ts";

/** The base template's skills folder. */
export const BASE_SKILLS = "packages/cli/templates/base/_agents/skills/";

/** The files that hold the CLI's unattended contract (ADR 0046). */
export const UNATTENDED_CLI_CONTRACT = [
  "packages/cli/src/lib/prompts.ts",
  "packages/cli/src/lib/tui.ts",
  "packages/cli/src/lib/exit.ts",
  "packages/cli/src/lib/json-output.ts",
  "packages/cli/src/commands/env.ts",
  "packages/cli/src/commands/list.ts",
] as const;

/** The changed paths that make a release need a benchmark run. */
export function gatedPaths(changed: readonly string[]): string[] {
  const contract = new Set<string>(UNATTENDED_CLI_CONTRACT);
  const modules = MVP_MODULES.map((name) => `modules/${name}/`);
  return changed.filter(
    (path) =>
      path.startsWith(BASE_SKILLS) ||
      contract.has(path) ||
      modules.some((prefix) => path.startsWith(prefix))
  );
}

/** The benchmark briefs: the folders under `scripts/agent-bench/briefs/`, sorted. */
export function benchBriefs(root: string): string[] {
  return readdirSync(join(root, "scripts", "agent-bench", "briefs"), {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();
}

/** Where score reports live, and their file name. */
export const REPORT_DIR = join("docs", "research");
export const REPORT_NAME =
  /^\d{4}-research-agent-bench-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.md$/;

export interface BriefScore {
  brief: string;
  mode?: string;
  revision?: string;
}

export interface BenchReport {
  file: string;
  briefs: BriefScore[];
  /** Each FAIL line, as written. */
  fails: string[];
}

const FAIL_ROW = /\|\s*FAIL\s*\|/;

/** Reads a score report: each `Brief:` block's mode and revision, and every FAIL line. */
export function parseBenchReport(file: string, text: string): BenchReport {
  const report: BenchReport = { file, briefs: [], fails: [] };
  for (const line of text.split(/\r?\n/)) {
    const brief = /^Brief:\s*(\S+)\s*$/.exec(line)?.[1];
    if (brief) {
      report.briefs.push({ brief });
      continue;
    }
    const current = report.briefs.at(-1);
    const mode = /^Mode:\s*(\S+)\s*$/.exec(line)?.[1];
    if (current && mode && current.mode === undefined) {
      current.mode = mode;
    }
    const revision = /^Revision:\s*([0-9a-f]{7,40})\s*$/.exec(line)?.[1];
    if (current && revision && current.revision === undefined) {
      current.revision = revision;
    }
    if (FAIL_ROW.test(line) || /^FAIL\b/.test(line)) {
      report.fails.push(line);
    }
  }
  return report;
}

/** Why `report` does not cover the release for `briefs`; empty when it does. */
function coverProblems(
  report: BenchReport,
  briefs: readonly string[],
  covers: (revision: string) => boolean
): string[] {
  const problems: string[] = [];
  for (const brief of briefs) {
    const score = report.briefs.find((entry) => entry.brief === brief);
    if (!score) {
      problems.push(`no score for the brief ${brief}`);
    } else if (score.mode !== "interview") {
      problems.push(
        `${brief} ran in ${score.mode ?? "an unnamed"} mode, not interview`
      );
    } else if (!score.revision) {
      problems.push(`${brief} names no Revision`);
    } else if (!covers(score.revision)) {
      problems.push(
        `${brief} scored ${score.revision}, which is not an ancestor of HEAD or comes before a change to a gated path`
      );
    }
  }
  return problems;
}

export interface BenchmarkCheck {
  /** The changed paths that need a run; empty means the release needs no report. */
  needed: string[];
  /** The report that cleared the release. */
  cleared?: string;
  /** Why the release is refused; empty when it may go. */
  problems: string[];
}

export function checkBenchmark(input: {
  changed: readonly string[];
  reports: readonly BenchReport[];
  briefs: readonly string[];
  covers: (revision: string) => boolean;
}): BenchmarkCheck {
  const needed = gatedPaths(input.changed);
  if (needed.length === 0) {
    return { needed, problems: [] };
  }
  const newestFirst = input.reports.toSorted((a, b) =>
    b.file.localeCompare(a.file)
  );
  const covering = newestFirst.find(
    (report) => coverProblems(report, input.briefs, input.covers).length === 0
  );
  if (covering) {
    return covering.fails.length === 0
      ? { needed, cleared: covering.file, problems: [] }
      : {
          needed,
          problems: covering.fails.map(
            (line) => `${covering.file}: ${line.trim()}`
          ),
        };
  }
  const newest = newestFirst[0];
  return {
    needed,
    problems: newest
      ? coverProblems(newest, input.briefs, input.covers).map(
          (problem) => `${newest.file}: ${problem}`
        )
      : [
          `no score report in ${REPORT_DIR}/ (NNNN-research-agent-bench-<slug>-YYYY-MM-DD.md)`,
        ],
  };
}

/** What to print when the release needs a run and has no clean report. */
export function benchmarkMessage(check: BenchmarkCheck): string {
  return [
    "this release changes paths that need an agent benchmark run:",
    ...check.needed.slice(0, 10).map((path) => `  ${path}`),
    ...(check.needed.length > 10
      ? [`  and ${String(check.needed.length - 10)} more`]
      : []),
    "and no score report clears it:",
    ...check.problems.map((problem) => `  ${problem}`),
    "  Run `node scripts/agent-bench.ts --interview --brief <name>` for each brief,",
    "  save the three score.md files in one docs/research/ report, and commit it.",
    '  CONTRIBUTING.md, "Before you run it", has the rule.',
  ].join("\n");
}
