import { relative, resolve, sep } from "node:path";
import { cancel, isCancel, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { abortApply } from "../engine/apply.js";
import type { ApplyReport, PathResult, ResultKind } from "../engine/apply.js";
import type { Payload } from "../engine/payload.js";
import { isLocalRegistry } from "../engine/project.js";
import type {
  ModuleCoordinate,
  ProjectState,
  SideSpec,
} from "../engine/project.js";
import { closure, fixedOrder } from "../engine/render.js";
import type { RenderOptions } from "../engine/render.js";
import { lineDiff } from "../lib/diff.js";
import { EXIT_FAILURE, EXIT_OK, RefusalError } from "../lib/exit.js";
import type { TuiOptions } from "../lib/json-output.js";
import { confirm } from "../lib/prompts.js";
import type { Graph } from "../lib/resolve.js";
import { wrapForNote } from "../lib/tui.js";

// What `add`, `remove`, `update` and `testing` share on top of `engine/apply.ts` (plan
// 0116): each command is one `apply(oldLock, newLock)`, and they print its result, ask
// before a write, and undo the last run in one way.
//
//   init     from nothing to the base template
//   add      the lock's `requested` list plus the named modules
//   remove   the list minus the named module
//   update   the same list, moved to the running CLI's release
//   testing  the same list, rendered for another testing mode
//
// Every run first refuses a journal left by an unfinished run and a file that still holds
// conflict markers, with exit 2.

export const KIND_LABEL: Record<ResultKind, string> = {
  "already-equal": pc.dim("already equal"),
  "both-no-base": pc.yellow("merge, no base"),
  clean: pc.cyan("merge"),
  conflict: pc.yellow("conflict"),
  deleted: pc.red("delete"),
  "generated-overwritten": pc.yellow("overwrite"),
  gone: pc.dim("untrack"),
  "kept-deleted": pc.yellow("left deleted"),
  new: pc.green("create"),
  "no-base": pc.yellow("merge, no base"),
  "once-kept": pc.dim("kept"),
  "once-left": pc.yellow("upstream changed"),
  restored: pc.green("restore"),
  unchanged: pc.dim("unchanged"),
  untracked: pc.dim("kept, untracked"),
  updated: pc.cyan("update"),
  "upstream-deleted-owner-edited": pc.yellow("kept, untracked"),
};

/** The results a person reads: everything but the quiet kinds. */
export function shownResults(report: ApplyReport): PathResult[] {
  return report.results.filter(
    (result) =>
      result.kind !== "unchanged" &&
      result.kind !== "already-equal" &&
      result.kind !== "gone"
  );
}

const MAX_DIFF_LINES = 60;

function renderDiff(result: PathResult): string {
  const lines = lineDiff(result.before ?? "", result.after ?? "").filter(
    (line) => line.kind !== "context"
  );
  const shown = lines
    .slice(0, MAX_DIFF_LINES)
    .map((line) =>
      line.kind === "add"
        ? pc.green(`+ ${line.text}`)
        : pc.red(`- ${line.text}`)
    );
  if (lines.length > MAX_DIFF_LINES) {
    shown.push(pc.dim(`  … ${lines.length - MAX_DIFF_LINES} more lines`));
  }
  return shown.join("\n");
}

/** One box with a line for each file the run changes or reports. */
export function summarize(
  report: ApplyReport,
  title: string,
  tui: TuiOptions
): void {
  const shown = shownResults(report);
  const body =
    shown.length === 0
      ? pc.dim("No file changes.")
      : shown
          .map((result) => `${KIND_LABEL[result.kind]}  ${result.path}`)
          .join("\n");
  note(wrapForNote(body), title, tui);
}

/** `--diff`: one box for each file whose bytes the run changes. */
export function printDiffs(report: ApplyReport, tui: TuiOptions): void {
  for (const result of report.results) {
    if (result.before === result.after) {
      continue;
    }
    note(renderDiff(result), `${KIND_LABEL[result.kind]}  ${result.path}`, tui);
  }
}

/** The report's lines: conflicts and warnings as warnings, the rest as info. */
export function printReportLines(report: ApplyReport, tui: TuiOptions): void {
  for (const line of report.lines) {
    if (line.startsWith("warning  ")) {
      log.warn(line.slice("warning  ".length), tui);
    } else if (line.startsWith("conflict  ")) {
      log.warn(line, tui);
    } else {
      log.info(line, tui);
    }
  }
}

/** One step line for each file a finished run changed or reports. */
export function printSteps(report: ApplyReport, tui: TuiOptions): void {
  for (const result of shownResults(report)) {
    log.step(`${KIND_LABEL[result.kind]}  ${result.path}`, tui);
  }
}

/** `--abort` on any command that writes: put back the newest backup. */
export async function abortRun(root: string, tui: TuiOptions): Promise<number> {
  const restored = await abortApply(root);
  for (const target of restored.restored) {
    log.step(`${pc.green("restore")}  ${target}`, tui);
  }
  for (const target of restored.removed) {
    log.step(
      `${pc.red("remove")}  ${target} ${pc.dim("(the run created it)")}`,
      tui
    );
  }
  outro(
    pc.green(
      `Restored ${restored.restored.length} file${restored.restored.length === 1 ? "" : "s"} from ${restored.from}.`
    ),
    tui
  );
  return EXIT_OK;
}

/** Ask before a write. `undefined` means go on; a number is the exit code. */
export async function confirmApply(
  yes: boolean,
  command: string,
  tui: TuiOptions
): Promise<number | undefined> {
  if (yes) {
    return undefined;
  }
  const proceed = await confirm({
    answeredBy: "`--yes` to apply, or `--dry-run` to preview",
    message: "Proceed?",
    ...(tui.output === undefined ? {} : { output: tui.output }),
  });
  if (isCancel(proceed)) {
    cancel(`${command} cancelled`, tui);
    return EXIT_FAILURE;
  }
  if (!proceed) {
    outro(pc.dim("aborted — nothing applied"), tui);
    return EXIT_OK;
  }
  return undefined;
}

/** A graph over a payload, for the checks `lib/` takes a `Graph` for. */
export function graphOf(payload: Payload, names: Iterable<string>): Graph {
  const set = [...names];
  const modules: Graph["modules"] = new Map();
  for (const name of set) {
    const mod = payload.modules.get(name);
    if (mod !== undefined) {
      modules.set(name, { dir: "", item: mod.item });
    }
  }
  return { modules, order: fixedOrder(payload.modules, set) };
}

export interface Unmet {
  declaredBy: string;
  options: string[];
}

/** Each `requiresOneOf` in the closure of `requested` that the closure does not meet. */
export function unmetRequirements(
  payload: Payload,
  requested: readonly string[]
): Unmet[] {
  const set = closure(payload, requested);
  const unmet: Unmet[] = [];
  for (const name of fixedOrder(payload.modules, set)) {
    const options = payload.modules.get(name)?.item.requiresOneOf ?? [];
    if (options.length > 0 && !options.some((option) => set.has(option))) {
      unmet.push({ declaredBy: name, options: [...options] });
    }
  }
  return unmet;
}

/** Project-relative POSIX paths for `--restore` and `--merge`, from the cwd or the root. */
export function matchPaths(
  root: string,
  paths: readonly string[],
  available: ReadonlySet<string>
): { matched: string[]; unmatched: string[] } {
  const matched: string[] = [];
  const unmatched: string[] = [];
  for (const path of paths) {
    const hit = [resolve(process.cwd(), path), resolve(root, path)]
      .map((abs) => relative(root, abs).split(sep).join("/"))
      .find(
        (candidate) =>
          candidate !== "" &&
          !candidate.startsWith("..") &&
          available.has(candidate)
      );
    if (hit === undefined) {
      unmatched.push(path);
    } else if (!matched.includes(hit)) {
      matched.push(hit);
    }
  }
  return { matched, unmatched };
}

/**
 * Refuse a run that keeps the release when the project sits at another release than the
 * running CLI: the run would move every default module too, which is `update`'s job (plan
 * 0116, "`saasaloy update <module>`"). A local registry checkout has no release, so it
 * passes.
 */
export function assertSameRelease(
  state: ProjectState,
  cliVersion: string,
  command: string
): void {
  if (isLocalRegistry() || state.version === undefined) {
    return;
  }
  if (state.version !== cliVersion) {
    throw new RefusalError(
      `This project is at saasaloy ${state.version}, and ${cliVersion} is running. ` +
        `Run \`saasaloy update\` to move it to ${cliVersion} first, or run \`pnpm dlx saasaloy@${state.version} ${command}\`. Nothing was written.`
    );
  }
}

/** The spec of one side of an apply over the project's state. */
export function sideSpec(
  state: ProjectState,
  requested: readonly string[],
  version: string,
  coordinates: ReadonlyMap<string, ModuleCoordinate> = state.coordinates,
  options: RenderOptions = state.options
): SideSpec {
  return { coordinates, options, requested, version };
}

/** A run that would write needs `--yes` when no terminal can confirm it. */
export const NO_TERMINAL_TO_CONFIRM =
  "No terminal to confirm in — re-run with `--yes` to apply, or `--dry-run` to preview.";
