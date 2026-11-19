// Deploys the site for one release (plan 0114, Phase 6). The release hook in
// `packages/cli/.release-it.js` runs it on the owner's machine after release-it has tagged,
// pushed and created the GitHub Release:
//
//   pnpm --filter @saasaloy/web run deploy:release -- v0.9.0
//
// It builds the site, then runs `wrangler deploy --tag v0.9.0 --message "saasaloy v0.9.0"`,
// so the Cloudflare Worker version carries the release tag. The tag comes from argv, never
// from `packages/cli/package.json`, so a rerun at an older tag deploys that tag's name.
// `--dry-run` goes on to wrangler, which compiles and checks without uploading.
//
// The build must run with the tag checked out: the footer of every page shows the version
// and the commit it was built from (src/lib/build-info.ts). A real deploy refuses to start
// when HEAD is not at the tag, so a rerun from `main` cannot ship `main` under a release's
// name. `--dry-run` skips that check.
//
// Imports node: builtins only. Node 24 strips the types.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** A release tag: `v<semver>`, as packages/cli/.release-it.js writes it. */
export const RELEASE_TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** One command to run, as an executable and its arguments. */
export type Command = readonly [string, ...string[]];

/** The two commands a release deploy runs, in order. Throws on a tag that is not `v<semver>`. */
export function deployCommands(tag: string, dryRun: boolean): Command[] {
  if (!RELEASE_TAG.test(tag)) {
    throw new Error(
      `deploy:release: "${tag}" is not a release tag. Pass one such as v0.9.0.`
    );
  }
  return [
    ["pnpm", "run", "build"],
    [
      "wrangler",
      "deploy",
      "--tag",
      tag,
      "--message",
      `saasaloy ${tag}`,
      ...(dryRun ? ["--dry-run"] : []),
    ],
  ];
}

/**
 * Why a real deploy of `tag` must not start, or undefined when it may. `tagsAtHead` is the
 * output of `git tag --points-at HEAD`, one tag per entry.
 */
export function headProblem(
  tag: string,
  tagsAtHead: readonly string[]
): string | undefined {
  if (tagsAtHead.includes(tag)) {
    return undefined;
  }
  return `deploy:release: HEAD is not at ${tag}. Run \`git checkout ${tag}\` first, or the site ships another commit under the release's name.`;
}

/**
 * Runs the commands in order through `run`, which returns an exit code, and stops at the
 * first failure. Returns that code, or 0.
 */
export function runAll(
  commands: readonly Command[],
  run: (command: Command) => number
): number {
  for (const command of commands) {
    const code = run(command);
    if (code !== 0) {
      return code;
    }
  }
  return 0;
}

function main(argv: string[]): number {
  // `pnpm run deploy:release -- v0.9.0` may hand the `--` on.
  const args = argv.filter((arg) => arg !== "--");
  const dryRun = args.includes("--dry-run");
  const rest = args.filter((arg) => arg !== "--dry-run");
  const [tag] = rest;
  if (tag === undefined || rest.length > 1) {
    console.error(
      "usage: node scripts/deploy-release.ts v<version> [--dry-run]"
    );
    return 2;
  }
  let commands: Command[];
  try {
    commands = deployCommands(tag, dryRun);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 2;
  }
  const cwd = fileURLToPath(new URL("..", import.meta.url));
  if (!dryRun) {
    const tags = spawnSync("git", ["tag", "--points-at", "HEAD"], {
      cwd,
      encoding: "utf-8",
    });
    const problem = headProblem(
      tag,
      tags.status === 0 ? tags.stdout.split("\n").filter(Boolean) : []
    );
    if (problem !== undefined) {
      console.error(problem);
      return 1;
    }
  }
  return runAll(commands, ([file, ...fileArgs]) => {
    // `wrangler` is a devDependency of this workspace, so it runs through `pnpm exec`.
    const [bin, binArgs] =
      file === "wrangler"
        ? ["pnpm", ["exec", file, ...fileArgs]]
        : [file, fileArgs];
    const result = spawnSync(bin as string, binArgs as string[], {
      cwd,
      stdio: "inherit",
    });
    return result.status ?? 1;
  });
}

if (import.meta.main) {
  process.exitCode = main(process.argv.slice(2));
}
