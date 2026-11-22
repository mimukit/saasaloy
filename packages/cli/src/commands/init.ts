import { spawn } from "node:child_process";
import { mkdir, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { cancel, intro, isCancel, note, outro, spinner } from "@clack/prompts";
import pc from "picocolors";
import { apply } from "../engine/apply.js";
import type { ApplyReport } from "../engine/apply.js";
import { loadSide } from "../engine/project.js";
import type { RenderOptions } from "../engine/render.js";
import { pathExists } from "../lib/fs-utils.js";
import type { SkillLinkResult } from "../lib/skill-links.js";
import { linkAgentSkills } from "../lib/skill-links.js";
import {
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { logger } from "../lib/logger.js";
import { select, text } from "../lib/prompts.js";
import {
  DEFAULT_TESTING_MODE,
  parseTestingMode,
  TESTING_MODES,
} from "../lib/testing.js";
import type { TestingMode } from "../lib/testing.js";
import {
  DEFAULT_THEME,
  parseThemeName,
  THEME_NAMES,
  THEMES,
} from "../lib/theme.js";
import type { ThemeName } from "../lib/theme.js";
import { isInteractive, stripAnsi, wrapForNote } from "../lib/tui.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { readVersion } from "../version.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy init <name>` — scaffold the near-inert base (Astro landing + @repo/ui
// + @repo/tsconfig) and print next steps. The scaffold is one apply from nothing to the
// base template (plan 0116): it writes the render, one manifest record per file, and the
// lock with its `base` record, so `outdated`, `update` and `doctor` can speak about the
// base afterwards. The `.claude/skills/*` links for the skills the base carries are
// per-machine symlinks, not files (see linkBaseSkills). Modules (api, database, auth,
// admin, features) are added later with `saasaloy add`, which brings their own skills.

// wrangler and npm package names share this constraint.
const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface InitOptions {
  name?: string;
  force: boolean;
  noInstall: boolean;
  /** Install with no prompt — the answer `--no-install` is the opposite of. */
  yes: boolean;
  noGit: boolean;
  /**
   * `--testing=<mode>`, raw (#242). `runInit` parses it before anything is written, so a
   * bad value is a refusal rather than a scaffold with a guessed mode.
   */
  testing?: string;
  /**
   * `--theme=<name>`, raw (plan 0121). Parsed before anything is written, like `--testing`,
   * so an unknown name is a refusal that lists the names.
   */
  theme?: string;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set([
  "--force",
  "--no-install",
  "--no-git",
  "--yes",
  "-y",
  "--help",
  "-h",
]);
const TESTING_FLAG = "--testing=";
const THEME_FLAG = "--theme=";
const USAGE = `saasaloy init [<name>] [--force] [--yes | --no-install] [--no-git] [--testing=<${TESTING_MODES.join("|")}>] [--theme=<${THEME_NAMES.join("|")}>]`;
const HELP: CommandHelp = {
  name: "init",
  describe: DESCRIPTIONS.init,
  usage: USAGE,
  flags: {
    "--force": "scaffold into a directory that is not empty",
    "-y, --yes":
      "run pnpm install with no prompt, and take the neutral theme when --theme is absent",
    "--no-install": "never run pnpm install, and never ask",
    "--no-git": "do not run git init or make the first commit",
    "--testing=<mode>":
      "the testing mode: off (default), tests-after or tdd; asked on a terminal when absent",
    "--theme=<name>":
      "the Saasaloy UI theme brand.css takes: neutral (default), cobalt, ember or moss; asked on a terminal when absent",
  },
};

/** Split `init`'s argv into options. Exported for its own tests, like `add`'s. */
export function parseArgs(argv: string[]): InitOptions {
  const positional: string[] = [];
  const unknown: string[] = [];
  let testing: string | undefined;
  let theme: string | undefined;
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      positional.push(arg);
    } else if (arg.startsWith(TESTING_FLAG)) {
      testing = arg.slice(TESTING_FLAG.length);
    } else if (arg.startsWith(THEME_FLAG)) {
      theme = arg.slice(THEME_FLAG.length);
    } else if (!KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  unknown.push(...positional.slice(1));
  return {
    force: argv.includes("--force"),
    name: positional[0],
    // Skip the install prompt entirely and never run pnpm install — for scripted/CI
    // scaffolds (e.g. `pnpm play:init`) that manage installs themselves.
    noInstall: argv.includes("--no-install"),
    yes: argv.includes("--yes") || argv.includes("-y"),
    noGit: argv.includes("--no-git"),
    ...(testing === undefined ? {} : { testing }),
    ...(theme === undefined ? {} : { theme }),
    unknown,
  };
}

export interface TestingPrompt {
  /** Whether a person can answer: stdin and stdout are terminals (`isInteractive`). */
  interactive: boolean;
  /** Ask for the mode. Resolves to clack's cancel symbol when the person backs out. */
  ask: () => Promise<TestingMode | symbol>;
}

/**
 * The mode `init` records (#242). A flag wins. With no flag, a terminal gets one question;
 * no terminal reads `off`, the opt-in default rather than a guess (ADR 0046). Exported with
 * the prompt injected, so the attended path is tested without a terminal.
 */
export async function resolveInitTestingMode(
  flag: TestingMode | undefined,
  prompt: TestingPrompt
): Promise<TestingMode | symbol> {
  if (flag !== undefined) {
    return flag;
  }
  if (!prompt.interactive) {
    return DEFAULT_TESTING_MODE;
  }
  return prompt.ask();
}

export interface ThemePrompt {
  /** Whether a person can answer: stdin and stdout are terminals (`isInteractive`). */
  interactive: boolean;
  /** `--yes`: the run asks nothing it can default, so the theme reads `neutral`. */
  yes: boolean;
  /** Ask for the theme. Resolves to clack's cancel symbol when the person backs out. */
  ask: () => Promise<ThemeName | symbol>;
}

/**
 * The theme `init` writes (plan 0121), the same way `--testing` resolves. A flag wins.
 * With no flag, a terminal gets one question; `--yes` or no terminal reads `neutral`, the
 * template's own tokens. Exported with the prompt injected, so it is tested without a
 * terminal.
 */
export async function resolveInitTheme(
  flag: ThemeName | undefined,
  prompt: ThemePrompt
): Promise<ThemeName | symbol> {
  if (flag !== undefined) {
    return flag;
  }
  if (prompt.yes || !prompt.interactive) {
    return DEFAULT_THEME;
  }
  return prompt.ask();
}

function askTheme(): Promise<ThemeName | symbol> {
  return select<ThemeName>({
    answeredBy: "`--theme=<name>`",
    message: "Theme?",
    options: THEME_NAMES.map((name) => ({
      value: name,
      label: THEMES[name].title,
      hint: THEMES[name].description,
    })),
    initialValue: DEFAULT_THEME,
  });
}

function askTestingMode(): Promise<TestingMode | symbol> {
  return select<TestingMode>({
    answeredBy: "`--testing=<mode>`",
    message: "Testing mode?",
    options: [
      {
        value: "off",
        label: "Off",
        hint: "no module tests; turn them on later with `saasaloy testing`",
      },
      {
        value: "tests-after",
        label: "Tests after",
        hint: "each change ships with its test",
      },
      {
        value: "tdd",
        label: "TDD",
        hint: "write the failing test first",
      },
    ],
    initialValue: DEFAULT_TESTING_MODE,
  });
}

interface RunResult {
  ok: boolean;
  message?: string;
  /** The child's stdout, set when it exited 0. */
  stdout?: string;
}

// Run one child process in the scaffolded project. Output is buffered (not streamed)
// so only the caller's spinner shows; both streams are captured so a failure can
// report *why*. pnpm writes its `ERR_PNPM_*` diagnostics to stdout, not stderr,
// so we keep both. Never throws — failures come back as { ok: false } so init
// can carry on regardless.
function run(command: string, args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    // On Windows pnpm is `pnpm.cmd`, which bare spawn won't resolve — go via the shell there.
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      // e.g. pnpm not on PATH.
      resolvePromise({ ok: false, message: err.message });
    });
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise({ ok: true, stdout });
      } else {
        // Prefer pnpm's own diagnostics (stderr, then stdout); fall back to the code.
        const details = [stderr.trim(), stdout.trim()]
          .filter(Boolean)
          .join("\n");
        resolvePromise({
          ok: false,
          message:
            details ||
            `${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`,
        });
      }
    });
  });
}

