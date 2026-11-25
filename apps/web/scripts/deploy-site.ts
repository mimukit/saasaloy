// Deploys a site-only change with no CLI release (ADR 0071). The owner runs it by hand:
//
//   pnpm site:deploy [--dry-run]
//
// The site code comes from `origin/main`, so only pushed code ships. The content paths in
// `site-content.ts` come from the tag of the npm `latest` version, so the docs describe the
// CLI that `npx saasaloy` installs. The build runs in a detached worktree under the OS temp
// folder, with the content checked out from the tag on top of `main`. The reverse overlay
// pairs `main`'s apps/web/package.json with the tag's lockfile, and a frozen install fails.
// The release deploy (`deploy-release.ts`) stays the path for a docs change.
//
// `PUBLIC_CF_ANALYTICS_TOKEN` reaches the build from the shell, because a fresh worktree has
// no gitignored env file. `--dry-run` goes on to wrangler, which checks without uploading.
//
// Imports node: builtins and the content-path list. Node 24 strips the types.

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Command } from "./deploy-release.ts";
import { runAll } from "./deploy-release.ts";
import { CONTENT_PATHS } from "./site-content.ts";

/** One step of a site deploy: a name for the messages, and the command it runs. */
export interface Step {
  name: "worktree" | "content" | "install" | "build" | "deploy";
  command: Command;
}

/**
 * The tag that holds the content for npm version `version`. Throws on an empty version and
 * on a prerelease, because npm `latest` is always a stable release.
 */
export function contentTag(version: string): string {
  const trimmed = version.trim();
  if (!/^\d+\.\d+\.\d+$/.test(trimmed)) {
    throw new Error(
      `deploy:site: npm reports "${trimmed}" as the latest saasaloy version. Content comes only from a stable release, such as 0.12.0.`
    );
  }
  return `v${trimmed}`;
}

/** The steps that build `siteSha` with the content of `tag` in `worktree`, then deploy it. */
export function siteDeployPlan(
  siteSha: string,
  tag: string,
  worktree: string,
  dryRun: boolean
): Step[] {
  const sha7 = siteSha.slice(0, 7);
  return [
    {
      name: "worktree",
      command: ["git", "worktree", "add", "--detach", worktree, siteSha],
    },
    {
      name: "content",
      command: ["git", "-C", worktree, "checkout", tag, "--", ...CONTENT_PATHS],
    },
    {
      name: "install",
      command: [
        "pnpm",
        "-C",
        worktree,
        "install",
        "--frozen-lockfile",
        "--filter",
        "@saasaloy/web...",
      ],
    },
    {
      name: "build",
      command: [
        "pnpm",
        "-C",
        worktree,
        "--filter",
        "@saasaloy/web",
        "run",
        "build",
      ],
    },
    {
      name: "deploy",
      command: [
        "pnpm",
        "-C",
        worktree,
        "--filter",
        "@saasaloy/web",
        "exec",
        "wrangler",
        "deploy",
        "--tag",
        `site-${sha7}`,
        "--message",
        `site ${sha7} with content ${tag}`,
        ...(dryRun ? ["--dry-run"] : []),
      ],
    },
  ];
}

/** The command that removes the build worktree, on success and on failure. */
export function cleanupCommand(worktree: string): Command {
  return ["git", "worktree", "remove", "--force", worktree];
}

/**
 * Runs the steps in order through `run`, stops at the first failure, then always runs
 * `cleanup`, also when a step throws. Returns the exit code and the step that failed.
 */
export function runDeploy(
  steps: readonly Step[],
  cleanup: Command,
  run: (command: Command) => number
): { code: number; failed: Step | undefined; cleaned: boolean } {
  let failed: Step | undefined;
  let code = 1;
  let cleaned = false;
  try {
    code = runAll(
      steps.map((step) => step.command),
      (command) => {
        const result = run(command);
        if (result !== 0) {
          failed = steps.find((step) => step.command === command);
        }
        return result;
      }
    );
  } finally {
    cleaned = run(cleanup) === 0;
  }
  return { code, failed, cleaned };
}

