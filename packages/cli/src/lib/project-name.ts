import { basename } from "node:path";
import { readRootPackageJson } from "./pkg-json.js";
import type { SaasaloyConfig } from "./schema.js";

// The project's own name, and the one place that decides where it comes from.
//
// `{{PROJECT_NAME}}` is substituted into `package.json`, `wrangler.jsonc` and `siteName`
// when `init` renders the template. `update` re-renders the same template to compare
// against, so it must substitute the same value — and it used to call `basename(root)`
// for it. A git worktree, a renamed folder or a CI checkout path each have a directory
// name that is not the project's, so every one of those identity values was rewritten to
// the folder's name. A `wrangler.jsonc` rename is worse than cosmetic: it deploys a
// second Worker instead of updating the existing one.
//
// The order below is provenance, best first: what `init` recorded, then what the project
// calls itself, then the directory as a last resort for a project scaffolded before
// either was written.

/** Where the resolved name came from, for the one-line warning the fallback deserves. */
export type ProjectNameSource = "config" | "package.json" | "directory";

export interface ResolvedProjectName {
  name: string;
  source: ProjectNameSource;
}

export async function resolveProjectName(
  root: string,
  config: Pick<SaasaloyConfig, "name">
): Promise<ResolvedProjectName> {
  if (config.name) {
    return { name: config.name, source: "config" };
  }
  const pkg = await readRootPackageJson(root);
  const pkgName = typeof pkg?.name === "string" ? pkg.name : undefined;
  if (pkgName) {
    return { name: pkgName, source: "package.json" };
  }
  return { name: basename(root), source: "directory" };
}
