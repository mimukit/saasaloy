import { cancel, intro, note, outro } from "@clack/prompts";
import pc from "picocolors";
import {
  createRegistrySource,
  parseCoordinate,
  REGISTRY_ENV,
  type RegistrySource,
} from "../lib/registry.js";

// `saasaloy list [owner/repo[@ref]]` — enumerate the modules a registry offers, the same
// seam `add`'s picker reads from. With no argument it lists the default repo (or the local
// modules/ checkout when SAASALOY_REGISTRY_DIR is set); an `owner/repo` coordinate lists a
// third-party registry. Names only — matching the picker — so it stays a cheap, one-call
// lookup (no per-module descriptor fetch).
export async function runList(argv: string[]): Promise<number> {
  intro(pc.bgCyan(pc.black(" saasaloy list ")));

  const positional = argv.filter((arg) => !arg.startsWith("-"));

  let source: RegistrySource | undefined;
  try {
    const coord = parseCoordinate(positional[0]);
    source = createRegistrySource(coord);
    if (process.env[REGISTRY_ENV] && (coord.owner || coord.repo)) {
      note(
        `Ignoring source "${coord.owner}/${coord.repo}" — ${REGISTRY_ENV} override is set.`,
        pc.yellow("Warning"),
      );
    }

    const modules = await source.listModules();
    if (modules.length === 0) {
      note(`No modules found in ${source.label}.`, "Registry");
      outro(pc.dim("0 modules"));
      return 0;
    }

    note(modules.map((name) => pc.cyan(name)).join("\n"), `Modules ${pc.dim(`(${source.label})`)}`);
    outro(pc.dim(`${modules.length} module${modules.length === 1 ? "" : "s"}`));
    return 0;
  } catch (error) {
    cancel(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await source?.cleanup?.();
  }
}
