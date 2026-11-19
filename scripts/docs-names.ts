// Checks that a wiki page names only things that exist (plan 0114, Phase 5). A page that
// says "run `saasaloy add --dry`" after the flag is gone is wrong in a way no link check
// finds, so every command, flag, module name and env var a page puts in backticks is looked
// up in the code:
//
//   - a command and its flags: `scripts/llms-txt.ts` reads them (`llmsSurfaceProblems`), from
//     the command sources here, because the gate runs before the CLI is built;
//   - a module name: an argument of `saasaloy add` or `saasaloy remove`, or the folder in a
//     `modules/<name>` path, must be a folder under `modules/`;
//   - an env var: a span in SCREAMING_SNAKE_CASE must be a key some descriptor declares in
//     `envVars`, or one of OUTSIDE_ENV below.
//
// `scripts/docs-names.test.ts` runs it over every hand-written page in the wikimap, so
// `pnpm test:scripts` catches a page that went stale. A generated page is skipped: the
// generator writes it from the code, `pnpm docs:check` keeps it current, and a module page
// quotes the module's skill, which also talks about the generated project's own flags and
// constants.
//
// "Exists" for a flag with no command and for an env var means the name appears in code the
// CLI or a scaffold ships: `packages/cli/src` (not its tests), `packages/cli/templates/base`
// and `modules/`. A page that names a flag a tool outside the repo owns, such as git's
// `--no-verify`, needs a line in OUTSIDE_FLAGS.
//
// Imports node: builtins and the repo's scripts only. Node 24 strips the types.

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceCliSurface } from "./docs-generate.ts";
import { handWritten, readWikimap, WIKI_DIR } from "./docs-wikimap.ts";
import { llmsSurfaceProblems, releaseSkills } from "./llms-txt.ts";
import type { CliSurface } from "./llms-txt.ts";

/**
 * Env vars a page may name that no shipped code holds. Each entry needs a reason.
 */
export const OUTSIDE_ENV: Readonly<Record<string, string>> = {
  CLOUDFLARE_DEFAULT_ACCOUNT_ID:
    "read by the retired infra module's Pulumi stack, which the runbook moves a project off",
  PULUMI_CONFIG_PASSPHRASE:
    "read by Pulumi, which the retired infra module ran",
};

/** Flags a page may name that belong to a tool outside the repo. */
export const OUTSIDE_FLAGS: Readonly<Record<string, string>> = {
  "--no-verify":
    "git commit and git push, which the reference tells a reader not to use",
};

/** What a page may name: the CLI, the skills, the modules and the env vars. */
export interface Names {
  surface: CliSurface;
  skills: ReadonlySet<string>;
  modules: ReadonlySet<string>;
  /** Every env var and `--flag` the shipped code names. */
  tokens: ReadonlySet<string>;
}

const ENV_VAR = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
const MODULE_ARG = /^[a-z][a-z0-9-]*(?:@\S+)?$/;
const MODULE_PATH = /^modules\/([a-z][a-z0-9-]*)(?:\/|$)/;
const MODULE_COMMAND =
  /^(?:npx |pnpm dlx |pnpm exec )?saasaloy\s+(?:add|remove)\s+(.+)$/;

const CODE_FILE = /\.(?:ts|tsx|js|mjs|json|jsonc|ya?ml|astro|sh)$/;
const TOKEN = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b|(?<![\w-])--[a-z][a-z0-9-]*/g;

function scan(dir: string, tokens: Set<string>): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!["node_modules", "dist", "skills", ".astro"].includes(entry.name)) {
        scan(join(dir, entry.name), tokens);
      }
    } else if (
      CODE_FILE.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name)
    ) {
      for (const match of readFileSync(join(dir, entry.name), "utf-8").matchAll(
        TOKEN
      )) {
        tokens.add(match[0]);
      }
    }
  }
}

/** The names the code defines, read from `root`. */
export function readNames(root: string): Names {
  const modules = new Set<string>();
  const tokens = new Set<string>();
  for (const name of readdirSync(join(root, "modules"))) {
    if (existsSync(join(root, "modules", name, "registry-item.json"))) {
      modules.add(name);
    }
  }
  for (const dir of [
    "packages/cli/src",
    "packages/cli/templates/base",
    "modules",
  ]) {
    scan(join(root, dir), tokens);
  }
  const skills = new Set(releaseSkills(root));
  const dev = join(root, ".agents", "skills");
  for (const name of existsSync(dev) ? readdirSync(dev) : []) {
    skills.add(name);
  }
  const surface = sourceCliSurface(root);
  // `saasaloy help` and `saasaloy version` answer like their flags (packages/cli/src/cli.ts).
  const commands = new Map([
    ...surface.commands,
    ["help", new Set<string>()],
    ["version", new Set<string>()],
  ]);
  return { surface: { ...surface, commands }, skills, modules, tokens };
}

function codeSpans(markdown: string): string[] {
  // A fenced block is a sample, so only the spans in running text count.
  const prose = markdown.replaceAll(/^(```|~~~)[\s\S]*?^\1.*$/gm, "");
  return [...prose.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

/**
 * Why `markdown` names something that does not exist, one line each, without repeats;
 * empty when every name is real.
 */
export function nameProblems(markdown: string, names: Names): string[] {
  const problems = llmsSurfaceProblems(
    markdown.replaceAll(/^(```|~~~)[\s\S]*?^\1.*$/gm, ""),
    names.surface,
    names.skills
  ).filter((problem) => {
    // A placeholder such as `saasaloy-<name>` names no skill.
    if (/^the skill "[^"]*<[^"]*>"/.test(problem)) {
      return false;
    }
    // A bare flag only has to exist somewhere in the shipped code, or belong to a named tool.
    const flag = /^the flag "(-[^"]+)" is not a flag of any command$/.exec(
      problem
    )?.[1];
    return (
      flag === undefined || !(names.tokens.has(flag) || flag in OUTSIDE_FLAGS)
    );
  });
  const report = (problem: string): void => {
    if (!problems.includes(problem)) {
      problems.push(problem);
    }
  };
  for (const span of codeSpans(markdown)) {
    if (ENV_VAR.test(span)) {
      if (!names.tokens.has(span) && !(span in OUTSIDE_ENV)) {
        report(`the env var "${span}" is in no shipped code`);
      }
      continue;
    }
    const path = MODULE_PATH.exec(span)?.[1];
    if (path !== undefined && !names.modules.has(path)) {
      report(`the module "${path}" is not in modules/`);
      continue;
    }
    const args = MODULE_COMMAND.exec(span)?.[1];
    for (const arg of args?.split(/\s+/) ?? []) {
      if (!MODULE_ARG.test(arg)) {
        continue;
      }
      const name = arg.split("@")[0] ?? arg;
      if (!names.modules.has(name)) {
        report(`the module "${name}" is not in modules/`);
      }
    }
  }
  return problems;
}

/** The problems of every hand-written wiki page, keyed by path; a page with none is left out. */
export function wikiProblems(root: string): Map<string, string[]> {
  const names = readNames(root);
  const found = new Map<string, string[]>();
  for (const page of handWritten(readWikimap(root))) {
    const file = `${WIKI_DIR}/${page.path}`;
    const problems = nameProblems(
      readFileSync(join(root, file), "utf-8"),
      names
    );
    if (problems.length > 0) {
      found.set(file, problems);
    }
  }
  return found;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  const found = wikiProblems(root);
  for (const [file, problems] of found) {
    console.error(`${file}\n${problems.map((p) => `  ${p}`).join("\n")}`);
  }
  process.exitCode = found.size === 0 ? 0 : 1;
}
