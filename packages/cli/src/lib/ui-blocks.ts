// A module that ships UI writes a **block** into the ui package's blocks folder, exactly
// like every block the base ships, and nothing puts it on a page. There is no descriptor
// field for that: the signal is the target itself, `@ui/blocks/<name>.tsx`, and the
// convention is the alias prefix (ADR 0030). `add` reads it to print the wire-up pointer,
// `remove` reads it to say what deleting the file does not undo.
//
// The check runs against the *resolved* target, because that is what a plan carries by
// the time either command reports on it — so resolve the folder back through the same
// alias map the applier used rather than hardcoding one project layout.

const UI_ALIAS = "@ui";
const BLOCKS_DIR = "blocks";

// What `saasaloy init` writes into a fresh project's saasaloy.json. A project that has
// dropped the alias still gets a truthful answer for the layout the base ships.
const DEFAULT_UI_ROOT = "packages/ui/src";

/** The project-relative POSIX prefix every ui block target starts with. */
export function uiBlocksPrefix(aliases: Record<string, string>): string {
  return `${aliases[UI_ALIAS] ?? DEFAULT_UI_ROOT}/${BLOCKS_DIR}/`;
}

/**
 * The subset of `files` that land in the ui package's blocks folder. Generic over the
 * caller's own file type so `add` keeps its `module` and `remove` keeps its action.
 */
export function uiBlockFiles<T extends { target: string }>(
  files: readonly T[],
  aliases: Record<string, string>
): T[] {
  const prefix = uiBlocksPrefix(aliases);
  return files.filter((file) => file.target.startsWith(prefix));
}
