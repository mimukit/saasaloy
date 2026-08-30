import type { Plan } from "./applier.js";

// The project's design contract (`DESIGN.md`) is derived from what `packages/ui/`
// actually ships, so anything a module writes there can invalidate it. `add` uses
// this to prompt for a re-derivation.

const UI_PREFIX = "packages/ui/";

// Both halves of a plan can land in `packages/ui/`: a file the module copies in, and
// a structural patch whose target happens to live there. Only the actions that write
// count — a held or unchanged entry leaves the file as it was.
export function planWritesUi(plan: Pick<Plan, "files" | "patches">): boolean {
  const writesFile = plan.files.some(
    (file) =>
      (file.action === "create" || file.action === "overwrite") &&
      file.target.startsWith(UI_PREFIX),
  );
  if (writesFile) return true;
  return plan.patches.some((patch) => patch.action === "apply" && patch.file.startsWith(UI_PREFIX));
}
