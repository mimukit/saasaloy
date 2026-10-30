// The check release-it runs before it touches anything (`before:init` in
// packages/cli/.release-it.json). It answers one question: is this checkout safe to cut a
// release from?
//
// It re-runs the gate rather than asking GitHub whether CI was green. A release that trusts
// a status API publishes whatever is on disk while claiming whatever the API remembers, and
// those are not the same tree. Running the gate scripts here costs minutes and removes the
// gap entirely.
//
// Staleness is checked first and separately. A `main` behind origin cuts a tag over code
// that is missing merged work, and no amount of green gate catches it.
//
// SAASALOY_RELEASE_SKIP_GATE=1 skips the gate scripts on a rerun after a transient
// failure. It is an environment variable because release-it hooks are fixed strings, so
// there is nowhere to pass a flag. The staleness check, the update-note check and the smoke
// always run.
//
// The update-note check reads the commits since the last tag. A breaking commit must add a
// file under an `update-notes/` folder, or opt out with `Update-Note: none (<reason>)`. It
// runs before the gate because it costs one `git log` and one `git diff-tree` per breaking
// commit, so a missing note fails in a second rather than after five minutes of gate.
//
// Imports node: builtins and two sibling scripts. Node 24 strips the types, so there is no
// build step; `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import type { Git } from "./changelog-update-notes.ts";
import { addedUpdateNotes } from "./changelog-update-notes.ts";
import { updateNoteOptOut } from "./update-note-footer.ts";

export type { Git } from "./changelog-update-notes.ts";
export { updateNoteOptOut } from "./update-note-footer.ts";

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
  "verify:pins",
] as const;

const SKIP_GATE_ENV = "SAASALOY_RELEASE_SKIP_GATE";

/**
 * Whether to skip the gate scripts. Exactly `"1"` turns it on.
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

/** `type!:` or `type(scope)!:` on the subject line. */
const BREAKING_SUBJECT = /^\w+(?:\([^)]*\))?!:/;

/** A `BREAKING CHANGE:` or `BREAKING-CHANGE:` footer, at the start of a body line. */
const BREAKING_FOOTER = /^BREAKING[ -]CHANGE:/m;

/** Whether a commit message marks a breaking change, by Conventional Commits rules. */
export function isBreakingCommit(message: string): boolean {
  const [subject = "", ...body] = message.split("\n");
  return (
    BREAKING_SUBJECT.test(subject) || BREAKING_FOOTER.test(body.join("\n"))
  );
}

export interface BreakingCommit {
  hash: string;
  shortHash: string;
  subject: string;
}

export interface OptOut extends BreakingCommit {
  reason: string;
}

export interface UpdateNoteCheck {
  /** Breaking commits with no note and no opt-out. Each one fails the release. */
  missing: BreakingCommit[];
  /** Breaking commits that opted out. The preflight prints each reason. */
  optOuts: OptOut[];
}

const FIELD = "\u001F";
const RECORD = "\u001E";

/**
 * Check every non-merge commit in `<tag>..HEAD`. Merges are skipped: a PR merge commit
 * adds nothing of its own, and the commits it brings in are read one by one.
 */
export function checkUpdateNotes(git: Git, tag: string): UpdateNoteCheck {
  const log = git([
    "log",
    "--no-merges",
    `--format=%H${FIELD}%B${RECORD}`,
    `${tag}..HEAD`,
  ]);
  const result: UpdateNoteCheck = { missing: [], optOuts: [] };
  for (const record of log.split(RECORD)) {
    const separator = record.indexOf(FIELD);
    if (separator === -1) {
      continue;
    }
    const hash = record.slice(0, separator).trim();
    const message = record.slice(separator + 1).trim();
    if (!isBreakingCommit(message)) {
      continue;
    }
    const commit: BreakingCommit = {
      hash,
      shortHash: hash.slice(0, 7),
      subject: message.split("\n")[0] ?? "",
    };
    if (addedUpdateNotes(git, hash).length > 0) {
      continue;
    }
    const reason = updateNoteOptOut(message);
    if (reason === null) {
      result.missing.push(commit);
    } else {
      result.optOuts.push({ ...commit, reason });
    }
  }
  return result;
}

/** What to print for breaking commits that carry no update note. */
export function missingUpdateNotesMessage(
  missing: readonly BreakingCommit[]
): string {
  return [
    "these breaking commits add no update note:",
    ...missing.map((commit) => `  ${commit.shortHash} ${commit.subject}`),
    "  Each breaking commit adds a note under packages/cli/update-notes/ or",
    "  modules/<name>/update-notes/ in the same commit, or carries the footer",
    "  `Update-Note: none (<reason>)` with a non-empty reason.",
  ].join("\n");
}

/** One line for a breaking commit that opted out of a note. */
export function optOutMessage(optOut: OptOut): string {
  return `${optOut.shortHash} ${optOut.subject}: no update note (${optOut.reason})`;
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

  // --- Does every breaking commit carry an update note? -----------------------------

  const tag = capture(
    ["describe", "--tags", "--match=v*", "--abbrev=0"],
    "git describe --tags"
  );
  const notes = checkUpdateNotes(
    (args) => capture(args, `git ${args[0] ?? ""}`),
    tag
  );
  for (const optOut of notes.optOuts) {
    step(optOutMessage(optOut));
  }
  if (notes.missing.length > 0) {
    fail(
      "breaking change without an update note",
      missingUpdateNotesMessage(notes.missing)
    );
  }
  step(`every breaking commit since ${tag} has an update note`);

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