/** What `main` prints before it builds. */
export function summary(
  siteSha: string,
  tag: string,
  tokenSet: boolean
): string[] {
  return [
    `deploy:site: site commit ${siteSha} (origin/main)`,
    `deploy:site: content tag ${tag}`,
    `deploy:site: PUBLIC_CF_ANALYTICS_TOKEN is ${tokenSet ? "set" : "not set, so the build has no analytics beacon"}`,
  ];
}

/** The lines `main` prints when the build step fails. */
export function buildFailure(siteSha: string, tag: string): string[] {
  return [
    `deploy:site: the build of site commit ${siteSha} with content ${tag} failed.`,
    "deploy:site: if the site change needs content newer than the release, this change waits for the next release.",
  ];
}

function capture(
  cwd: string,
  file: string,
  args: string[]
): string | undefined {
  const result = spawnSync(file, args, { cwd, encoding: "utf-8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function main(argv: string[]): number {
  const args = argv.filter((arg) => arg !== "--");
  const dryRun = args.includes("--dry-run");
  if (args.some((arg) => arg !== "--dry-run")) {
    console.error("usage: node scripts/deploy-site.ts [--dry-run]");
    return 2;
  }
  const repo = fileURLToPath(new URL("../../..", import.meta.url));
  const run = ([file, ...fileArgs]: Command): number =>
    spawnSync(file, fileArgs, { cwd: repo, stdio: "inherit" }).status ?? 1;

  if (run(["git", "fetch", "origin", "--tags"]) !== 0) {
    console.error("deploy:site: `git fetch origin --tags` failed.");
    return 1;
  }
  const version = capture(repo, "npm", ["view", "saasaloy", "version"]);
  if (version === undefined) {
    console.error("deploy:site: `npm view saasaloy version` failed.");
    return 1;
  }
  let tag: string;
  try {
    tag = contentTag(version);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  if (
    capture(repo, "git", [
      "rev-parse",
      "--verify",
      "--quiet",
      `refs/tags/${tag}`,
    ]) === undefined
  ) {
    console.error(
      `deploy:site: npm serves saasaloy ${version}, but the tag ${tag} does not exist on origin.`
    );
    return 1;
  }
  const siteSha = capture(repo, "git", ["rev-parse", "origin/main"]);
  if (siteSha === undefined) {
    console.error("deploy:site: `git rev-parse origin/main` failed.");
    return 1;
  }
  const localMain = capture(repo, "git", [
    "rev-parse",
    "--verify",
    "--quiet",
    "main",
  ]);
  if (localMain !== undefined && localMain !== siteSha) {
    console.warn(
      `deploy:site: warning: local main (${localMain.slice(0, 7)}) differs from origin/main. The deploy builds origin/main; push first to ship local commits.`
    );
  }
  for (const line of summary(
    siteSha,
    tag,
    Boolean(process.env.PUBLIC_CF_ANALYTICS_TOKEN)
  )) {
    console.log(line);
  }

  const parent = mkdtempSync(join(tmpdir(), "saasaloy-site-"));
  const worktree = join(parent, "site");
  let cleaned = false;
  try {
    const result = runDeploy(
      siteDeployPlan(siteSha, tag, worktree, dryRun),
      cleanupCommand(worktree),
      run
    );
    if (result.failed?.name === "build") {
      for (const line of buildFailure(siteSha, tag)) {
        console.error(line);
      }
    }
    ({ cleaned } = result);
    return result.code;
  } finally {
    rmSync(parent, { recursive: true, force: true });
    // A worktree that `git worktree remove` left behind is only a stale entry once its
    // folder is gone.
    if (!cleaned) {
      run(["git", "worktree", "prune"]);
    }
  }
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
