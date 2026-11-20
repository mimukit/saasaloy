import { cancel, intro, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import { readManifestState } from "../engine/manifest.js";
import { loadSide, readProjectState } from "../engine/project.js";
import { render } from "../engine/render.js";
import { BASE_MODULE } from "../lib/base.js";
import { EXIT_OK, EXIT_REFUSED, formatFailure } from "../lib/exit.js";
import { hashContent, pathExists, resolveWithinRoot } from "../lib/fs-utils.js";
import { createOutput, printJson } from "../lib/json-output.js";
import { loadLock } from "../lib/lock.js";
import { loadManifest } from "../lib/manifest.js";
import type { PendingNote } from "../lib/manifest.js";
import { compareBase, compareModules } from "../lib/outdated.js";
import type { ModuleComparison, UpdateStatus } from "../lib/outdated.js";
import {
  pendingLabel,
  pendingNoteJson,
  pendingNoteLines,
} from "../lib/pending-notes.js";
import { findProjectRoot } from "../lib/project.js";
import { REGISTRY_ENV, RemoteRegistrySource } from "../lib/registry.js";
import type { RegistrySource } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import { wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import { sideSpec } from "./apply-run.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy outdated` — "has anything moved?", answered without touching a file (#50).
//
// The default registry moves as one release (ADR 0062, plan 0116): the base template and
// every default module stand at the lock's `base.cliVersion`, and `update` moves them to
// the running CLI's release. A module from another registry moves on its own ref, so its
// row resolves that ref and compares the commit with the lock's.
//
// It is a report, so a bare run exits 0 whatever it finds. `--check` is the CI form: it
// exits 2 when anything moved or an update note is pending. An unreachable source is a
// row, never a throw, and it does not fail `--check`: a network blip is not drift.
//
// It also lists each file written once (a `once` file) whose upstream render differs from
// the render that wrote it (plan 0116): `update --merge <path>` takes that change. The
// list is news, not drift, so `--check` does not gate on it. `--json` prints the rows,
// `drift`, `pendingNotes` and `onceChanged` as one document on stdout (#223).

export interface Options {
  /** `--check`: exit non-zero when any module has moved or a note is pending, for CI. */
  check: boolean;
  /** `--json`: one JSON document on stdout, the TUI on stderr. */
  json: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--check", "--json", "--help", "-h"]);
const USAGE = "saasaloy outdated [--check] [--json]";
const HELP: CommandHelp = {
  name: "outdated",
  describe: DESCRIPTIONS.outdated,
  usage: USAGE,
  flags: {
    "--check":
      "exit non-zero when the base template or any module has moved, or an update note is pending (for CI)",
    "--json": "print the rows as one JSON document on stdout",
  },
};

export function parseArgs(argv: string[]): Options {
  const unknown: string[] = [];
  for (const arg of argv) {
    // The report covers every installed module; there is no single-module form to name.
    if (!arg.startsWith("-") || !KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  return {
    check: argv.includes("--check"),
    json: argv.includes("--json"),
    unknown,
  };
}

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

/** A 40-hex value is a commit; anything else (`local`, `unknown`) is printed as it stands. */
function short(value: string): string {
  return SHA_PATTERN.test(value) ? value.slice(0, 7) : value;
}

// Colour carries the same meaning it does in `update`'s summary: green is settled, yellow
// is work waiting, red is a question the tool could not answer, dim is deliberately frozen.
const STATUS_COLOR: Record<UpdateStatus, (text: string) => string> = {
  current: pc.green,
  outdated: pc.yellow,
  pinned: pc.dim,
  local: pc.dim,
  unresolvable: pc.red,
  untracked: pc.yellow,
};

const HEADERS = ["MODULE", "STATUS", "REF", "CURRENT", "LATEST"] as const;

function cells(comparison: ModuleComparison): string[] {
  return [
    comparison.name,
    comparison.status,
    short(comparison.ref),
    short(comparison.current),
    short(comparison.latest),
  ];
}

/**
 * The table, one row per module, plus an indented note under every row carrying a
 * `detail` — which is every status but `current` and `outdated`, so a `local` entry says
 * it was skipped and an unreachable one says why.
 *
 * Pure and exported so the renderer is tested against a stubbed comparison covering all
 * five statuses, with no network and no project on disk. Alignment is measured on the
 * plain strings and colour applied after, or the escape codes would count as width.
 */
export function renderComparisons(comparisons: ModuleComparison[]): string[] {
  if (comparisons.length === 0) {
    return [pc.dim("No modules installed — `saasaloy add <module>` first.")];
  }

  const rows = comparisons.map(cells);
  const widths = HEADERS.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0))
  );
  const pad = (text: string, column: number): string =>
    text.padEnd(widths[column] ?? 0);

  const lines = [
    pc.dim(
      HEADERS.map((header, column) => pad(header, column))
        .join("  ")
        .trimEnd()
    ),
  ];
  for (const [index, row] of rows.entries()) {
    const comparison = comparisons[index]!;
    const color = STATUS_COLOR[comparison.status];
    lines.push(
      [
        pc.cyan(pad(row[0]!, 0)),
        color(pad(row[1]!, 1)),
        pc.dim(pad(row[2]!, 2)),
        pad(row[3]!, 3),
        comparison.status === "outdated"
          ? pc.yellow(pad(row[4]!, 4))
          : pad(row[4]!, 4),
      ]
        .join("  ")
        .trimEnd()
    );
    if (comparison.detail) {
      // A leading-space indent would not survive `wrapForNote`, which splits on spaces
      // and drops the empty leading words. A glyph carries the "belongs to the row above"
      // relationship through the wrap.
      lines.push(pc.dim(`  ↳ ${comparison.detail}`));
    }
  }
  return lines;
}

/**
 * How many rows moved, the base included. Only `outdated` counts: a pinned module is
 * frozen on purpose, a local one has no commit to compare, an unresolvable one is a
 * failure to answer rather than an answer, and an untracked base has nothing to compare
 * yet — gating CI on any of the four would fail builds for no drift.
 */
export function countDrift(comparisons: ModuleComparison[]): number {
  return comparisons.filter((c) => c.status === "outdated").length;
}

/** The closing line for a report with drift: which of the base and the modules moved. */
export function describeDrift(comparisons: ModuleComparison[]): string {
  const baseMoved = comparisons.some(
    (c) => c.name === BASE_MODULE && c.status === "outdated"
  );
  const modules = comparisons.filter(
    (c) => c.name !== BASE_MODULE && c.status === "outdated"
  ).length;
  const moduleText = `${modules} module${modules === 1 ? "" : "s"}`;
  const subject = baseMoved
    ? modules > 0
      ? `The base template and ${moduleText}`
      : "The base template"
    : moduleText;
  return `${subject} moved — run \`saasaloy update\` to apply.`;
}

/**
 * The `once` files on disk whose record differs from the project's render at the running
 * CLI's release: upstream changed what it would write there. Only a version 2 project
 * has class records.
 */
async function onceChangedUpstream(
  root: string,
  running: string
): Promise<string[]> {
  const state = await readProjectState(root);
  const once: [string, string][] = [];
  for (const [path, record] of Object.entries(state.manifest.files)) {
    if (
      record.class === "once" &&
      (await pathExists(resolveWithinRoot(root, path)))
    ) {
      once.push([path, record.hash]);
    }
  }
  if (once.length === 0) {
    return [];
  }
  const { side } = await loadSide(
    { ...sideSpec(state, state.requested, running), partial: true },
    { cliVersion: running }
  );
  const rendered = render(side);
  return once
    .filter(([path, hash]) => {
      const file = rendered.files.get(path);
      return file !== undefined && hashContent(file.content) !== hash;
    })
    .map(([path]) => path);
}

function splitSlug(slug: string): [string, string] | undefined {
  const parts = slug.split("/");
  return parts.length === 2 && parts[0] && parts[1]
    ? [parts[0], parts[1]]
    : undefined;
}

export async function runOutdated(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  const out = createOutput(opts.json);
  intro(pc.bgCyan(pc.black(" saasaloy outdated ")), out.tui);

  if (opts.unknown.length > 0) {
    return out.refuse(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }

  const sources: RegistrySource[] = [];
  try {
    const root = await findProjectRoot();
    const config = await loadConfig(root);
    const lock = await loadLock(root);
    const manifestState = await readManifestState(root);
    const versionOne = manifestState.kind === "v1";
    const pending: PendingNote[] = versionOne
      ? ((await loadManifest(root)).pendingNotes ?? [])
      : manifestState.kind === "v2"
        ? manifestState.manifest.pendingNotes
        : [];
    const registryOverride = !!process.env[REGISTRY_ENV];
    if (registryOverride && config.installed.length > 0) {
      log.warn(
        `${REGISTRY_ENV} is set, so every module reads as local — unset it to compare against the registry.`,
        out.tui
      );
    }

    // The base first: it is the one row every project has.
    const runningVersion = await readVersion();
    const baseRow = compareBase({ lock, running: runningVersion, versionOne });

    // One source per (repo, ref), the same cache `update` keeps, so a bare run resolves
    // each ref once however many modules share it.
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

    let moduleRows: ModuleComparison[] = [];
    if (config.installed.length > 0) {
      moduleRows = await compareModules({
        installed: config.installed,
        lock,
        registryOverride,
        resolveRef: (_name, entry, ref) =>
          remote(entry.source, ref).resolveSha(),
        running: runningVersion,
      });
    }

    note(wrapForNote(renderComparisons([baseRow]).join("\n")), "Base", out.tui);
    note(
      wrapForNote(renderComparisons(moduleRows).join("\n")),
      "Modules",
      out.tui
    );

    // Files written once that upstream changed: `update --merge <path>` takes the change.
    let onceChanged: string[] = [];
    if (manifestState.kind === "v2") {
      try {
        onceChanged = await onceChangedUpstream(root, runningVersion);
      } catch (error) {
        log.warn(
          `Could not render saasaloy ${runningVersion} to compare the files written once: ${formatFailure(error)}`,
          out.tui
        );
      }
    }
    if (onceChanged.length > 0) {
      note(
        wrapForNote(
          onceChanged
            .map(
              (path) =>
                `${path} ${pc.dim(`— \`saasaloy update --merge ${path}\` merges it`)}`
            )
            .join("\n")
        ),
        "Written once, changed upstream",
        out.tui
      );
    }

    // Update notes an applied `update` showed and nobody cleared (#298): work waiting, read
    // offline from the manifest.
    if (pending.length > 0) {
      note(
        wrapForNote(pendingNoteLines(pending).join("\n")),
        "Pending update notes",
        out.tui
      );
    }

    const comparisons = [baseRow, ...moduleRows];
    const drift = countDrift(comparisons);
    if (opts.json) {
      printJson({
        base: baseRow,
        drift,
        modules: moduleRows,
        onceChanged,
        pendingNotes: pending.map(pendingNoteJson),
      });
    }
    if (drift === 0 && pending.length === 0) {
      if (registryOverride && moduleRows.length > 0) {
        // Nothing was compared, so there is nothing to gate on — `--check` exits 0 too.
        outro(
          pc.dim("Nothing to compare — every module reads as local."),
          out.tui
        );
      } else if (baseRow.status === "untracked") {
        outro(
          pc.yellow(
            "Modules are up to date; the base is untracked — run `saasaloy update` to record it."
          ),
          out.tui
        );
      } else {
        outro(pc.green("Everything is up to date."), out.tui);
      }
      return EXIT_OK;
    }

    const summary = [
      ...(drift > 0 ? [describeDrift(comparisons)] : []),
      ...(pending.length > 0
        ? [
            `${pendingLabel(pending.length)} — do the work, then \`saasaloy update --done <id>\`.`,
          ]
        : []),
    ].join(" ");
    // `--check` is the only thing that turns news into a non-zero exit. A bare run is a
    // report, and a report that failed the shell would be unusable interactively.
    if (opts.check) {
      // The report is already on stdout under `--json`; this only closes the rail.
      cancel(summary, out.tui);
      return EXIT_REFUSED;
    }
    outro(pc.yellow(summary), out.tui);
    return EXIT_OK;
  } catch (error) {
    return out.fail(error);
  } finally {
    for (const source of sources) {
      await source.cleanup?.();
    }
  }
}
