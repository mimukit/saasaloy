import { intro, note, outro } from "@clack/prompts";
import pc from "picocolors";

// Phase 1: list module descriptors discovered in the registry (local modules/ dir).
// The registry is intentionally empty until Phase 1 modules (api, database, waitlist)
// land, so for now this renders a clack-styled empty state.
export async function runList(_argv: string[]): Promise<number> {
  intro(pc.bgCyan(pc.black(" saasaloy list ")));
  note(
    [
      `No modules available yet ${pc.dim("(Phase 1)")}.`,
      `Capability + feature modules will populate the ${pc.cyan("modules/")} registry`,
      `${pc.dim("— api · database · waitlist first.")}`,
    ].join("\n"),
    "Registry",
  );
  outro(pc.dim("0 modules"));
  return 0;
}
