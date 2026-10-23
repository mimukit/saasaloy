import { writeFile } from "node:fs/promises";
import { cancel, intro, log, outro } from "@clack/prompts";
import pc from "picocolors";
import { BASE_MODULE } from "../lib/base.js";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import {
  hashContent,
  readIfPresent,
  resolveWithinRoot,
} from "../lib/fs-utils.js";
import { runBackfill } from "../lib/backfill.js";
import { persistLedger } from "../lib/ledger.js";
import { loadLock } from "../lib/lock.js";
import { loadManifest, recordManagedFile } from "../lib/manifest.js";
import type { Manifest } from "../lib/manifest.js";
import { findProjectRoot } from "../lib/project.js";
import { CONFIG_FILE, loadConfig } from "../lib/saasaloy-config.js";
import {
  parseTestingMode,
  readTestingMode,
  rewriteTestingBlock,
  TESTING_BLOCK_END,
  TESTING_BLOCK_FILE,
  TESTING_BLOCK_START,
  TESTING_MODES,
} from "../lib/testing.js";
import type { TestingMode } from "../lib/testing.js";
import { TUI_ON_STDERR } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { reportBackfill } from "./backfill-report.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy testing [mode]` (#242, ADR 0053). With no argument it prints the project's
// mode as a bare word, so a script can read it. With a mode it saves the mode to
// `saasaloy.json` and rewrites the testing block in the root `AGENTS.md` to match: the
// value and the text an agent reads change together, or the agent follows the old rules.
//
// Three rules hold the write:
//   - only the text between the markers changes, so the owner's own rules survive;
//   - the new `AGENTS.md` hash is recorded only when the file was clean, because an
//     edited file must still read as edited to `update`, which then offers a merge;
//   - `off` deletes nothing. A test file the project holds may be the owner's own work,
//     and the CLI never deletes a file the owner may have edited (ADR 0034).

export interface Options {
  /** The mode to set, raw; absent means "print the mode". */
  mode?: string;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--help", "-h"]);
const USAGE = `saasaloy testing [${TESTING_MODES.join("|")}]`;
const HELP: CommandHelp = {
  name: "testing",
  describe: DESCRIPTIONS.testing,
  usage: USAGE,
  flags: {},
};

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
  return {
    ...(positional[0] === undefined ? {} : { mode: positional[0] }),
    unknown,
  };
}

/** What happened to the `AGENTS.md` block when the mode was set. */
export type BlockOutcome = "rewritten" | "rewritten-edited" | "no-markers";

/**
 * Rewrite the block in `root`'s `AGENTS.md` for `mode`, and record the new hash on
 * `manifest` when the file on disk was the bytes the base last recorded. Returns what it
 * did; writes no state file.
 */
export async function rewriteAgents(
  root: string,
  manifest: Manifest,
  mode: TestingMode
): Promise<BlockOutcome> {
  const path = resolveWithinRoot(root, TESTING_BLOCK_FILE);
  const content = await readIfPresent(path);
  const rewrite =
    content === undefined ? undefined : rewriteTestingBlock(content, mode);
  if (content === undefined || !rewrite?.found) {
    return "no-markers";
  }
  if (rewrite.content !== content) {
    await writeFile(path, rewrite.content, "utf-8");
  }
  const recorded = manifest.managed[TESTING_BLOCK_FILE];
  const clean =
    recorded?.module === BASE_MODULE && recorded.hash === hashContent(content);
  if (!clean) {
    return "rewritten-edited";
  }
  // An adopted entry stays adopted: its bytes were found on disk, and the block is the
  // only part of them this command can vouch for.
  recordManagedFile(manifest, {
    adopted: recorded.adopted,
    from: recorded.from,
    hash: hashContent(rewrite.content),
    module: BASE_MODULE,
    target: TESTING_BLOCK_FILE,
  });
  return "rewritten";
}

/** The line `testing` and `add` print for a block they could not keep current. */
export function reportBlockOutcome(outcome: BlockOutcome): void {
  if (outcome === "no-markers") {
    log.warn(
      `${pc.cyan(TESTING_BLOCK_FILE)} has no ${TESTING_BLOCK_START} … ${TESTING_BLOCK_END} block, ` +
        `so only ${CONFIG_FILE} changed. Put the two markers back to let the CLI keep the block current.`
    );
  } else if (outcome === "rewritten-edited") {
    log.info(
      `Rewrote the testing block in ${pc.cyan(TESTING_BLOCK_FILE)}. The file has your own edits, ` +
        `so its recorded hash is unchanged and ${pc.cyan("saasaloy update")} still treats it as edited.`
    );
  }
}

async function printMode(): Promise<number> {
  try {
    const config = await loadConfig(await findProjectRoot());
    process.stdout.write(`${readTestingMode(config)}\n`);
    return EXIT_OK;
  } catch (error) {
    // stderr, so stdout carries the mode word or nothing at all.
    cancel(formatFailure(error), TUI_ON_STDERR);
    return exitCodeFor(error);
  }
}

export async function runTesting(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }
  if (opts.unknown.length === 0 && opts.mode === undefined) {
    return printMode();
  }

  intro(pc.bgCyan(pc.black(" saasaloy testing ")));

  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  try {
    const mode = parseTestingMode(opts.mode!);
    const root = await findProjectRoot();
    const config = await loadConfig(root);
    const manifest = await loadManifest(root);
    const lock = await loadLock(root);

    const outcome = await rewriteAgents(root, manifest, mode);
    const next = { ...config, testing: { mode } };
    const failures = await persistLedger({
      config: next,
      lock,
      manifest,
      root,
    });
    const failed = failures[0];
    if (failed) {
      throw failed.error;
    }

    reportBlockOutcome(outcome);

    // An on-mode writes each gated entry whose `when` is now true and whose target is
    // untracked (#242 Q8). `testing <same-mode>` runs it again, which is how a partial
    // backfill is finished. `off` never calls it, and never deletes a written test.
    if (mode !== "off") {
      await reportBackfill(
        root,
        await runBackfill({
          config: next,
          lock,
          manifest,
          root,
        })
      );
    }

    outro(pc.green(`Testing mode: ${mode}.`));
    return EXIT_OK;
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }
}
