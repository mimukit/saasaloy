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
// file under an `update-notes/` folder, or opt out with `Update-Note: none (<reason>)`, or
// get its note from a later commit that carries `Update-Note-For: <full sha>`. It
// runs before the gate because it costs one `git log` and one `git diff-tree` per breaking
// commit, so a missing note fails in a second rather than after five minutes of gate.
//
// The llms.txt check builds the CLI, reads its help, and fails when the root `llms.txt` names
// a skill, a command or a flag the release lacks (ADR 0062). It runs before the gate for the
// same reason the update-note check does: it costs seconds, the gate costs minutes. What
// "the release" holds is defined in `scripts/llms-txt.ts`.
//
// The npm check asks the registry whether the version of the last tag is on npm. Since ADR
// 0064 a tag push starts `publish.yml`, and the owner approves that job on GitHub, so a tag
// can exist with no publish behind it: a rejected approval, a failed job nobody reran. A
// second release on top would skip that version on npm for good. A network failure is not
// read as "missing" or as "published": the preflight stops and names the npm error.
//
// The benchmark check reads the changed paths since the last tag. When they touch a base
// skill, the unattended CLI contract or a module of the MVP set, it refuses the release
// unless a score report in `docs/research/` for every benchmark brief covers this revision
// and holds no FAIL line (plan 0109). It costs a few `git` calls, so it runs before the
// gate too. `scripts/bench-gate.ts` defines each term.
//
// Imports node: builtins and four sibling scripts. Node 24 strips the types, so there is no
// build step; `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Git, LoggedCommit } from "./changelog-update-notes.ts";
import {
  benchBriefs,
  benchmarkMessage,
  checkBenchmark,
  gatedPaths,
  parseBenchReport,
  REPORT_DIR,
  REPORT_NAME,
} from "./bench-gate.ts";
import {
  addedUpdateNotes,
  commitsInRange,
  lateNoteFooters,
  lateUpdateNotes,
} from "./changelog-update-notes.ts";
import { cliSurface, llmsSurfaceProblems, releaseSkills } from "./llms-txt.ts";
import { shortShaProblem, updateNoteOptOut } from "./update-note-footer.ts";

export type { BenchmarkCheck, BenchReport } from "./bench-gate.ts";
export {
  BASE_SKILLS,
  benchBriefs,
  benchmarkMessage,
  checkBenchmark,
  gatedPaths,
  parseBenchReport,
  REPORT_NAME,
  UNATTENDED_CLI_CONTRACT,
} from "./bench-gate.ts";
export type { Git } from "./changelog-update-notes.ts";
export type { CliSurface } from "./llms-txt.ts";
export { cliSurface, llmsSurfaceProblems, releaseSkills } from "./llms-txt.ts";
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
  "docs:check",
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

/** A breaking commit that a later commit covered with `Update-Note-For:`. */
export interface LateNote extends BreakingCommit {
  /** The short SHAs of the commits that added its notes. */
  by: string[];
}

export interface UpdateNoteCheck {
  /** Breaking commits with no note and no opt-out. Each one fails the release. */
  missing: BreakingCommit[];
  /** Breaking commits that opted out. The preflight prints each reason. */
  optOuts: OptOut[];
  /** Breaking commits whose note came in a later commit. The preflight prints each one. */
  late: LateNote[];
  /** One line per `Update-Note-For:` footer that covers nothing. The preflight warns about each. */
  badFooters: string[];
}

function breakingCommit(commit: LoggedCommit): BreakingCommit {
  return {
    hash: commit.hash,
    shortHash: commit.hash.slice(0, 7),
    subject: commit.message.split("\n")[0] ?? "",
  };
}

/**
 * Check every non-merge commit in `<tag>..HEAD`. Merges are skipped: a PR merge commit
 * adds nothing of its own, and the commits it brings in are read one by one.
 *
 * A breaking commit is covered by a note it adds itself, then by a note a later commit
 * adds under `Update-Note-For: <its full sha>`, then by an `Update-Note: none (<reason>)`
 * opt-out. A footer that names no full SHA, names a commit that is not a breaking commit
 * in the range, or sits on a commit that adds no note covers nothing. It goes to
 * `badFooters`, which the preflight prints as a warning; the commit it meant to cover
 * still counts as missing.
 */
