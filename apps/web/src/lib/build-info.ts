// What the site says about its own build: the CLI version and the commit it was built from.
// The footer of every page shows both, each linked to GitHub. Production is built at a `v*`
// tag by the release hook (plan 0114, Phase 6), so there the version is the release.
//
// The commit comes from `git`, which a page cannot call: `astro dev` renders inside workerd,
// which has no `child_process` (the "Loader spike result" in PR #364). `astro.config.mjs`
// calls `readBuildInfo` in Node and hands the result to the pages through `vite.define` as
// `__BUILD_INFO__` (src/env.d.ts). src/lib/build.ts reads that constant.

import { execFileSync } from "node:child_process";

export interface BuildInfo {
  /** The CLI version from packages/cli/package.json, such as `0.9.0`. */
  version: string;
  /** The full SHA of HEAD, or undefined when git cannot say (no git, or no repository). */
  commit: string | undefined;
}

/** The build info of the checkout at `root`. A missing git or repository leaves no commit. */
export function readBuildInfo(root: string, version: string): BuildInfo {
  let commit: string | undefined;
  try {
    commit = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    commit = undefined;
  }
  return { version, commit: commit === "" ? undefined : commit };
}