function runPnpmInstall(cwd: string): Promise<RunResult> {
  return run("pnpm", ["install"], cwd);
}

// Make the scaffold a git repository. ADR 0024, CONTRIBUTING and the QA plans all say
// `init` does this, and until #98 none of them was true: husky's `prepare` hook has no
// repository to install into, and turbo falls back to a global cache key that can serve
// a stale build of a previous template. Skipped when the target already sits inside a
// working tree that tracks it — `saasaloy init .` inside an existing repo must not nest a
// second one. An ignored target is not the outer repository's business, so it gets its
// own: that is what gives `.dev/playground` inside this repo a repository (ADR 0024).
export async function initGitRepo(
  cwd: string
): Promise<{ created: boolean; message?: string }> {
  const inside = await run("git", ["rev-parse", "--is-inside-work-tree"], cwd);
  if (inside.ok) {
    const ignored = await run("git", ["check-ignore", "--quiet", "."], cwd);
    if (!ignored.ok) {
      return { created: false };
    }
  }
  const result = await run("git", ["init", "--initial-branch=main"], cwd);
  if (!result.ok) {
    return { created: false, message: result.message ?? "git init failed" };
  }
  return { created: true };
}

/** The subject of the scaffold's first commit (plan 0109). */
export const INITIAL_COMMIT = "chore(repo): initial commit";

