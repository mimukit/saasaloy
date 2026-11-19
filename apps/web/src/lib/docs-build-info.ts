// What the docs header says about the build: the CLI version, and whether the build is a
// release. Production is built at a `v*` tag by the release hook (plan 0114, Phase 6), so a
// build whose HEAD is not a tag, such as `astro dev` or a PR build, shows one banner: "Built
// from `main`, N commits after v<latest>".
//
// The facts come from `git`, which a page cannot call: `astro dev` renders inside workerd, which
// has no `child_process` (the spike in .afkkit/groups/g2-spike.md). `astro.config.mjs` calls
// `readBuildInfo` in Node and hands the result to the pages through `vite.define`.
//
// `describeBuild` holds the decisions and takes the git answers as arguments, so a
// node:test file covers each case, including a shallow clone, without a repository.

import { execFileSync } from "node:child_process";

/** What the layout needs to draw the version label and the banner. */
export interface BuildInfo {
  /** The CLI version from packages/cli/package.json, such as `0.9.0`. */
  version: string;
  /**
   * The banner, or undefined at a `v*` tag. `tag` is the latest `v*` tag; `count` is how
   * many commits the build has after it, or undefined when git cannot say.
   */
  banner: { tag: string; count: number | undefined } | undefined;
}

/** The git answers `describeBuild` needs. An undefined answer means git could not say. */
export interface GitFacts {
  /** The `v*` tag at HEAD, from `git describe --exact-match --tags --match "v*"`. */
  exactTag: string | undefined;
  /** The nearest `v*` tag behind HEAD, from `git describe --tags --abbrev=0 --match "v*"`. */
  latestTag: string | undefined;
  /** `git rev-list --count <latestTag>..HEAD`. */
  count: number | undefined;
  /** `git rev-parse --is-shallow-repository`. */
  shallow: boolean;
}

/**
 * The build info for `version` and the git facts. At a tag there is no banner. Otherwise the
 * banner names the latest tag, falling back to the package's own version when no tag is
 * reachable. A shallow clone has no history to count, so its banner drops the count and
 * says "after v<tag>" instead of showing a wrong number. CI checks out with `fetch-depth: 0`
 * (.github/workflows/site.yml), so this is the fallback for a local shallow clone.
 */
export function describeBuild(version: string, git: GitFacts): BuildInfo {
  if (git.exactTag !== undefined) {
    return { version, banner: undefined };
  }
  const tag = git.latestTag ?? `v${version}`;
  const count =
    git.shallow || git.latestTag === undefined ? undefined : git.count;
  return { version, banner: { tag, count } };
}

function tryGit(root: string, args: string[]): string | undefined {
  try {
    const out = execFileSync("git", args, {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return out === "" ? undefined : out;
  } catch {
    return undefined;
  }
}

/** The git facts of the checkout at `root`. Every call tolerates a missing git or history. */
export function readGitFacts(root: string): GitFacts {
  const tag = (...args: string[]) =>
    tryGit(root, ["describe", "--tags", "--match", "v*", ...args]);
  const latestTag = tag("--abbrev=0");
  const count =
    latestTag === undefined
      ? undefined
      : Number(tryGit(root, ["rev-list", "--count", `${latestTag}..HEAD`]));
  return {
    exactTag: tag("--exact-match"),
    latestTag,
    count: Number.isInteger(count) ? count : undefined,
    shallow: tryGit(root, ["rev-parse", "--is-shallow-repository"]) === "true",
  };
}

/** The build info of the checkout at `root`, for `astro.config.mjs`. */
export function readBuildInfo(root: string, version: string): BuildInfo {
  return describeBuild(version, readGitFacts(root));
}
