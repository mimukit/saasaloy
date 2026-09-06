// The check release-it runs before it touches anything (`before:init` in
// packages/cli/.release-it.json). It answers one question: is this checkout safe to cut a
// release from?
//
// It re-runs the gate rather than asking GitHub whether CI was green. A release that trusts
// a status API publishes whatever is on disk while claiming whatever the API remembers, and
// those are not the same tree. Running the four scripts here costs minutes and removes the
// gap entirely.
//
// Staleness is checked first and separately. A `main` behind origin cuts a tag over code
// that is missing merged work, and no amount of green gate catches it.
//
// SAASALOY_RELEASE_SKIP_GATE=1 skips the four gate scripts on a rerun after a transient
// failure. It is an environment variable because release-it hooks are fixed strings, so
// there is nowhere to pass a flag. The staleness check and the smoke always run.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

/**
 * The gate, in ci.yml's order. Kept identical to the workflow on purpose: the preflight is
 * only a stand-in for CI while the two run the same scripts, and a test pins that.
 */
export const GATE_SCRIPTS = [
  "lint",
  "typecheck",
  "test",
  "verify:content",
] as const;

const SKIP_GATE_ENV = "SAASALOY_RELEASE_SKIP_GATE";

/**
 * Whether to skip the four gate scripts. Exactly `"1"` turns it on.
 *
 * A truthiness check would read `SAASALOY_RELEASE_SKIP_GATE=0` as "skip", which is the
 * opposite of what anyone typing it means, and it would skip the gate silently.
 */
export function shouldSkipGate(env: NodeJS.ProcessEnv): boolean {
  return env[SKIP_GATE_ENV] === "1";
}

/**
 * Whether release-it will be able to create the GitHub Release over the API.
 *
 * Without a token release-it does not fail. It falls back to a web release and puts the
 * whole changelog in a `releases/new` query string, which GitHub rejects with 414 on any
 * release big enough to matter. Catching it here turns that into a message.
 */
export function hasGitHubToken(env: NodeJS.ProcessEnv): boolean {
  return (env.GITHUB_TOKEN ?? "").trim() !== "";
}

/** What to print when `GITHUB_TOKEN` is missing or empty. */
export function missingTokenMessage(): string {
  return (
    "GITHUB_TOKEN is empty.\n" +
    "  release-it would fall back to a web release and GitHub would reject the URL.\n" +
    "  Run `gh auth login`, then start the release again."
  );
}

/** What to print when local `main` and `origin/main` disagree. */
export function staleMainMessage(local: string, remote: string): string {
  return (
    `local main is ${local}, origin/main is ${remote}.\n` +
    "  A release cut here tags code that is not what origin holds.\n" +
    "  Run `git pull --ff-only` and start the release again."
  );
}

function fail(message: string, ...detail: string[]): never {
  console.error(`release-preflight: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

function step(message: string): void {
  console.log(`release-preflight: ${message}`);
}

function run(command: string, args: readonly string[], label: string): void {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.error) {
    fail(`${label} could not start`, String(result.error));
  }
  if (result.status !== 0) {
    fail(
      `${label} failed`,
      `exit code ${String(result.status)}`,
      `Fix it, then rerun the release. To rerun without repeating the gate:`,
      `  ${SKIP_GATE_ENV}=1 pnpm release`
    );
  }
}

function capture(args: readonly string[], label: string): string {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf-8" });
  if (result.error || result.status !== 0) {
    fail(`${label} failed`, result.stderr?.trim() ?? String(result.error));
  }
  return result.stdout.trim();
}

async function main(): Promise<void> {
  // --- Can release-it reach the GitHub API? -------------------------------------------

  if (!hasGitHubToken(process.env)) {
    fail("no GitHub token", missingTokenMessage());
  }
  step("GITHUB_TOKEN is set");

  // --- Is this checkout what origin holds? ------------------------------------------

  step("fetching origin/main");
  run("git", ["fetch", "origin", "main", "--quiet"], "git fetch");

  const local = capture(["rev-parse", "--short", "HEAD"], "git rev-parse HEAD");
  const remote = capture(
    ["rev-parse", "--short", "origin/main"],
    "git rev-parse origin/main"
  );
  if (local !== remote) {
    fail("main is not in sync with origin", staleMainMessage(local, remote));
  }
  step(`main is in sync with origin at ${local}`);

  // --- The gate ----------------------------------------------------------------------

  if (shouldSkipGate(process.env)) {
    step(
      `${SKIP_GATE_ENV}=1 — skipping lint, typecheck, test and verify:content`
    );
  } else {
    for (const script of GATE_SCRIPTS) {
      step(`running ${script}`);
      run("pnpm", ["run", script], `pnpm run ${script}`);
    }
  }

  // --- The artifact -------------------------------------------------------------------

  // Always runs, skip flag or not. It is the only check that looks at the thing being
  // published rather than at the source it was built from.
  step("running the tarball smoke");
  run("pnpm", ["run", "release:smoke"], "pnpm run release:smoke");

  console.log("release-preflight: clear to release.");
}

// Only when run directly, so the test can import the pure functions above.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
