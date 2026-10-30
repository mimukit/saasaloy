// Prove the tarball npm would publish actually works, before it is published.
//
// Everything else in this repo exercises the CLI from source: `pnpm test` runs vitest
// against `src/`, and `play:init` runs `dist/index.js` from inside the workspace. Neither
// touches the `files` whitelist in packages/cli/package.json, so a template directory or a
// schema dropped from that list breaks nobody here and everybody out there. This script
// closes that gap: it packs, installs the tarball into a directory that is not a workspace
// member, and drives `init` and `add` through the installed bin.
//
// The CLI steps run OFFLINE. `add` points at the repo's own `modules/` through
// SAASALOY_REGISTRY_DIR, so what is under test is the packed artifact and not GitHub's
// uptime. The remote fetch path is a separate, deliberate manual check before the first
// publish.
//
// The last two steps are the exception, and they need the npm registry. The first installs
// the scaffolded project and starts the web app's `astro dev` (issue #186). A dependency the
// template reaches through a range can move under our exact pins with no change on our
// side, and then a fresh project's dev server fails for everyone. Only a real install
// finds that, so `.github/workflows/smoke.yml` runs this script on a schedule as well.
// The second scaffolds a project with every module, one per database driver, and runs
// that project's own `pnpm lint` (issue #152). Only there do imports between workspaces
// resolve, the type-aware pass reach the installed blocks, and `add` format its patches.
//
// The upgrade step needs the network too (issue #298). It installs the previous published
// CLI, which scaffolds a project with modules fetched from GitHub at that release's tag,
// and then runs the packed CLI's `update --dry-run` against the repo's `modules/`. The
// merge plan must list the update notes that project is owed. `--upgrade-only` runs this
// step alone after the pack.
//
// npm does the install, not pnpm: pnpm would find pnpm-workspace.yaml above .dev/ and link
// rather than install, which is the one thing this script exists to avoid.
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { spawn, spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const cliDir = join(root, "packages/cli");
const scratch = join(root, ".dev/release-smoke");
const installDir = join(scratch, "install");
const workDir = join(scratch, "work");
const projectDir = join(workDir, "smoke");

/** The dependency blocks a published manifest can carry a `workspace:` range in. */
const DEPENDENCY_BLOCKS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

/**
 * The arguments for every install in a scaffolded project. A runner sets `CI=true`, and
 * pnpm then installs with `--frozen-lockfile` unless told otherwise. A scaffold commits no
 * lockfile, and the install after a run of `add` meets workspaces the first install never
 * wrote into it, so a frozen install fails on the runner and passes on a dev box (issue
 * #267). A developer installs a fresh project unfrozen, and so does this script.
 */
const SCAFFOLD_INSTALL = ["install", "--no-frozen-lockfile"] as const;

/** Files `init` must have written, relative to the scaffolded project. */
const INIT_FILES = ["package.json", "saasaloy.json", "pnpm-workspace.yaml"];

/**
 * What `add api` must have written. `apps/api/src/index.ts` is the module's own code and
 * `saasaloy-lock.json` is the applier's record of it, so this covers both halves of an add:
 * the files landed, and the project knows they did.
 */
const ADD_FILES = [
  "apps/api/package.json",
  "apps/api/src/index.ts",
  "saasaloy-lock.json",
];

/** The web app's pinned dev origin, from `apps/web/astro.config.mjs` (`strictPort`). */
const WEB_DEV_URL = "http://localhost:3000/";

/**
 * How long the web dev server gets to answer. A cold start measured 36.6s on a dev box
 * (plan 0066, Phase 0), and a CI runner is slower, so this leaves room for both.
 */
const WEB_DEV_TIMEOUT_MS = 180_000;

/**
 * Log lines that mean a React component threw during the server render. React writes
 * these to the log and Astro still answers 200 with the HTML around the failed block, so
 * the status code alone does not show the fault.
 */
const RENDER_ERROR_PATTERNS = [
  /Invalid hook call/,
  /Cannot read properties of null \(reading 'use[A-Z]\w*'\)/,
];

/** The testing mode each full scaffold takes, so the module tests reach its lint. */
const TESTING_FLAG = "--testing=tests-after";

/**
 * A module test every full scaffold must hold. Without it, a dropped `--testing` flag
 * would leave the lint step passing on no module test at all.
 */
const FULL_SCAFFOLD_TESTS = ["apps/api/src/routes/auth.test.ts"];

/** A registry module as the lint step reads it: its name and the modules it excludes. */
export interface ModuleEntry {
  name: string;
  conflictsWith: string[];
  dependsOn?: string[];
  requiresOneOf?: string[];
}

/** One project the lint step scaffolds, and the modules it adds, in order. */
export interface FullScaffold {
  name: string;
  modules: string[];
}

export interface SmokeOptions {
  /** Leave `.dev/release-smoke/` in place after a green run, for inspection. */
  keep: boolean;
  /** Pack and install, then run the upgrade step alone (issue #298). */
  upgradeOnly: boolean;
  /** Flags and positionals this script does not accept. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--keep", "--upgrade-only"]);

/**
 * Split this script's argv. Exported for its own test: a typo'd `--kep` that silently
 * wiped the scratch tree would be read as "the directory was never kept", which sends the
 * maintainer looking at the wrong thing.
 */
export function parseArgs(argv: string[]): SmokeOptions {
  const unknown = argv.filter((arg) => !KNOWN_FLAGS.has(arg));
  return {
    keep: argv.includes("--keep"),
    unknown,
    upgradeOnly: argv.includes("--upgrade-only"),
  };
}

/**
 * Every `workspace:` range in a manifest, as `block.name` paths. Exported for its own test.
 *
 * `npm publish` does not rewrite these ranges the way `pnpm publish` does, so a single one
 * ships a package that fails to install for everyone who is not in this monorepo. The CLI
 * has no workspace dependency today; this is the guard that notices the day someone adds one.
 */
export function findWorkspaceDeps(manifest: Record<string, unknown>): string[] {
  const offenders: string[] = [];
  for (const block of DEPENDENCY_BLOCKS) {
    const deps = manifest[block];
    if (typeof deps !== "object" || deps === null) {
      continue;
    }
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        offenders.push(`${block}.${name}`);
      }
    }
  }
  return offenders;
}

