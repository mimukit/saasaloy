import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
} from "jsonc-parser";
import { inferFormatting } from "./jsonc.js";

// `jsonc-parser` edits for package.json `scripts` entries — the sibling of
// upsertPackageJsonDependency, for the case where a module needs a command runnable in a
// workspace ANOTHER module scaffolded (e.g. `database` adding `db:generate` to the app it
// wires itself into). Rewrites only the touched region, preserving the rest of the
// document's formatting.

export interface PackageJsonScript {
  /** Script key to upsert (e.g. "db:generate"). */
  name: string;
  /** Command the script runs (e.g. "drizzle-kit generate"). */
  value: string;
}

// Script keys npm and pnpm run on their own, without the user typing them: the four
// install hooks and the publish hooks. A descriptor comes from a registry the user may
// not control (third-party `owner/repo/name` coordinates are a documented form), so a
// patch that lands one of these earns arbitrary code execution on the victim's next
// `pnpm install` (#98). The denylist is exact plus the `prepublish*` family, and the
// codemod refuses rather than upserting. `install:deps` and `preparse` are ordinary
// names and stay allowed, which is why the check is equality, not a prefix scan.
// npm generates a `pre`/`post` pair around every script it runs, so blocking `prepare`
// without `preprepare` and `postprepare` leaves two keys that run on the same
// `npm install`.
const LIFECYCLE_SCRIPTS: ReadonlySet<string> = new Set([
  "install",
  "postinstall",
  "postprepare",
  "preinstall",
  "prepare",
  "preprepare",
]);

function isLifecycleScript(name: string): boolean {
  return LIFECYCLE_SCRIPTS.has(name) || name.startsWith("prepublish");
}

/**
 * Why this codemod declined to write, or `undefined` when it had no objection. Feeds
 * the patch engine's refusal table, so `add` names the rule and the key instead of
 * reporting a silent no-op.
 */
export function packageJsonScriptRefusal(
  _source: string,
  patch: PackageJsonScript
): string | undefined {
  if (!isLifecycleScript(patch.name)) {
    return undefined;
  }
  return `refusing to write the ${JSON.stringify(patch.name)} script: package managers run install and publish lifecycle keys automatically, so a module descriptor may not define one.`;
}

/**
 * Insert `name: value` into a package.json's `scripts` map, idempotently and
 * formatting-safe:
 *
 * - `name` is an install/publish lifecycle key → return `source` **unchanged**
 *   (see `packageJsonScriptRefusal` for the reason the caller reports);
 * - `scripts` missing (or holding a non-object) → create it holding `{ [name]: value }`;
 * - `scripts` present, name absent → add the entry;
 * - name already present (any command, including `""`) → return `source` **unchanged**
 *   (never clobber a command the user may have edited, matching
 *   `upsertPackageJsonDependency`).
 *
 * Every write goes to the `["scripts", name]` JSON path, so the patch kind can only ever
 * reach the scripts map — no sibling key is created, moved, or read.
 */
export function upsertPackageJsonScript(
  source: string,
  patch: PackageJsonScript
): string {
  if (isLifecycleScript(patch.name)) {
    return source;
  }

  const root = parseTree(source);
  if (!root) {
    return source;
  } // unparseable — leave it to the caller/validator to surface

  const formattingOptions = inferFormatting(source);
  const scriptsNode = findNodeAtLocation(root, ["scripts"]);

  if (scriptsNode?.type === "object") {
    const existing = getNodeValue(scriptsNode) as Record<string, unknown>;
    if (Object.hasOwn(existing, patch.name)) {
      return source;
    }

    const edits = modify(source, ["scripts", patch.name], patch.value, {
      formattingOptions,
    });
    return applyEdits(source, edits);
  }

  // No `scripts` (or a non-object value) at that key — create it fresh.
  const edits = modify(
    source,
    ["scripts"],
    { [patch.name]: patch.value },
    { formattingOptions }
  );
  return applyEdits(source, edits);
}
