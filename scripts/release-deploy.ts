// The `after:release` hook of `packages/cli/.release-it.js` (plan 0114, Phase 6). It deploys
// the docs site for the release that release-it just made:
//
//   pnpm -w run release:deploy v0.9.0
//
// which runs `pnpm --filter @saasaloy/web run deploy:release -- v0.9.0`. By then the tag and
// the GitHub Release exist, and release-it cannot undo them, so a failed deploy must not
// look like a failed release. The hook prints the rerun command and exits non-zero, so the
// owner sees the failure. The rerun deploys the site at the tag, with the same build:
//
//   git checkout v0.9.0 && pnpm --filter @saasaloy/web deploy:production
//
// `scripts/release-deploy.test.ts` runs `deploy` with a fake failing command. Nothing in a
// test deploys.
//
// Imports node: builtins only. Node 24 strips the types.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const TAG = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The command that deploys one release's site. */
export function deployCommand(tag: string): string[] {
  return [
    "pnpm",
    "--filter",
    "@saasaloy/web",
    "run",
    "deploy:release",
    "--",
    tag,
  ];
}

/** What the owner types to deploy the tag by hand after a failed hook. */
export function rerunCommand(tag: string): string {
  return `git checkout ${tag} && pnpm --filter @saasaloy/web deploy:production`;
}

/**
 * Runs the deploy through `run` (a function that returns an exit code) and returns the
 * hook's exit code. On failure it writes the rerun command with `log`.
 */
export function deploy(
  tag: string,
  run: (command: string[]) => number,
  log: (line: string) => void
): number {
  if (!TAG.test(tag)) {
    log(
      `release:deploy: "${tag}" is not a release tag. Pass one such as v0.9.0.`
    );
    return 2;
  }
  const code = run(deployCommand(tag));
  if (code === 0) {
    return 0;
  }
  log(
    [
      `release:deploy: the site deploy for ${tag} failed (exit ${code}).`,
      `The tag and the GitHub Release exist, so rerun only the deploy:`,
      `  ${rerunCommand(tag)}`,
    ].join("\n")
  );
  return code === 2 ? 1 : code;
}

if (import.meta.main) {
  const root = resolve(import.meta.dirname, "..");
  const [tag = ""] = process.argv.slice(2);
  process.exitCode = deploy(
    tag,
    ([file = "", ...args]) =>
      spawnSync(file, args, { cwd: root, stdio: "inherit" }).status ?? 1,
    (line) => {
      console.error(line);
    }
  );
}