/**
 * Every log line that reports a React render fault. Exported for its own test.
 *
 * Two copies of React in the server bundle (issue #186) show up as "Invalid hook call"
 * and as a hook read off a null dispatcher, so the check matches both and nothing wider.
 */
export function findRenderErrors(log: string): string[] {
  return log
    .split("\n")
    .filter((line) =>
      RENDER_ERROR_PATTERNS.some((pattern) => pattern.test(line))
    );
}

/**
 * The projects that together put every registry module through a real project's
 * `pnpm lint` (issue #152). Exported for its own test.
 *
 * Each project takes a maximal compatible set of choices, then every conflict-free
 * module. Independent choices cross, so each API key owner runs with each database
 * driver. Dependencies order the choices before the remaining modules.
 */
export function fullScaffolds(modules: readonly ModuleEntry[]): FullScaffold[] {
  const exclusive = modules
    .filter((entry) =>
      modules.some(
        (other) =>
          entry.conflictsWith.includes(other.name) ||
          other.conflictsWith.includes(entry.name)
      )
    )
    .map((entry) => entry.name)
    .toSorted();
  const free = modules
    .filter((entry) => !exclusive.includes(entry.name))
    .map((entry) => entry.name)
    .toSorted();
  if (exclusive.length === 0) {
    return [{ modules: free, name: "full" }];
  }
  const entries = new Map(modules.map((entry) => [entry.name, entry]));
  const conflicts = (a: string, b: string): boolean =>
    Boolean(entries.get(a)?.conflictsWith.includes(b)) ||
    Boolean(entries.get(b)?.conflictsWith.includes(a));
  let choices: string[][] = [[]];
  for (const name of exclusive) {
    choices = choices.flatMap((choice) =>
      choice.some((other) => conflicts(name, other))
        ? [choice]
        : [choice, [...choice, name]]
    );
  }
  return choices
    .filter((choice) =>
      exclusive.every(
        (name) =>
          choice.includes(name) ||
          choice.some((other) => conflicts(name, other))
      )
    )
    .toSorted((a, b) => a.join(",").localeCompare(b.join(",")))
    .map((choice) => {
      const selected = new Set(choice);
      const visited = new Set<string>();
      const ordered: string[] = [];
      const visit = (name: string): void => {
        if (visited.has(name)) {
          return;
        }
        visited.add(name);
        const entry = entries.get(name);
        for (const dependency of entry?.dependsOn ?? []) {
          visit(dependency);
        }
        const provider = entry?.requiresOneOf?.find((option) =>
          selected.has(option)
        );
        if (provider !== undefined) {
          visit(provider);
        }
        if (selected.has(name)) {
          ordered.push(name);
        }
      };
      for (const name of choice) {
        visit(name);
      }
      return {
        modules: [...ordered, ...free],
        name: `full-${ordered.join("-")}`,
      };
    });
}

// --- Upgrade step (issue #298) ------------------------------------------------------

/** The repository the previous CLI fetches its modules from, at the tag of its release. */
const UPGRADE_SOURCE = "mimukit/saasaloy";

/**
 * What the upgrade project takes from the previous release, one `add` each, in order.
 * `admin` brings `api` and `auth` with it, and its `when.installed` gate is what lets the
 * shell note through. `email-react` ships a note of its own. Add a module here when a
 * note needs one the set does not hold.
 */
const UPGRADE_ADDS: readonly (readonly string[])[] = [
  ["email-react"],
  ["admin", "--with", "database-d1"],
];

/**
 * The testing mode the upgrade project takes. Off, so a note gated on `when.testing` is
 * expected to stay out of the merge plan.
 */
const UPGRADE_TESTING = "off";

/** What `update --dry-run` exits with: a preview stays 0 even while notes are pending. */
const DRY_RUN_EXIT = 0;

