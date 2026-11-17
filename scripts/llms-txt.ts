// Reading the root `llms.txt`: its links, and the skills, commands and flags it names.
//
// `scripts/llms-txt.test.ts` checks that every link resolves to a file in this repo.
// `scripts/release-preflight.ts` checks that every skill, command and flag the file names
// is in the release (ADR 0062). The release is two things an agent gets:
//
// - the npm package: the base skills under `packages/cli/templates/base/_agents/skills/`,
//   and the commands and flags the built CLI's `--help` prints;
// - the registry at the release tag, which is this commit's `modules/`, so a module skill
//   under `modules/<name>/skills/` counts too.
//
// Imports node: builtins only. Node 24 strips the types, so there is no build step.

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const REPO_URL = "https://github.com/mimukit/saasaloy/";

/** The repo path a link names, or `undefined` for a link that points outside the repo. */
export function repoPath(href: string): string | undefined {
  const target = href.split("#")[0] ?? "";
  if (target.startsWith(REPO_URL)) {
    const match = /^(?:blob|tree)\/[^/]+\/(.+)$/.exec(
      target.slice(REPO_URL.length)
    );
    return match?.[1];
  }
  if (/^[a-z]+:/i.test(target) || target === "") {
    return undefined;
  }
  return target.replace(/^\.\//, "");
}

export function links(markdown: string): string[] {
  return [...markdown.matchAll(/\]\(([^)\s]+)\)/g)].map(
    (match) => match[1] ?? ""
  );
}

/** What the built CLI registers: each command's flags, and the flags of `saasaloy` itself. */
export interface CliSurface {
  commands: ReadonlyMap<string, ReadonlySet<string>>;
  globalFlags: ReadonlySet<string>;
}

// The flags in the left column of a help section: `-y, --yes`, `--with <module>`,
// `--testing=<mode>` give `-y`, `--yes`, `--with` and `--testing`.
function sectionFlags(help: string, heading: string): string[] {
  const start = help.split("\n").findIndex((line) => line.trim() === heading);
  if (start === -1) {
    return [];
  }
  const flags: string[] = [];
  for (const line of help.split("\n").slice(start + 1)) {
    if (!line.startsWith("  ")) {
      break;
    }
    const column = line.trim().split(/\s{2,}/)[0] ?? "";
    for (const part of column.split(", ")) {
      const flag = part.split(/[= ]/)[0] ?? "";
      if (flag.startsWith("-")) {
        flags.push(flag);
      }
    }
  }
  return flags;
}

/**
 * The CLI surface from its help text: `topHelp` is `saasaloy --help`, and `commandHelp`
 * maps each command to `saasaloy <command> --help`.
 */
export function cliSurface(
  topHelp: string,
  commandHelp: Readonly<Record<string, string>>
): CliSurface {
  const lines = topHelp.split("\n");
  const start = lines.findIndex((line) => line.trim() === "Commands:");
  const names: string[] = [];
  for (const line of start === -1 ? [] : lines.slice(start + 1)) {
    const name = /^ {2}([a-z][a-z-]*)\s/.exec(line)?.[1];
    if (!name) {
      break;
    }
    names.push(name);
  }
  return {
    commands: new Map(
      names.map((name) => [
        name,
        new Set(sectionFlags(commandHelp[name] ?? "", "Flags:")),
      ])
    ),
    globalFlags: new Set(sectionFlags(topHelp, "Options:")),
  };
}

/** Every skill folder with a `SKILL.md` in the release: the base's and the modules'. */
export function releaseSkills(root: string): Set<string> {
  const skills = new Set<string>();
  const collect = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const name of readdirSync(dir)) {
      if (existsSync(join(dir, name, "SKILL.md"))) {
        skills.add(name);
      }
    }
  };
  collect(
    join(root, "packages", "cli", "templates", "base", "_agents", "skills")
  );
  const modules = join(root, "modules");
  for (const name of existsSync(modules) ? readdirSync(modules) : []) {
    collect(join(modules, name, "skills"));
  }
  return skills;
}

const SKILL_NAME = /^saasaloy-[a-z0-9-]+$/;
const SKILL_PATH =
  /(?:^|\/)(?:_agents|\.agents)\/skills\/([^/]+)\/|(?:^|\/)skills\/([^/]+)\/SKILL\.md$/;
const COMMAND = /^(?:npx |pnpm dlx |pnpm exec )?saasaloy(?:@\S+)?\s+(\S.*)$/;
const BARE_FLAG = /^(--?[a-z][a-z0-9-]*)(?:=\S+)?$/;

function codeSpans(markdown: string): string[] {
  return [...markdown.matchAll(/`([^`\n]+)`/g)].map((match) => match[1] ?? "");
}

function linkTexts(markdown: string): string[] {
  return [...markdown.matchAll(/\[([^\]\n]+)\]\(/g)].map(
    (match) => match[1] ?? ""
  );
}

/**
 * Why `markdown` names something the release lacks, one line each, in the order the file
 * names them; empty when it names nothing missing. A skill is a link to a skill's folder,
 * a `.agents/skills/<name>/` path, or a code span or link text that is a `saasaloy-<name>`
 * name. A command is a code span that runs `saasaloy` (also through `npx` or `pnpm dlx`),
 * and its flags must be that command's. A code span that is only a flag must be a flag of
 * some command.
 */
export function llmsSurfaceProblems(
  markdown: string,
  surface: CliSurface,
  skills: ReadonlySet<string>
): string[] {
  const problems: string[] = [];
  const report = (problem: string): void => {
    if (!problems.includes(problem)) {
      problems.push(problem);
    }
  };
  const skill = (name: string): void => {
    if (!skills.has(name)) {
      report(`the skill "${name}" is not in the release`);
    }
  };

  for (const href of links(markdown)) {
    const match = SKILL_PATH.exec(repoPath(href) ?? "");
    const name = match?.[1] ?? match?.[2];
    if (name) {
      skill(name);
    }
  }
  for (const text of linkTexts(markdown)) {
    if (SKILL_NAME.test(text)) {
      skill(text);
    }
  }

  const anyFlag = new Set(surface.globalFlags);
  for (const flags of surface.commands.values()) {
    for (const flag of flags) {
      anyFlag.add(flag);
    }
  }
  for (const span of codeSpans(markdown)) {
    const path = SKILL_PATH.exec(span);
    if (path) {
      skill(path[1] ?? path[2] ?? "");
      continue;
    }
    if (SKILL_NAME.test(span)) {
      skill(span);
      continue;
    }
    const bare = BARE_FLAG.exec(span)?.[1];
    if (bare) {
      if (!anyFlag.has(bare)) {
        report(`the flag "${bare}" is not a flag of any command`);
      }
      continue;
    }
    const rest = COMMAND.exec(span)?.[1];
    if (!rest) {
      continue;
    }
    const [first = "", ...args] = rest.split(/\s+/);
    if (first.startsWith("-")) {
      const flag = first.split("=")[0] ?? first;
      if (!surface.globalFlags.has(flag)) {
        report(`the flag "${flag}" is not a flag of "saasaloy"`);
      }
      continue;
    }
    const flags = surface.commands.get(first);
    if (!flags) {
      report(`the command "saasaloy ${first}" is not in the CLI`);
      continue;
    }
    for (const arg of args) {
      if (!arg.startsWith("-")) {
        continue;
      }
      const flag = arg.split("=")[0] ?? arg;
      if (!flags.has(flag)) {
        report(`the flag "${flag}" is not a flag of "saasaloy ${first}"`);
      }
    }
  }
  return problems;
}
