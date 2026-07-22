import { intro, note, outro } from "@clack/prompts";
import pc from "picocolors";

// Phase 1: local applier — read a module descriptor off disk, resolve dependsOn,
// apply files + deps + patches, and copy the module's skill folder(s) into
// .claude/skills/ (recorded in the manifest so `remove` can undo them). No agent-view
// generation: AGENTS.md is the fixed base file; module guidance ships as skills.
//
// The interactive `multiselect` module picker lands with that applier, once the
// registry (modules/) carries real descriptors. Until then this is a clack-styled stub.
export async function runAdd(_argv: string[]): Promise<number> {
  intro(pc.bgCyan(pc.black(" saasaloy add ")));
  note(
    [
      `The module applier is not built yet ${pc.dim("(Phase 1)")}.`,
      `An interactive picker will land once the ${pc.cyan("modules/")} registry`,
      "carries real descriptors.",
    ].join("\n"),
    "Coming soon",
  );
  outro(pc.dim("nothing to add yet"));
  return 0;
}