/** A note id: `base/NNNN-<slug>` or `<module>/NNNN-<slug>`, as `lib/update-notes.ts` derives it. */
const NOTE_ID = "[a-z0-9][a-z0-9-]*/[0-9]{4}-[a-z0-9][a-z0-9-]*";

/** A note heading in the merge plan: `### <id>: <title>`, or one level down under "may apply". */
const NOTE_HEADING = new RegExp(`^#{3,4} (${NOTE_ID}): `);

const MAY_APPLY_HEADING = "### Notes that may apply";

/** A version as `[major, minor, patch, prerelease]`, or undefined when it is not semver. */
function parseSemver(
  version: string
): [number, number, number, string] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (match === null) {
    return undefined;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3]), match[4] ?? ""];
}

/**
 * Compare two semver strings. A prerelease sorts below its release, and two prereleases
 * compare as text, which is all the smoke needs. Exported for its own test.
 */
export function compareSemver(a: string, b: string): number {
  const left = parseSemver(a);
  const right = parseSemver(b);
  if (left === undefined || right === undefined) {
    throw new Error(`not a semver version: ${left === undefined ? a : b}`);
  }
  for (let index = 0; index < 3; index += 1) {
    const diff = (left[index] as number) - (right[index] as number);
    if (diff !== 0) {
      return diff;
    }
  }
  if (left[3] === right[3]) {
    return 0;
  }
  if (left[3] === "") {
    return 1;
  }
  if (right[3] === "") {
    return -1;
  }
  return left[3] < right[3] ? -1 : 1;
}

/**
 * The newest published release below `current`, from the list `npm view saasaloy
 * versions --json` prints. A prerelease is never the previous CLI: a project scaffolded
 * with one is not what a user upgrades from. Exported for its own test.
 */
export function previousVersion(
  published: readonly string[],
  current: string
): string | undefined {
  return published
    .filter((version) => {
      const parsed = parseSemver(version);
      return (
        parsed !== undefined &&
        parsed[3] === "" &&
        compareSemver(version, current) < 0
      );
    })
    .toSorted(compareSemver)
    .at(-1);
}

/** The frontmatter fields the expected-notes table reads. */
export interface NoteFrontmatter {
  version?: string;
  when?: { installed: string[]; testing: boolean };
}

/**
 * Read `version` and `when` out of a note's frontmatter. Only the forms the notes use:
 * `when` as a block map or a flow map, `installed` as a block list or a flow list, and
 * `testing: true`. A `when` key past those two throws, so a new condition fails the smoke
 * loudly and is not skipped. Exported for its own test.
 */
