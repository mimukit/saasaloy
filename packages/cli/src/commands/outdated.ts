import { cancel, intro, log, note, outro } from "@clack/prompts";
import pc from "picocolors";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { loadLock } from "../lib/lock.js";
import { findProjectRoot } from "../lib/project.js";
import { REGISTRY_ENV, RemoteRegistrySource } from "../lib/registry.js";
import type { RegistrySource } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import { wrapForNote } from "../lib/tui.js";
import { compareInstalled } from "../lib/updater.js";
import type { ModuleComparison, UpdateStatus } from "../lib/updater.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy outdated` — "has anything moved?", answered without touching a file (#50).
//
// The lock already records the exact SHA every installed module resolved to, so the
// answer is one `compareInstalled` call away — the same call `update` opens with. Before
// this command there was no way to ask, which made `update` a thing you ran speculatively
// and then read a merge plan to find out it had nothing to do.
//
// It is a report, so a bare run exits 0 whatever it finds: "three modules moved" is news,
// not a failure. `--check` is the CI form — it exits 2 when anything is outdated, so a
// pipeline can gate on drift without parsing the table.
//
// An unreachable source is a row, never a throw. One dead repo must not hide the state of
// every other module, and it does not fail `--check` either: a network blip is not drift.

export interface Options {
  /** `--check`: exit non-zero when any module has moved, for CI. */
  check: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--check", "--help", "-h"]);
const USAGE = "saasaloy outdated [--check]";
const HELP: CommandHelp = {
  name: "outdated",
  describe: DESCRIPTIONS.outdated,
  usage: USAGE,
  flags: {
    "--check": "exit non-zero when any module has moved (for CI)",
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
  return { check: argv.includes("--check"), unknown };
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
    return [pc.dim("Nothing installed — `saasaloy add <module>` first.")];
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
 * How many modules moved. Only `outdated` counts: a pinned module is frozen on purpose, a
 * local one has no commit to compare, and an unresolvable one is a failure to answer
 * rather than an answer — gating CI on any of the three would fail builds for no drift.
 */
export function countDrift(comparisons: ModuleComparison[]): number {
  return comparisons.filter((c) => c.status === "outdated").length;
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

  intro(pc.bgCyan(pc.black(" saasaloy outdated ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  const sources: RegistrySource[] = [];
  try {
    const root = await findProjectRoot();
    const config = await loadConfig(root);
    if (config.installed.length === 0) {
      note(wrapForNote(renderComparisons([]).join("\n")), "Modules");
      outro(pc.dim("0 modules"));
      return EXIT_OK;
    }

    const lock = await loadLock(root);
    const registryOverride = !!process.env[REGISTRY_ENV];
    if (registryOverride) {
      log.warn(
        `${REGISTRY_ENV} is set, so every module reads as local — unset it to compare against the registry.`
      );
    }

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

    const comparisons = await compareInstalled({
      installed: config.installed,
      lock,
      registryOverride,
      resolveRef: (_name, entry, ref) => remote(entry.source, ref).resolveSha(),
    });

    note(wrapForNote(renderComparisons(comparisons).join("\n")), "Modules");

    const drift = countDrift(comparisons);
    if (drift === 0) {
      outro(pc.green("Everything is up to date."));
      return EXIT_OK;
    }

    const summary = `${drift} module${drift === 1 ? "" : "s"} moved — run \`saasaloy update\` to apply.`;
    // `--check` is the only thing that turns news into a non-zero exit. A bare run is a
    // report, and a report that failed the shell would be unusable interactively.
    if (opts.check) {
      cancel(summary);
      return EXIT_REFUSED;
    }
    outro(pc.yellow(summary));
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  } finally {
    for (const source of sources) {
      await source.cleanup?.();
    }
  }
}
