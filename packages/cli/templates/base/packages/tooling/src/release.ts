#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { deployConfig } from "./deploy.config.ts";
import { resolveConfig } from "./deploy-production.ts";
import type { ResolvedConfig } from "./deploy-production.ts";

// `pnpm release`: give the next production deploy a version and a changelog entry.
//
//   pnpm release                   the version the commits ask for, then commit, tag, push
//   pnpm release minor             or patch, major, or an exact version such as 1.2.3
//   pnpm release:dry               the version and the changelog entry; change nothing
//
// release-it does the work, with options built here from `deploy.config.ts`: the same
// branch list the deploy allows, and the `release` block for the rest. It bumps the root
// package.json version, writes CHANGELOG.md from the Conventional Commits since the last
// release, commits `chore(release): v<version>`, tags `v<version>`, pushes, and creates a
// GitHub Release. Nothing is published to npm. No `.release-it.json` is read.
//
// It never asks a question, so an agent shell does not stall on one. `pnpm release:dry`
// is the preview. Run `pnpm deploy:production` after it: the deploy names the version
// in its tag message.

export interface ReleaseArgs {
  dryRun: boolean;
  /** `patch`, `minor`, `major` or an exact version. Unset lets the commits decide. */
  increment?: string;
}

const USAGE =
  "Usage: pnpm release [patch | minor | major | <version>] [--dry-run]";

const INCREMENT = /^(?:patch|minor|major|\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/;

export function parseReleaseArgs(argv: string[]): ReleaseArgs {
  const args: ReleaseArgs = { dryRun: false };
  // pnpm passes a `--` through when the caller writes one before the flags.
  for (const arg of argv.filter((each) => each !== "--")) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--ci") {
      // The run never asks anyway. Accepted so a habit from release-it does not fail.
    } else if (INCREMENT.test(arg) && args.increment === undefined) {
      args.increment = arg;
    } else {
      throw new Error(`Unknown argument ${arg}.\n${USAGE}`);
    }
  }
  return args;
}

/** One parsed commit, as the changelog plugin hands it to `whatBump`. */
export interface BumpCommit {
  type?: string | null | undefined;
  notes: readonly unknown[];
}

/** `level` 1 is a minor bump and 2 a patch, in conventional-recommended-bump's terms. */
export interface Bump {
  level: 1 | 2;
  reason: string;
}

const PATCH_TYPES = new Set(["fix", "perf", "revert"]);

/**
 * The bump below 1.0 (`preMajor`): a breaking change or a `feat` bumps the minor, and a
 * `fix`, `perf` or `revert` bumps the patch. The preset's own `preMajor` flag shifts every
 * bump down one level, which would turn the first `feat` into `0.0.1`, so the wrapper
 * decides the level itself.
 */
export function preMajorBump(commits: readonly BumpCommit[]): Bump | null {
  const breaking = commits.filter((commit) => commit.notes.length > 0).length;
  const features = commits.filter((commit) => commit.type === "feat").length;
  if (breaking > 0 || features > 0) {
    return {
      level: 1,
      reason: `Below 1.0: ${breaking} breaking change(s) and ${features} feature(s) bump the minor.`,
    };
  }
  if (commits.some((commit) => PATCH_TYPES.has(commit.type ?? ""))) {
    return { level: 2, reason: "Below 1.0: fixes bump the patch." };
  }
  // oxlint-disable-next-line unicorn/no-null -- the plugin reads null as "no bump"
  return null;
}

/** Whether `version` is below 1.0, where `preMajor` decides the bump. */
export function belowOne(version?: string): boolean {
  return (version ?? "0.0.0").startsWith("0.");
}

/** The options release-it runs with. `config: false` keeps any config file out of it. */
export function releaseItOptions(
  config: ResolvedConfig,
  args: ReleaseArgs,
  version?: string
): Record<string, unknown> {
  const { release } = config;
  const ownBump = release.preMajor && belowOne(version);
  const tag = `${release.tagPrefix}\${version}`;
  return {
    config: false,
    ci: true,
    "dry-run": args.dryRun,
    ...(args.increment === undefined ? {} : { increment: args.increment }),
    git: {
      requireBranch: config.branches,
      // release-it commits with `git add . --update`, so a dirty tree would put another
      // change into the release commit. This check stays on.
      requireCleanWorkingDir: true,
      requireUpstream: true,
      requireCommits: true,
      commitMessage: `chore(release): ${tag}`,
      tagName: tag,
      tagAnnotation: `Release ${tag}`,
    },
    github: {
      release: release.githubRelease,
      releaseName: tag,
      tokenRef: "GITHUB_TOKEN",
    },
    npm: { publish: false },
    plugins: {
      "@release-it/conventional-changelog": {
        preset: {
          name: "conventionalcommits",
          ...(release.changelogSections === undefined
            ? {}
            : { types: release.changelogSections }),
        },
        ...(ownBump ? { whatBump: preMajorBump } : {}),
        infile: "CHANGELOG.md",
        header: "# Changelog",
      },
    },
  };
}

/** `GITHUB_TOKEN` when it is set, then the token of a signed-in `gh`. */
export function findToken(
  env: Record<string, string | undefined>,
  ghToken: () => string | undefined
): string | undefined {
  const fromEnv = env.GITHUB_TOKEN?.trim();
  return fromEnv === undefined || fromEnv === "" ? ghToken() : fromEnv;
}

/**
 * Why the release may not start, or undefined. Without a token release-it falls back to
 * a web page and waits on it, which no one opens on a headless box. A dry run creates no
 * GitHub Release, so it needs none.
 */
export function tokenProblem(
  token: string | undefined,
  config: ResolvedConfig,
  args: ReleaseArgs
): string | undefined {
  if (token !== undefined || !config.release.githubRelease || args.dryRun) {
    return undefined;
  }
  return "The release did not start, because a GitHub Release needs a token and none was found. Run: gh auth login, or set GITHUB_TOKEN. To release without a GitHub Release, set release.githubRelease to false in packages/tooling/src/deploy.config.ts.";
}

function readGhToken(): string | undefined {
  try {
    const token = execFileSync("gh", ["auth", "token"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return token === "" ? undefined : token;
  } catch {
    return undefined;
  }
}

type Release = (options: Record<string, unknown>) => Promise<unknown>;

function isRelease(value: unknown): value is Release {
  return typeof value === "function";
}

async function main(): Promise<void> {
  const args = parseReleaseArgs(process.argv.slice(2));
  const config = resolveConfig(deployConfig);
  const token = findToken(process.env, readGhToken);
  const problem = tokenProblem(token, config, args);
  if (problem !== undefined) {
    throw new Error(problem);
  }
  if (token !== undefined) {
    process.env.GITHUB_TOKEN = token;
  }
  // release-it reads git from the working directory, so run it at the repository root.
  process.chdir(
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
    }).trim()
  );
  const manifest: unknown = JSON.parse(readFileSync("package.json", "utf-8"));
  const version =
    typeof manifest === "object" &&
    manifest !== null &&
    "version" in manifest &&
    typeof manifest.version === "string"
      ? manifest.version
      : undefined;
  // Loaded here, not at the top, so a test of the functions above loads no release-it.
  // Its type file declares no default export, so the guard below gives the call a type.
  const loaded: { default?: unknown } = await import("release-it");
  if (!isRelease(loaded.default)) {
    throw new Error(
      "release-it has no default export. Run pnpm install, then pnpm release again."
    );
  }
  await loaded.default(releaseItOptions(config, args, version));
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(
      `\n${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exitCode = 1;
  }
}