export function readNoteFrontmatter(source: string): NoteFrontmatter {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  if (match === null) {
    throw new Error("the note has no frontmatter");
  }
  const lines = match[1]!.split(/\r?\n/);
  const result: NoteFrontmatter = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const top = /^(\w+):\s*(.*)$/.exec(line);
    if (top === null) {
      continue;
    }
    const [, key, rest] = top as unknown as [string, string, string];
    if (key === "version") {
      result.version = rest.replaceAll(/^["']|["']$/g, "").trim();
    } else if (key === "when") {
      let text = rest;
      while (index + 1 < lines.length && /^\s/.test(lines[index + 1] ?? "")) {
        index += 1;
        text += `\n${lines[index]!}`;
      }
      result.when = readWhen(text);
    }
  }
  return result;
}

function readWhen(text: string): { installed: string[]; testing: boolean } {
  for (const [, key] of text.matchAll(/(\w+):/g)) {
    if (key !== "installed" && key !== "testing") {
      throw new Error(
        `the smoke cannot judge \`when.${String(key)}\`; teach readNoteFrontmatter the key`
      );
    }
  }
  const flow = /installed:\s*\[([^\]]*)\]/.exec(text);
  const block = /installed:\s*\n((?:[ \t]*-[^\n]*(?:\n|$))+)/.exec(text);
  const unquote = (item: string): string =>
    item.trim().replaceAll(/^["']|["']$/g, "");
  let installed: string[] = [];
  if (flow !== null) {
    installed = flow[1]!.split(",").map(unquote).filter(Boolean);
  } else if (block !== null) {
    installed = block[1]!
      .split("\n")
      .map((item) => unquote(item.replace(/^\s*-/, "")))
      .filter(Boolean);
  }
  return { installed, testing: /testing:\s*true\b/.test(text) };
}

/** One note on disk, as the expected-notes table reads it. */
export interface NoteOnDisk extends NoteFrontmatter {
  id: string;
}

/**
 * The note ids the upgrade's merge plan must list, in no particular group. A base note
 * counts when its `version` is newer than the previous CLI and no newer than the packed
 * one. A module note counts when its module is installed after the update: with
 * SAASALOY_REGISTRY_DIR no module has a merge base, so every note it ships prints. A note
 * whose `when` fails against that install set and the testing mode does not count.
 * Exported for its own test.
 */
export function expectedNoteIds(
  notes: readonly NoteOnDisk[],
  range: { previous: string; packed: string },
  installed: ReadonlySet<string>,
  testing: string
): string[] {
  return notes
    .filter((note) => {
      const owner = note.id.split("/")[0]!;
      if (owner === "base") {
        return (
          note.version !== undefined &&
          compareSemver(note.version, range.previous) > 0 &&
          compareSemver(note.version, range.packed) <= 0
        );
      }
      return installed.has(owner);
    })
    .filter((note) => {
      if (note.when === undefined) {
        return true;
      }
      if (note.when.testing && testing === "off") {
        return false;
      }
      return note.when.installed.every((name) => installed.has(name));
    })
    .map((note) => note.id)
    .toSorted();
}

/**
 * The modules installed after the update: what the lock holds now, plus every module the
 * new descriptors make a dependency of one, which `update` installs fresh (the shell
 * module that `admin` gained in 0.8.0 is the case). Exported for its own test.
 */
export function installedAfterUpdate(
  locked: readonly string[],
  dependsOn: ReadonlyMap<string, readonly string[]>
): Set<string> {
  const installed = new Set<string>();
  const visit = (name: string): void => {
    if (installed.has(name)) {
      return;
    }
    installed.add(name);
    for (const dependency of dependsOn.get(name) ?? []) {
      visit(dependency);
    }
  };
  for (const name of locked) {
    visit(name);
  }
  return installed;
}

/** The note ids a merge plan lists, split by the group each sits in. */
export interface PlanNotes {
  placed: string[];
  mayApply: string[];
}

/**
 * Every note id in the "Update notes" section of a merge plan on stdout. A note heading
 * before "### Notes that may apply" is placed, one after it may apply. A heading inside a
 * fenced block is a note's own text, and the section ends at the next level-2 heading.
 * Exported for its own test.
 */
export function parsePlanNotes(stdout: string): PlanNotes {
  const result: PlanNotes = { mayApply: [], placed: [] };
  let inSection = false;
  let mayApply = false;
  let fence: string | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker !== undefined) {
      if (fence === undefined) {
        fence = marker;
      } else if (marker.startsWith(fence)) {
        fence = undefined;
      }
      continue;
    }
    if (fence !== undefined) {
      continue;
    }
    if (line === "## Update notes") {
      inSection = true;
      continue;
    }
    if (!inSection) {
      continue;
    }
    if (line.startsWith("## ")) {
      break;
    }
    if (line === MAY_APPLY_HEADING) {
      mayApply = true;
      continue;
    }
    const id = NOTE_HEADING.exec(line)?.[1];
    if (id !== undefined) {
      (mayApply ? result.mayApply : result.placed).push(id);
    }
  }
  return result;
}

/**
 * What is wrong with the notes a merge plan listed against the ids expected: each id it
 * missed and each it listed that no rule expects. Empty when they match. Both groups
 * count, so a note the local registry pushes under "may apply" still matches. Exported for
 * its own test.
 */
export function checkPlanNotes(
  expected: readonly string[],
  found: PlanNotes
): string[] {
  const listed = new Set([...found.placed, ...found.mayApply]);
  const wanted = new Set(expected);
  return [
    ...expected.filter((id) => !listed.has(id)).map((id) => `missing ${id}`),
    ...[...listed]
      .filter((id) => !wanted.has(id))
      .map((id) => `unexpected ${id}`),
  ];
}

function fail(message: string, ...detail: string[]): never {
  console.error(`release-smoke: ${message}`);
  for (const line of detail) {
    console.error(`  ${line}`);
  }
  process.exit(1);
}

function step(message: string): void {
  console.log(`release-smoke: ${message}`);
}

function run(
  command: string,
  args: readonly string[],
  label: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): void {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error) {
    fail(`${label} could not start`, String(result.error));
  }
  if (result.status !== 0) {
    fail(`${label} failed`, `exit code ${String(result.status)}`);
  }
}

/** A step that failed inside a check running beside others, with the lines worth showing. */
class StepError extends Error {
  readonly detail: string[];

  constructor(message: string, detail: string[]) {
    super(message);
    this.name = "StepError";
    this.detail = detail;
  }
}

/**
 * Run a command with its output held back unless it fails, and reject with a `StepError`
 * rather than exit. Forty `saasaloy add` runs would otherwise bury the one line that
 * matters, and the full scaffolds run side by side, so their output would interleave.
 */
function runQuiet(
  command: string,
  args: readonly string[],
  label: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<void> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new StepError(`${label} could not start`, [String(error)]));
    });
    child.on("close", (code) => {
      if (code === 0) {
        done();
        return;
      }
      const lines = output.trim().split("\n").slice(-30);
      reject(
        new StepError(`${label} failed`, [
          `exit code ${String(code)}`,
          ...lines,
        ])
      );
    });
  });
}

