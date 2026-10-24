import type { Writable } from "node:stream";
import { log, note } from "@clack/prompts";
import pc from "picocolors";
import type { Plan } from "../lib/applier.js";
import type { BackfillOutcome, BackfillSkip } from "../lib/backfill.js";
import { formatPatchedFiles } from "../lib/format.js";
import { wrapForNote } from "../lib/tui.js";

// How `testing`, `add` and `update` print a backfill (#242). One wording for the three
// callers, so a held-back test file reads the same whichever command found it.

type Output = { output?: Writable } | undefined;

function reportSkips(skipped: BackfillSkip[], opts: Output): void {
  for (const skip of skipped) {
    log.warn(
      `Backfill skipped ${pc.cyan(skip.module)} — ${skip.reason}.`,
      opts
    );
  }
}

/** What a backfill would write, listed before anything is written. */
export function previewBackfill(
  plan: Plan,
  skipped: BackfillSkip[],
  opts?: Output
): void {
  const lines = [
    ...plan.files.map((f) => `  ${pc.green("create")}  ${f.target}`),
    ...plan.patches
      .filter((p) => p.action === "apply")
      .map(
        (p) =>
          `  ${pc.green("patch")}  ${p.file} ${pc.dim(`— ${p.patch.kind}`)}`
      ),
  ];
  if (lines.length > 0) {
    note(
      wrapForNote(
        `${lines.join("\n")}\n\n${pc.dim("Entries whose condition is now true. The update writes them when it applies.")}`
      ),
      "Backfill",
      opts
    );
  }
  reportSkips(skipped, opts);
}

/** What a backfill did. Prints nothing for a run that had nothing to do. */
export async function reportBackfill(
  root: string,
  outcome: BackfillOutcome,
  opts?: Output
): Promise<void> {
  const { result } = outcome;
  if (result) {
    for (const file of [...result.written, ...result.refreshed]) {
      log.step(`${pc.green("backfill")}  ${file.target}`, opts);
    }
    for (const p of result.patched) {
      log.step(
        `${pc.green("patch")}  ${p.file} ${pc.dim(`— ${p.patch.kind}`)}`,
        opts
      );
    }
    await formatPatchedFiles(
      root,
      result.patched.map((p) => p.file)
    );
    for (const p of result.patchConflicts) {
      log.warn(
        `Config patch target ${pc.cyan(p.file)} missing — ${p.patch.kind} skipped.`,
        opts
      );
    }
    for (const r of result.patchRefusals) {
      log.warn(
        `Config patch on ${pc.cyan(r.patch.file)} skipped — ${r.reason}. Wire it by hand.`,
        opts
      );
    }
    const held = [...result.heldBack, ...result.lateDrift];
    if (held.length > 0) {
      note(
        wrapForNote(
          `${held.map((f) => `  ${pc.yellow("conflict → merge")}  ${f.target}`).join("\n")}\n\n${pc.dim("A file you own already sits at each target, so the backfill left it alone. Merge the module's version in by hand.")}`
        ),
        "Needs merge",
        opts
      );
    }
  }
  reportSkips(outcome.skipped, opts);
}