async function gitConfigValue(cwd: string, key: string): Promise<string> {
  const result = await run("git", ["config", "--get", key], cwd);
  return result.ok ? (result.stdout ?? "").trim() : "";
}

// True when git can name an author and a committer here. Without one, `git commit` either
// refuses or invents a `user@host` identity, and neither belongs in a project's history.
async function hasGitIdentity(cwd: string): Promise<boolean> {
  const fromEnv = (kind: "NAME" | "EMAIL"): boolean =>
    Boolean(
      process.env[`GIT_AUTHOR_${kind}`] && process.env[`GIT_COMMITTER_${kind}`]
    );
  const name = fromEnv("NAME") || (await gitConfigValue(cwd, "user.name"));
  const email = fromEnv("EMAIL") || (await gitConfigValue(cwd, "user.email"));
  return Boolean(name) && Boolean(email);
}

// Commit the scaffold on `main`, so a build branch has a base and `main..build/mvp` has a
// meaning (plan 0109). `--no-verify` skips the scaffold's own hooks: once `pnpm install`
// ran, husky's pre-commit runs lint-staged over every file of the scaffold, and that is
// slow and checks files no person wrote. `pnpm check` is the gate for those files.
export async function commitScaffold(
  cwd: string
): Promise<{ committed: boolean; reason?: "identity"; message?: string }> {
  if (!(await hasGitIdentity(cwd))) {
    return { committed: false, reason: "identity" };
  }
  const add = await run("git", ["add", "--all"], cwd);
  if (!add.ok) {
    return { committed: false, message: add.message ?? "git add failed" };
  }
  const commit = await run(
    "git",
    ["commit", "--quiet", "--no-verify", "--message", INITIAL_COMMIT],
    cwd
  );
  if (!commit.ok) {
    return { committed: false, message: commit.message ?? "git commit failed" };
  }
  return { committed: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Some of the base's skills run in an order — saasaloy-setup writes the brief that
// saasaloy-landing-copy reads — and readdir's alphabetical order happens to invert exactly
// that pair. There is no manifest to read a dependency out of, and inventing one for two
// skills would cost more than it explains, so the order is listed here. Anything not named
// keeps its directory order, after these.
const SKILL_ORDER = ["saasaloy-setup"];

function bySkillOrder(a: string, b: string): number {
  const rank = (name: string) => {
    const at = SKILL_ORDER.indexOf(name);
    return at === -1 ? SKILL_ORDER.length : at;
  };
  return rank(a) - rank(b);
}

// Point `.claude/skills/<name>` at each skill the base ships, so Claude Code discovers it
// the moment scaffolding finishes rather than after the owner reads AGENTS.md.
//
// The real files travel in `.agents/skills/`, readable by every agent, and committed,
// because the template's .gitignore ignores `.claude/skills/` (the link is a per-machine
// artefact). `linkAgentSkills` is the one rule `init`, `add` and `update` share (ADR 0015),
// and it never fails `init`: a path already occupied by something that isn't ours is
// reported and left exactly as it was.
function linkBaseSkills(target: string): Promise<SkillLinkResult> {
  return linkAgentSkills(target, bySkillOrder);
}

export async function runInit(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }

  intro(pc.bgCyan(pc.black(" saasaloy init ")));

  // A prompt with no terminal throws a refusal (lib/prompts.ts), and so can a write.
  // Either one lands on the rail with its exit code rather than escaping to index.ts.
  try {
    return await initProject(opts);
  } catch (error) {
    cancel(formatFailure(error));
    return exitCodeFor(error);
  }
}

async function initProject(opts: InitOptions): Promise<number> {
  const { force, noInstall, noGit, yes } = opts;
  let nameArg = opts.name;

  // A bad mode is caught before the name prompt and before a byte is written (#242).
  let testingFlag: TestingMode | undefined;
  if (opts.testing !== undefined) {
    try {
      testingFlag = parseTestingMode(opts.testing);
    } catch (error) {
      cancel(`${errorMessage(error)} Usage: \`${USAGE}\`.`);
      return EXIT_REFUSED;
    }
  }
  let themeFlag: ThemeName | undefined;
  if (opts.theme !== undefined) {
    try {
      themeFlag = parseThemeName(opts.theme);
    } catch (error) {
      cancel(`${errorMessage(error)} Usage: \`${USAGE}\`.`);
      return EXIT_REFUSED;
    }
  }

  // `init` ignored every flag it did not know, while `add`/`remove`/`update` rejected
  // theirs — so `saasaloy init app --forse` scaffolded into a non-empty directory and
  // said nothing. One rule now (#98).
  if (opts.unknown.length > 0) {
    cancel(
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`
    );
    return EXIT_REFUSED;
  }

  // The two flags give opposite answers to the install prompt. Refuse rather than let
  // one of them win (ADR 0046: refuse, never guess).
  if (yes && noInstall) {
    cancel(
      `\`--yes\` installs and \`--no-install\` does not — pass one of them, not both.`
    );
    return EXIT_REFUSED;
  }

  // With no terminal, every question init would ask has to be answered by a flag, and
  // each refusal comes before a single file is written: a refusal that leaves a half-made
  // project behind is not a clean one. The guarded prompts would refuse too, but the
  // install prompt only after the scaffold landed. This check runs first, because there
  // is no name to check yet. The install check runs below, after the name and directory
  // checks, so a bad name still gets its own message first.
  if (!nameArg && !isInteractive()) {
    cancel(
      `No project name and no terminal to ask for one — pass \`<name>\` (usage: \`${USAGE}\`).`
    );
    return EXIT_REFUSED;
  }

  // No name given — ask for it rather than erroring out.
  if (!nameArg) {
    const answer = await text({
      answeredBy: "`<name>`",
      message: "Project name?",
      placeholder: "my-app (use `.` for the current directory)",
      validate: (value) => {
        const trimmed = value?.trim() ?? "";
        if (!trimmed) {
          return "Enter a project name (or `.` for the current directory).";
        }
        // Mirror the arg path: name is the basename of the resolved target.
        const name = basename(resolve(process.cwd(), trimmed));
        if (!NAME_PATTERN.test(name)) {
          return "Use lowercase letters, digits, and hyphens (e.g. my-app).";
        }
        // clack accepts a value only on an explicit `undefined`, and consistent-return
        // rejects a bare `return`.
        // oxlint-disable-next-line unicorn/no-useless-undefined
        return undefined;
      },
    });
    if (isCancel(answer)) {
      cancel("init cancelled");
      return EXIT_FAILURE;
    }
    nameArg = answer.trim();
  }

  // nameArg may be a bare name (`my-app`), `.`, or a path (`./apps/my-app`).
  const target = resolve(process.cwd(), nameArg);
  const projectName = basename(target);

  if (!NAME_PATTERN.test(projectName)) {
    cancel(
      `Invalid project name "${projectName}". Use lowercase letters, digits, and hyphens (e.g. my-app).`
    );
    return EXIT_REFUSED;
  }

  if (await pathExists(target)) {
    const entries = (await readdir(target)).filter((e) => e !== ".git");
    if (entries.length > 0 && !force) {
      cancel(
        `Directory ${nameArg} is not empty. Re-run with --force to scaffold into it anyway.`
      );
      return EXIT_REFUSED;
    }
  }

  if (!yes && !noInstall && !isInteractive()) {
    cancel(
      "No terminal to ask whether to install dependencies — pass `--yes` to run pnpm install, or `--no-install` to skip it. Nothing was written."
    );
    return EXIT_REFUSED;
  }

  const testingMode = await resolveInitTestingMode(testingFlag, {
    interactive: isInteractive(),
    ask: askTestingMode,
  });
  if (isCancel(testingMode)) {
    cancel("init cancelled");
    return EXIT_FAILURE;
  }

  const theme = await resolveInitTheme(themeFlag, {
    interactive: isInteractive(),
    yes,
    ask: askTheme,
  });
  if (isCancel(theme)) {
    cancel("init cancelled");
    return EXIT_FAILURE;
  }

  const scaffolded = await scaffold(target, projectName, testingMode, theme);
  if (scaffolded !== undefined) {
    return scaffolded;
  }

  // Before the install: husky's `prepare` script runs during `pnpm install` and needs a
  // repository to install its hooks into.
  let gitCreated = false;
  if (!noGit) {
    const git = await initGitRepo(target);
    gitCreated = git.created;
    if (git.created) {
      logger.step(`Initialized a git repository ${pc.dim("(git init)")}.`);
    } else if (git.message) {
      logger.warn(
        `Couldn't run ${pc.cyan("git init")}: ${git.message} ` +
          `${pc.dim("(the scaffold is fine — run it yourself)")}.`
      );
    }
  }

  const skills = await linkBaseSkills(target);
  if (skills.linked.length > 0) {
    const lines = skills.linked.map(
      (name) =>
        `${pc.cyan(`.claude/skills/${name}`)} ${pc.dim(`→ .agents/skills/${name}`)}`
    );
    note(
      wrapForNote(
        `${lines.join("\n")}\n\n${pc.dim("Symlinked for Claude Code — the skill files live in `.agents/skills/`.")}`
      ),
      "Skill links"
    );
  }
  if (skills.unreadable) {
    logger.warn(
      `Couldn't read ${pc.cyan(".agents/skills")}: ${skills.unreadable} ` +
        `${pc.dim("(the skill files are still there — fix the permissions and re-run init to link them)")}.`
    );
  }
  for (const name of skills.conflicts) {
    logger.warn(
      `Skill link ${pc.cyan(`.claude/skills/${name}`)} already exists and isn't ours — ` +
        `left untouched ${pc.dim("(remove it, then re-run to link the skill)")}.`
    );
  }
  for (const failure of skills.failures) {
    logger.warn(
      `Couldn't link skill ${pc.cyan(failure.name)}: ${failure.message} ` +
        `${pc.dim("(the skill files are still in `.agents/skills/`)")}.`
    );
  }

  // Offer to install now; on decline (or cancel) fall back to the printed steps.
  // `select` (not `confirm`) so each choice renders on its own line. `--yes` and
  // `--no-install` each answer it ahead of time.
  let installed = false;
  let wantsInstall: boolean | symbol = yes;
  if (!yes && !noInstall) {
    wantsInstall = await select({
      answeredBy: "`--yes` to install, or `--no-install` to skip it",
      message: "Install dependencies now?",
      options: [
        { value: true, label: `Yes, run ${pc.cyan("pnpm install")}` },
        { value: false, label: "No, I'll run it later" },
      ],
      initialValue: true,
    });
  }
  if (!isCancel(wantsInstall) && wantsInstall) {
    const install = spinner();
    install.start(`Installing dependencies ${pc.dim("(pnpm install)")}`);
    const result = await runPnpmInstall(target);
    if (result.ok) {
      installed = true;
      install.stop(`Installed dependencies ${pc.dim("(pnpm install)")}`);
    } else {
      // A failed install is a failed run (exit 1), so a script or an agent that asked
      // for it can tell. The scaffold stays on disk: it is complete, and the install is
      // the one step left to finish by hand.
      install.stop(pc.red("pnpm install failed"));
      if (result.message) {
        // Show pnpm's own diagnostics inside a box, tail-trimmed and soft-wrapped to
        // the terminal width so a long line (e.g. a registry URL) can't break the rail.
        const lines = stripAnsi(result.message)
          .split("\n")
          .filter((line) => line.trim() !== "");
        // Color each line individually: clack's `note` splits on \n and prefixes each
        // line, so a single wrapping color would only tint the first one.
        const body = wrapForNote(lines.slice(-12).join("\n"))
          .split("\n")
          .map((line) => pc.dim(pc.red(line)))
          .join("\n");
        note(body, "pnpm install output");
      }
      cancel(
        `Scaffolded ${projectName}, but pnpm install failed — fix the error above, then run ${pc.cyan("pnpm install")} in ${nameArg}.`
      );
      return EXIT_FAILURE;
    }
  }

  // Write each service's `.env` from the key list's local defaults, so `pnpm check` and
  // `pnpm dev` pass with no env step (plan 0109). Only in a repository init made: the
  // script finds the project root through git. A failure is a warning, because the
  // scaffold is complete and the command is the one step left to run by hand.
  let envWritten = false;
  if (installed && gitCreated) {
    const envSetup = await run("pnpm", ["env:setup"], target);
    envWritten = envSetup.ok;
    if (envSetup.ok) {
      logger.step(
        `Wrote each service's .env from the local defaults ${pc.dim("(pnpm env:setup)")}.`
      );
    } else {
      logger.warn(
        `Couldn't run ${pc.cyan("pnpm env:setup")}: ${stripAnsi(envSetup.message ?? "").trim()} ` +
          `${pc.dim("(the scaffold is fine — fix the error, then run it yourself)")}.`
      );
    }
  }

  // Last, so the commit holds the lockfile the install wrote. Only in a repository init
  // made: a repository that already existed is its owner's history, not ours.
  if (gitCreated) {
    const commit = await commitScaffold(target);
    if (commit.committed) {
      logger.step(
        `Committed the scaffold on main ${pc.dim(`(${INITIAL_COMMIT})`)}.`
      );
    } else if (commit.reason === "identity") {
      logger.warn(
        `Made no commit: no git identity is set (user.name and user.email). ` +
          `Set one with ${pc.cyan("git config --global user.name")} and ${pc.cyan("user.email")}, ` +
          `then run ${pc.cyan(`git add --all && git commit -m "${INITIAL_COMMIT}"`)}.`
      );
    } else {
      logger.warn(
        `Couldn't commit the scaffold: ${commit.message ?? "git commit failed"} ` +
          `${pc.dim(`(the scaffold is fine — commit it yourself as "${INITIAL_COMMIT}")`)}.`
      );
    }
  }

  // One path (plan 0109): `init`, the interview, the build. The interview skill starts
  // the build itself, so the list names no second skill and no `pnpm dev`: a dev server
  // started before `pnpm env:setup` fails on the missing env files.
  const steps = [
    nameArg === "." ? null : `cd ${nameArg}`,
    installed ? null : "pnpm install",
    envWritten
      ? null
      : `${"pnpm env:setup".padEnd(22)}${pc.dim("# write each service's .env")}`,
    `${"/saasaloy-setup".padEnd(22)}${pc.dim("# the interview; it starts the build")}`,
  ]
    .filter((line): line is string => line !== null)
    .map((line) => pc.cyan(line))
    .join("\n");

  note(steps, "Next steps");
  outro(pc.green(`🎉 Created ${projectName} successfully.`));
  return EXIT_OK;
}

/**
 * `init`'s scaffold on the render engine (plan 0116): one apply from nothing to the base
 * template, with the project's name and testing mode. Writes manifest version 2 and the
 * lock with an empty `requested` list. The caller has checked the target and the flags.
 */
export async function scaffoldProject(args: {
  target: string;
  projectName: string;
  testingMode: RenderOptions["testingMode"];
  theme?: RenderOptions["theme"];
}): Promise<ApplyReport> {
  const cliVersion = await readVersion();
  const options: RenderOptions = {
    projectName: args.projectName,
    ...(args.testingMode === undefined
      ? {}
      : { testingMode: args.testingMode }),
    ...(args.theme === undefined ? {} : { theme: args.theme }),
  };
  const { side } = await loadSide(
    { coordinates: new Map(), options, requested: [], version: cliVersion },
    { cliVersion }
  );
  await mkdir(args.target, { recursive: true });
  return apply({ next: side, root: args.target, version: cliVersion });
}

/** The scaffold step of `init`. Returns an exit code when it fails, `undefined` when it succeeds. */
async function scaffold(
  target: string,
  projectName: string,
  testingMode: TestingMode,
  theme: ThemeName
): Promise<number | undefined> {
  const s = spinner();
  s.start(`Scaffolding ${pc.cyan(projectName)}`);
  try {
    await scaffoldProject({ projectName, target, testingMode, theme });
  } catch (error) {
    s.stop(pc.red(`Couldn't scaffold ${projectName}`));
    cancel(errorMessage(error));
    return exitCodeFor(error);
  }
  s.stop(
    `Scaffolded ${pc.cyan(projectName)} ${pc.dim("(apps/web · packages/ui · packages/tsconfig)")}`
  );
  return undefined;
}