/** Every module in the local registry, with the modules each one conflicts with. */
async function readModules(registryDir: string): Promise<ModuleEntry[]> {
  const entries: ModuleEntry[] = [];
  for (const dirent of await readdir(registryDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) {
      continue;
    }
    const descriptor = await readManifest(
      join(registryDir, dirent.name, "registry-item.json")
    );
    const conflicts = descriptor.conflictsWith;
    entries.push({
      conflictsWith: Array.isArray(conflicts)
        ? conflicts.filter((name): name is string => typeof name === "string")
        : [],
      name: dirent.name,
      dependsOn: Array.isArray(descriptor.dependsOn)
        ? descriptor.dependsOn.filter(
            (name): name is string => typeof name === "string"
          )
        : [],
      requiresOneOf: Array.isArray(descriptor.requiresOneOf)
        ? descriptor.requiresOneOf.filter(
            (name): name is string => typeof name === "string"
          )
        : [],
    });
  }
  return entries;
}

/**
 * Scaffold one project with every module in `scaffold`, then run the project's own
 * `pnpm lint`, in the order a user takes: install the base, add the modules, install
 * again. `add` formats the files it patches with the project's own Prettier, which only
 * exists after the first install.
 *
 * Testing is on (`--testing=tests-after`), because a module test ships only into a
 * project with testing on, and the project's Vitest rules reach it only here (issue
 * #266). `tdd` ships the same files.
 */
async function lintFullScaffold(
  bin: string,
  scaffold: FullScaffold,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const started = Date.now();
  const dir = join(workDir, scaffold.name);
  step(
    `scaffolding ${scaffold.name} with ${String(scaffold.modules.length)} modules`
  );
  await runQuiet(
    bin,
    ["init", scaffold.name, "--no-install", "--no-git", TESTING_FLAG],
    `saasaloy init ${scaffold.name} ${TESTING_FLAG}`,
    { cwd: workDir }
  );
  // A real project is its own git repository, and oxlint honours `.gitignore` up to
  // the repository root. Without this one, oxlint walks up into this repo, whose
  // `.gitignore` excludes `.dev/`, and finds nothing to lint.
  await runQuiet("git", ["init", "--quiet"], `git init in ${scaffold.name}`, {
    cwd: dir,
  });
  await runQuiet("pnpm", SCAFFOLD_INSTALL, `pnpm install in ${scaffold.name}`, {
    cwd: dir,
  });
  for (const name of scaffold.modules) {
    await runQuiet(
      bin,
      ["add", name, "--yes"],
      `saasaloy add ${name} in ${scaffold.name}`,
      { cwd: dir, env }
    );
  }
  await runQuiet("pnpm", SCAFFOLD_INSTALL, `pnpm install in ${scaffold.name}`, {
    cwd: dir,
  });
  await assertExists(dir, FULL_SCAFFOLD_TESTS, `add in ${scaffold.name}`);
  step(`running \`pnpm lint\` in ${scaffold.name}`);
  await runQuiet("pnpm", ["lint"], `pnpm lint in ${scaffold.name}`, {
    cwd: dir,
  });
  step(`${scaffold.name} passes \`pnpm lint\` (${seconds(started)})`);
}

/** A finished command's exit code and its two streams, kept apart. */
interface Captured {
  code: number | null;
  stdout: string;
  stderr: string;
}

/** Run a command and hold both streams apart, so stdout can be parsed on its own. */
function capture(
  command: string,
  args: readonly string[],
  label: string,
  options: { cwd: string; env?: NodeJS.ProcessEnv }
): Promise<Captured> {
  return new Promise((done, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new StepError(`${label} could not start`, [String(error)]));
    });
    child.on("close", (code) => {
      done({ code, stderr, stdout });
    });
  });
}

/** Every update note in this checkout: the base's and each module's. */
async function readNotesOnDisk(registryDir: string): Promise<NoteOnDisk[]> {
  const folders: [string, string][] = [["base", join(cliDir, "update-notes")]];
  for (const dirent of await readdir(registryDir, { withFileTypes: true })) {
    if (dirent.isDirectory()) {
      folders.push([
        dirent.name,
        join(registryDir, dirent.name, "update-notes"),
      ]);
    }
  }
  const notes: NoteOnDisk[] = [];
  for (const [owner, folder] of folders) {
    let names: string[];
    try {
      names = await readdir(folder);
    } catch {
      continue;
    }
    for (const name of names.filter((file) =>
      /^\d{4}-[a-z0-9][a-z0-9-]*\.md$/.test(file)
    )) {
      const file = join(folder, name);
      let frontmatter: NoteFrontmatter;
      try {
        frontmatter = readNoteFrontmatter(await readFile(file, "utf-8"));
      } catch (error) {
        throw new StepError(`could not read ${relative(root, file)}`, [
          String(error),
        ]);
      }
      notes.push({ ...frontmatter, id: `${owner}/${name.slice(0, -3)}` });
    }
  }
  return notes;
}

/**
 * Scaffold a project with the previous published CLI and its modules at the previous
 * release's tag, then run `update --dry-run` with the packed CLI against this checkout's
 * `modules/` (issue #298). The merge plan on stdout must list exactly the update notes
 * this project is owed, and the preview must exit as a preview does.
 *
 * It needs the network twice: npm for the previous CLI, and GitHub for the modules that
 * CLI fetches at its tag. The project is built the way a user's was, so the update meets
 * the files and the lock the previous release really wrote.
 */
