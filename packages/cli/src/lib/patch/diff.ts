import { createTwoFilesPatch } from "diff";

// Every patch is `--dry-run`/`--diff`-able (build spec §3.4): the engine is pure and
// always hands back a unified diff of what it *would* write, so the applier can show
// it and decide whether to commit the change to disk.

/**
 * Render a unified diff between `before` and `after` for `filename`.
 * Returns `""` when the two are identical — the signal an applier uses to
 * report "nothing to do" and never touch the file (idempotent re-run).
 */
export function toDiff(before: string, after: string, filename: string): string {
  if (before === after) return "";
  // Same path on both sides: this is an in-place edit, not a rename.
  const patch = createTwoFilesPatch(filename, filename, before, after, "", "");
  // Drop the leading `Index:`-style banner createPatch would add; createTwoFilesPatch
  // starts straight at the `---`/`+++` header, which is what we want to surface.
  return patch;
}