export function checkUpdateNotes(git: Git, tag: string): UpdateNoteCheck {
  const commits = commitsInRange(git, `${tag}..HEAD`);
  const result: UpdateNoteCheck = {
    missing: [],
    optOuts: [],
    late: [],
    badFooters: [],
  };
  const breaking = new Set(
    commits
      .filter((commit) => isBreakingCommit(commit.message))
      .map((commit) => commit.hash.toLowerCase())
  );
  const footers = lateNoteFooters(git, commits);
  for (const footer of footers) {
    const carrier = breakingCommit(footer.commit);
    const where = `${carrier.shortHash} ${carrier.subject}`;
    const named = `"Update-Note-For: ${footer.value}"`;
    if (footer.target === null) {
      result.badFooters.push(`${where}: ${shortShaProblem(footer.value)}`);
    } else if (!breaking.has(footer.target)) {
      result.badFooters.push(
        `${where}: ${named} names a commit that is not a breaking commit since ${tag}`
      );
    } else if (footer.notes.length === 0) {
      result.badFooters.push(
        `${where}: ${named} is on a commit that adds no update note`
      );
    }
  }
  const lateNotes = lateUpdateNotes(footers);
  for (const logged of commits) {
    if (!isBreakingCommit(logged.message)) {
      continue;
    }
    const commit = breakingCommit(logged);
    if (addedUpdateNotes(git, logged.hash).length > 0) {
      continue;
    }
    if (lateNotes.has(logged.hash.toLowerCase())) {
      const by = footers
        .filter(
          (footer) =>
            footer.target === logged.hash.toLowerCase() &&
            footer.notes.length > 0
        )
        .map((footer) => footer.commit.hash.slice(0, 7));
      result.late.push({ ...commit, by });
      continue;
    }
    const reason = updateNoteOptOut(logged.message);
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
    "  `Update-Note: none (<reason>)` with a non-empty reason. A note that comes",
    "  later goes in its own commit with the footer `Update-Note-For: <full sha>`.",
  ].join("\n");
}

/** What to print for `Update-Note-For:` footers that are wrong. */
export function badFootersMessage(badFooters: readonly string[]): string {
  return [
    "these Update-Note-For footers cover nothing:",
    ...badFooters.map((line) => `  ${line}`),
    "  `Update-Note-For: <full sha>` names a breaking commit since the last tag by its",
    "  full 40-character SHA, and its own commit adds the note under an update-notes/ folder.",
  ].join("\n");
}

/** One line for a breaking commit whose note a later commit added. */
export function lateNoteMessage(late: LateNote): string {
  return `${late.shortHash} ${late.subject}: update note added later by ${late.by.join(", ")} (Update-Note-For)`;
}

/** The output of one `npm view <spec> version` run. */
export interface NpmViewResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** Set when npm could not start at all. */
  error?: Error;
}

/** Runs `npm view <spec> version`. The preflight passes the real one, a test a fake. */
export type NpmView = (spec: string) => NpmViewResult;

export type TagPublished =
  | { state: "published"; version: string }
  | { state: "missing"; version: string }
  | { state: "unknown"; version: string; detail: string };

/**
 * Whether the version of `tag` (`v1.2.3` reads as `1.2.3`) of `name` is on npm.
 *
 * `npm view <name>@<version> version` prints the version and exits 0 when it is there, and
 * exits 1 with `npm error code E404` when it is not. Anything else, a network error, a
 * registry outage, a 401, an empty answer, is `unknown`: the preflight cannot tell, so it
 * stops rather than read a dead network as a skipped version or as a clean one.
 */
export function checkTagPublished(
  npmView: NpmView,
  name: string,
  tag: string
): TagPublished {
  const version = tag.replace(/^v/, "");
  const result = npmView(`${name}@${version}`);
  if (result.error) {
    return { state: "unknown", version, detail: String(result.error) };
  }
  if (result.status === 0 && result.stdout.trim() === version) {
    return { state: "published", version };
  }
  if (result.status !== 0 && /\bcode E404\b/.test(result.stderr)) {
    return { state: "missing", version };
  }
  const detail =
    result.stderr.trim() ||
    `exit code ${String(result.status)}, output "${result.stdout.trim()}"`;
  return { state: "unknown", version, detail };
}