async function checkUpgrade(
  bin: string,
  version: string,
  env: NodeJS.ProcessEnv
): Promise<void> {
  const started = Date.now();
  const registryDir = env.SAASALOY_REGISTRY_DIR!;
  const view = await capture(
    "npm",
    ["view", "saasaloy", "versions", "--json"],
    "npm view saasaloy versions",
    { cwd: workDir }
  );
  if (view.code !== 0) {
    throw new StepError("npm view saasaloy versions failed", [
      `exit code ${String(view.code)}`,
      ...view.stderr.trim().split("\n").slice(-10),
    ]);
  }
  const parsed = JSON.parse(view.stdout) as unknown;
  const published = (Array.isArray(parsed) ? parsed : [parsed]).filter(
    (entry): entry is string => typeof entry === "string"
  );
  const previous = previousVersion(published, version);
  if (previous === undefined) {
    throw new StepError(
      `no published saasaloy release is older than ${version}`,
      [`npm lists: ${published.join(", ")}`]
    );
  }

  const previousDir = join(scratch, "previous");
  await mkdir(previousDir, { recursive: true });
  await writeFile(
    join(previousDir, "package.json"),
    `${JSON.stringify({ name: "saasaloy-release-smoke-previous", private: true, version: "0.0.0" }, null, 2)}\n`
  );
  step(`installing saasaloy@${previous} for the upgrade step`);
  await runQuiet(
    "npm",
    ["install", "--no-audit", "--no-fund", `saasaloy@${previous}`],
    `npm install saasaloy@${previous}`,
    { cwd: previousDir }
  );
  const previousBin = join(previousDir, "node_modules/.bin/saasaloy");

  // The previous CLI fetches its modules from GitHub at its own tag, the way a user's
  // project got them. SAASALOY_REGISTRY_DIR would hand it this checkout's modules, which
  // it was never released with.
  const remoteEnv = { ...process.env };
  delete remoteEnv.SAASALOY_REGISTRY_DIR;
  const projectName = "upgrade";
  const dir = join(workDir, projectName);
  step(`scaffolding ${projectName} with saasaloy@${previous}`);
  await runQuiet(
    previousBin,
    [
      "init",
      projectName,
      "--no-install",
      "--no-git",
      `--testing=${UPGRADE_TESTING}`,
    ],
    `saasaloy@${previous} init ${projectName}`,
    { cwd: workDir, env: remoteEnv }
  );
  for (const [name, ...flags] of UPGRADE_ADDS) {
    const target = `${UPGRADE_SOURCE}@v${previous}/${String(name)}`;
    await runQuiet(
      previousBin,
      ["add", target, ...flags, "--yes"],
      `saasaloy@${previous} add ${target}`,
      { cwd: dir, env: remoteEnv }
    );
  }

  const lock = await readManifest(join(dir, "saasaloy-lock.json"));
  const locked = Object.keys(
    typeof lock.modules === "object" && lock.modules !== null
      ? lock.modules
      : {}
  );
  const modules = await readModules(registryDir);
  const installed = installedAfterUpdate(
    locked,
    new Map(modules.map((entry) => [entry.name, entry.dependsOn ?? []]))
  );
  const expected = expectedNoteIds(
    await readNotesOnDisk(registryDir),
    { packed: version, previous },
    installed,
    UPGRADE_TESTING
  );
  if (expected.length === 0) {
    throw new StepError(
      `the upgrade from ${previous} expects no update note, so the step proves nothing`,
      ["Add a module to UPGRADE_ADDS whose notes reach this range."]
    );
  }

  step(`running \`saasaloy update --dry-run\` (${version}) in ${projectName}`);
  const update = await capture(
    bin,
    ["update", "--dry-run"],
    `saasaloy update --dry-run in ${projectName}`,
    { cwd: dir, env }
  );
  if (update.code !== DRY_RUN_EXIT) {
    throw new StepError(
      `saasaloy update --dry-run in ${projectName} exited ${String(update.code)}, not ${String(DRY_RUN_EXIT)}`,
      update.stderr.trim().split("\n").slice(-30)
    );
  }
  const found = parsePlanNotes(update.stdout);
  const problems = checkPlanNotes(expected, found);
  if (problems.length > 0) {
    throw new StepError(
      `the merge plan from ${previous} to ${version} lists the wrong update notes`,
      [...problems, `expected: ${expected.join(", ")}`]
    );
  }
  for (const id of found.placed) {
    step(`update note ${id} listed`);
  }
  for (const id of found.mayApply) {
    step(`update note ${id} listed (may apply)`);
  }
  step(
    `${projectName} from ${previous} lists all ${String(expected.length)} expected update notes (${seconds(started)})`
  );
}

/** The time since `started`, as `12s`. */
function seconds(started: number): string {
  return `${String(Math.round((Date.now() - started) / 1000))}s`;
}

async function readManifest(file: string): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await readFile(file, "utf-8")) as Record<string, unknown>;
  } catch (error) {
    return fail(`could not read ${relative(root, file)}`, String(error));
  }
}