/** What to print when the version of the last tag is not on npm. */
export function unpublishedTagMessage(name: string, tag: string): string {
  const version = tag.replace(/^v/, "");
  return [
    `${name}@${version} is not on npm, but the tag ${tag} exists.`,
    "  The publish.yml run for that tag did not finish: it waits for approval in the",
    "  `npm` environment, or it failed. Approve or rerun it on GitHub (CONTRIBUTING.md,",
    `  "If the publish fails"), check \`npm view ${name}@${version} version\`, then start`,
    "  the release again. A new release on top would skip that version on npm.",
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

function warn(message: string, ...detail: string[]): void {
  console.warn(`release-preflight: warning: ${message}`);
  for (const line of detail) {
    console.warn(`  ${line}`);
  }
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

/**
 * Whether a score at `revision` covers HEAD: the revision is an ancestor of HEAD, and no
 * path the benchmark gates changed between the two.
 */
function coversRelease(revision: string): boolean {
  const ancestor = spawnSync(
    "git",
    ["merge-base", "--is-ancestor", revision, "HEAD"],
    { cwd: root }
  );
  if (ancestor.status !== 0) {
    return false;
  }
  const diff = spawnSync("git", ["diff", "--name-only", revision, "HEAD"], {
    cwd: root,
    encoding: "utf-8",
  });
  return (
    diff.status === 0 &&
    gatedPaths(diff.stdout.split("\n").filter((path) => path !== "")).length ===
      0
  );
}

/**
 * The update-note check on its own: read the last `v*` tag, check the commits since it,
 * print each opt-out and late note, and exit 1 on a failure. Returns the tag. `main` runs
 * it, and a maintainer runs it alone without the rest of the preflight:
 *
 *   node --input-type=module -e 'import("./scripts/release-preflight.ts").then((m) => m.runUpdateNoteCheck())'
 */
export function runUpdateNoteCheck(): string {
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
  for (const late of notes.late) {
    step(lateNoteMessage(late));
  }
  // A warning, not a failure: history on main cannot change, so a failure here would
  // stop every later release. A wrong footer covers nothing, so the breaking commit it
  // meant to cover still fails below as a missing note.
  if (notes.badFooters.length > 0) {
    warn(
      "an Update-Note-For footer covers nothing",
      badFootersMessage(notes.badFooters)
    );
  }
  if (notes.missing.length > 0) {
    fail(
      "breaking change without an update note",
      missingUpdateNotesMessage(notes.missing)
    );
  }
  step(`every breaking commit since ${tag} has an update note`);
  return tag;
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

  const tag = runUpdateNoteCheck();

  // --- Is the last tag's version on npm? ----------------------------------------------

  const cliName = (
    JSON.parse(
      readFileSync(join(root, "packages", "cli", "package.json"), "utf-8")
    ) as { name: string }
  ).name;
  const published = checkTagPublished(
    (spec) => {
      const result = spawnSync("npm", ["view", spec, "version"], {
        cwd: root,
        encoding: "utf-8",
      });
      return {
        status: result.status,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        ...(result.error ? { error: result.error } : {}),
      };
    },
    cliName,
    tag
  );
  if (published.state === "missing") {
    fail(`${tag} is not published on npm`, unpublishedTagMessage(cliName, tag));
  }
  if (published.state === "unknown") {
    fail(
      `could not ask npm whether ${cliName}@${published.version} is published`,
      published.detail,
      "Check the network and `npm view` by hand, then start the release again."
    );
  }
  step(`${cliName}@${published.version} (${tag}) is on npm`);

  // --- Does a benchmark score report clear this release? ----------------------------

  const changed = capture(
    ["diff", "--name-only", `${tag}..HEAD`],
    "git diff --name-only"
  )
    .split("\n")
    .filter((path) => path !== "");
  const reportDir = join(root, REPORT_DIR);
  const reports = readdirSync(reportDir)
    .filter((file) => REPORT_NAME.test(file))
    .map((file) =>
      parseBenchReport(file, readFileSync(join(reportDir, file), "utf-8"))
    );
  const bench = checkBenchmark({
    changed,
    reports,
    briefs: benchBriefs(root),
    covers: (revision) => coversRelease(revision),
  });
  if (bench.problems.length > 0) {
    fail(
      "no benchmark score report clears this release",
      benchmarkMessage(bench)
    );
  }
  step(
    bench.cleared
      ? `the benchmark report ${bench.cleared} covers this release with no FAIL line`
      : `no change since ${tag} needs a benchmark run`
  );

  // --- Does llms.txt name only what the release holds? ------------------------------

  step("building the CLI to read its commands and flags");
  run("pnpm", ["--filter", "saasaloy", "run", "build"], "pnpm build (cli)");
  const cli = join(root, "packages", "cli", "dist", "index.js");
  const help = (args: readonly string[]): string => {
    const result = spawnSync(process.execPath, [cli, ...args, "--help"], {
      cwd: root,
      encoding: "utf-8",
      env: { ...process.env, NO_COLOR: "1" },
    });
    if (result.error || result.status !== 0) {
      fail(`saasaloy ${args.join(" ")} --help failed`, result.stderr);
    }
    return result.stdout;
  };
  const top = help([]);
  const commands = [...cliSurface(top, {}).commands.keys()];
  const surface = cliSurface(
    top,
    Object.fromEntries(commands.map((name) => [name, help([name])]))
  );
  const llmsProblems = llmsSurfaceProblems(
    readFileSync(join(root, "llms.txt"), "utf-8"),
    surface,
    releaseSkills(root)
  );
  if (llmsProblems.length > 0) {
    fail(
      "llms.txt names what the release does not hold",
      ...llmsProblems,
      "Fix llms.txt, or ship what it names, then start the release again."
    );
  }
  step("llms.txt names only skills, commands and flags the release holds");

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