async function assertExists(
  dir: string,
  files: string[],
  label: string
): Promise<void> {
  const missing: string[] = [];
  for (const file of files) {
    try {
      await readFile(join(dir, file), "utf-8");
    } catch {
      missing.push(file);
    }
  }
  if (missing.length > 0) {
    fail(
      `${label} did not write ${String(missing.length)} expected file(s)`,
      ...missing.map((file) => join(relative(root, dir), file))
    );
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

/**
 * Start `astro dev` in the scaffolded web app, request the home page, and stop the
 * server. Returns `null` when the page answers 200 with a clean log, or the reason it
 * failed with the log tail.
 *
 * `ASTRO_DEV_BACKGROUND=1` keeps the server in this child. Astro 7 detaches the server
 * when it detects a coding agent and returns at once, which would leave the log in
 * `.astro/dev.log` and a child here that is not the server. Astro sets this variable on
 * the process it detaches, and the process that sees it skips the agent check and serves
 * in place. `--ignore-lock` looks like the public switch for this, but Astro 7.3.1 refuses
 * it outright when it detects an agent. `detached` gives the server its own process
 * group, so the stop reaches workerd as well.
 */
async function checkWebDev(webDir: string): Promise<string | null> {
  const server = spawn("pnpm", ["exec", "astro", "dev"], {
    cwd: webDir,
    detached: true,
    env: { ...process.env, ASTRO_DEV_BACKGROUND: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "";
  server.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  server.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  let exitCode: number | null | undefined;
  server.on("exit", (code) => {
    exitCode = code;
  });

  const tail = (): string => log.trim().split("\n").slice(-20).join("\n");

  try {
    const deadline = Date.now() + WEB_DEV_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (exitCode !== undefined) {
        return `astro dev exited with code ${String(exitCode)} before it answered.\n${tail()}`;
      }
      let status: number | undefined;
      try {
        const response = await fetch(WEB_DEV_URL);
        await response.arrayBuffer();
        ({ status } = response);
      } catch {
        // Not listening yet.
      }
      if (status !== undefined) {
        if (status !== 200) {
          return `${WEB_DEV_URL} answered ${String(status)}, not 200.\n${tail()}`;
        }
        const errors = findRenderErrors(log);
        if (errors.length > 0) {
          return `${WEB_DEV_URL} answered 200, but the server render logged ${String(errors.length)} React error(s):\n${errors.slice(0, 5).join("\n")}`;
        }
        return null;
      }
      await sleep(1000);
    }
    return `${WEB_DEV_URL} did not answer within ${String(WEB_DEV_TIMEOUT_MS / 1000)}s.\n${tail()}`;
  } finally {
    if (server.pid !== undefined && exitCode === undefined) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {
        // Already gone.
      }
    }
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.unknown.length > 0) {
    fail(
      `unknown argument(s): ${options.unknown.join(", ")}`,
      "usage: pnpm release:smoke [--keep] [--upgrade-only]"
    );
  }

  // --- Pack ----------------------------------------------------------------------

  await rm(scratch, { force: true, recursive: true });
  await mkdir(installDir, { recursive: true });
  await mkdir(workDir, { recursive: true });

  const sourceManifest = await readManifest(join(cliDir, "package.json"));
  const version = sourceManifest.version;
  if (typeof version !== "string") {
    fail("packages/cli/package.json has no version");
  }

  step(`packing saasaloy@${version}`);
  // `npm pack` runs prepack, so dist/ in the tarball is built from this checkout rather
  // than from whatever the last `pnpm build` left behind. It has to be prepack and not
  // prepublishOnly: npm runs prepublishOnly on `npm publish` only, which would leave this
  // smoke check packing a stale dist/ and proving nothing about the build being released.
  run("npm", ["pack", "--pack-destination", installDir], "npm pack", {
    cwd: cliDir,
  });
  const tarball = join(installDir, `saasaloy-${version}.tgz`);

  // --- Install it somewhere that is not a workspace member -------------------------

  // A package.json of its own stops npm walking up into the repo and installing there.
  await writeFile(
    join(installDir, "package.json"),
    `${JSON.stringify({ name: "saasaloy-release-smoke", private: true, version: "0.0.0" }, null, 2)}\n`
  );

  step("installing the tarball into .dev/release-smoke/install");
  run("npm", ["install", "--no-audit", "--no-fund", tarball], "npm install", {
    cwd: installDir,
  });

  // --- Assert the manifest that actually shipped ------------------------------------

  const installedRoot = join(installDir, "node_modules/saasaloy");
  const packedManifest = await readManifest(
    join(installedRoot, "package.json")
  );
  const offenders = findWorkspaceDeps(packedManifest);
  if (offenders.length > 0) {
    fail(
      `the packed manifest carries ${String(offenders.length)} workspace: range(s)`,
      ...offenders,
      "`npm publish` does not rewrite these, so the published package cannot be installed.",
      "Depend on a published version, or bundle the code into packages/cli."
    );
  }

  await assertExists(
    installedRoot,
    [
      "dist/index.js",
      // npm reads the page from this file and nothing else. 0.1.0 shipped without it and
      // the npm listing was blank, so prepack generates it and this line proves it packed.
      "README.md",
      "templates/base/package.json",
      "schemas/saasaloy.schema.json",
    ],
    "the tarball"
  );

  // --- Drive the installed bin ------------------------------------------------------

  const bin = join(installDir, "node_modules/.bin/saasaloy");
  const offlineEnv = {
    ...process.env,
    SAASALOY_REGISTRY_DIR: join(root, "modules"),
  };

  // `src/version.ts` resolves `../package.json` from `dist/index.js`. That depth only holds
  // while tsup emits one flat file and `files` ships package.json alongside dist/, and both
  // are packaging decisions this script is the last check on.
  step("running `saasaloy --version`");
  const reported = spawnSync(bin, ["--version"], {
    cwd: workDir,
    encoding: "utf-8",
  });
  if (reported.status !== 0 || !reported.stdout.includes(version)) {
    fail(
      "the installed bin does not report its own version",
      `Expected ${version}, got ${JSON.stringify(reported.stdout.trim())}.`,
      "src/version.ts reads ../package.json relative to dist/index.js — check the",
      "`files` array and tsup's output layout."
    );
  }

  // --- Upgrade from the previous release (needs the network) ------------------------

  // Issue #298. A project the previous release scaffolded must get the update notes it is
  // owed. `--upgrade-only` runs this step alone, after the pack and install above.
  const upgrade = checkUpgrade(bin, version, offlineEnv);
  // The full run reads the outcome later, through `Promise.allSettled`. A handler now keeps
  // an early rejection from counting as unhandled, which would end the process.
  upgrade.catch(() => {
    // Read below.
  });
  if (options.upgradeOnly) {
    try {
      await upgrade;
    } catch (error) {
      if (error instanceof StepError) {
        fail(error.message, ...error.detail);
      }
      throw error;
    }
    if (!options.keep) {
      await rm(scratch, { force: true, recursive: true });
    }
    console.log(
      `release-smoke: saasaloy@${version} packs, installs, and lists every update note a project from the previous release is owed.`
    );
    return;
  }

  step("running `saasaloy init smoke --no-install --no-git`");
  run(bin, ["init", "smoke", "--no-install", "--no-git"], "saasaloy init", {
    cwd: workDir,
  });
  await assertExists(projectDir, INIT_FILES, "init");

  step("running `saasaloy add api --yes` against the local registry");
  run(bin, ["add", "api", "--yes"], "saasaloy add api", {
    cwd: projectDir,
    env: offlineEnv,
  });
  await assertExists(projectDir, ADD_FILES, "add api");

  // --- Start the web app's dev server (needs the network) ---------------------------

  step("installing the scaffolded project with pnpm");
  run("pnpm", SCAFFOLD_INSTALL, "pnpm install", { cwd: projectDir });

  step(`starting \`astro dev\` in apps/web and requesting ${WEB_DEV_URL}`);
  const webDev = checkWebDev(join(projectDir, "apps/web")).then((failure) => {
    if (failure !== null) {
      throw new StepError(
        "the web app's dev server failed",
        failure.split("\n")
      );
    }
  });

  // --- Lint a project that holds every module (needs the network) -------------------

  // The repo lints each shipped file with the template's oxlint config, but only a real
  // project resolves the imports between workspaces, runs the type-aware pass over the
  // installed blocks, and formats the files `add` patches. Issue #152 found 54 errors
  // that only showed up here.
  //
  // The projects share nothing but the pnpm store, which takes concurrent installs, so
  // they run side by side with the dev server check above. In sequence they were most
  // of this script's time. Every check runs to its end, so one run reports every
  // project that fails, not only the first.
  const scaffolds = fullScaffolds(
    await readModules(offlineEnv.SAASALOY_REGISTRY_DIR)
  );
  const results = await Promise.allSettled([
    upgrade,
    webDev,
    ...scaffolds.map((scaffold) => lintFullScaffold(bin, scaffold, offlineEnv)),
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason as unknown] : []
  );
  for (const failure of failures) {
    const message =
      failure instanceof StepError ? failure.message : String(failure);
    console.error(`release-smoke: ${message}`);
    for (const line of failure instanceof StepError ? failure.detail : []) {
      console.error(`  ${line}`);
    }
  }
  if (failures.length > 0) {
    fail(`${String(failures.length)} check(s) failed, listed above`);
  }

  if (!options.keep) {
    await rm(scratch, { force: true, recursive: true });
  }

  const kept = options.keep ? ` Kept ${relative(root, scratch)}.` : "";
  console.log(
    `release-smoke: saasaloy@${version} packs, installs outside the workspace, scaffolds a project that takes the api module and serves its web app in dev, passes \`pnpm lint\` with every module and testing on in ${String(scaffolds.length)} project(s), and lists every update note a project from the previous release is owed.${kept}`
  );
}

// Only when run directly, so the test can import the pure functions above.
if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  await main();
}
