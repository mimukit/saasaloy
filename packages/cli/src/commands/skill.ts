import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cancel, log } from "@clack/prompts";
import pc from "picocolors";
import {
  EXIT_OK,
  EXIT_REFUSED,
  exitCodeFor,
  formatFailure,
} from "../lib/exit.js";
import { pathExists } from "../lib/fs-utils.js";
import { printJson } from "../lib/json-output.js";
import { findProjectRoot } from "../lib/project.js";
import { resolveProjectName } from "../lib/project-name.js";
import { CONFIG_FILE, loadConfig } from "../lib/saasaloy-config.js";
import { applyVars, baseTemplateDir, templateVars } from "../lib/scaffold.js";
import { stripAnsi, TUI_ON_STDERR } from "../lib/tui.js";
import { parseFrontmatter } from "../lib/update-notes.js";
import type { CommandHelp } from "../lib/usage.js";
import { printCommandHelp, wantsHelp } from "../lib/usage.js";
import { DESCRIPTIONS } from "./descriptions.js";

// `saasaloy skill [<name>] [--json]` (#359, ADR 0064). A project holds the base skills of
// the CLI that last wrote its base, so an agent reading `.agents/skills/saasaloy-update`
// can follow steps an older CLI wrote while it runs a newer one. This command prints the
// base skill bundled in the running CLI's own npm package: no network, and the text
// matches the CLI that will run the steps.
//
// Base skills only, read from `templates/base/_agents/skills/`. Module skills arrive
// with their module through `add` and `update`, and serving them would add a registry
// fetch. With no name the command lists the bundled skills with their frontmatter
// `description`.
//
// stdout carries the skill text, the list, or the JSON document, and nothing else. A
// warning and a refusal go to stderr, so `saasaloy skill saasaloy-update > SKILL.md`
// writes the same bytes `init` would write.

interface Options {
  name?: string;
  /** `--json`: one JSON document on stdout. */
  json: boolean;
  /** Flags we don't know and extra positionals — reported, never silently ignored. */
  unknown: string[];
}

const KNOWN_FLAGS = new Set(["--json", "--help", "-h"]);
const USAGE = "saasaloy skill [<name>] [--json]";
const HELP: CommandHelp = {
  name: "skill",
  describe: DESCRIPTIONS.skill,
  usage: USAGE,
  flags: {
    "--json": "print the skill list, or the named skill, as one JSON document",
  },
};

/** Where the base skills live inside the bundled template. */
const SKILLS_DIR = "_agents/skills";
const SKILL_FILE = "SKILL.md";

/**
 * The project name a skill renders with outside a project. `init`'s own example name; the
 * base skills hold no `{{PROJECT_NAME}}` today, so this only guards a later change.
 */
export const DEFAULT_PROJECT_NAME = "my-app";

export function parseArgs(argv: string[]): Options {
  const positional: string[] = [];
  const unknown: string[] = [];
  for (const arg of argv) {
    if (!arg.startsWith("-")) {
      positional.push(arg);
    } else if (!KNOWN_FLAGS.has(arg)) {
      unknown.push(arg);
    }
  }
  unknown.push(...positional.slice(1));
  return {
    json: argv.includes("--json"),
    ...(positional[0] === undefined ? {} : { name: positional[0] }),
    unknown,
  };
}

export interface BundledSkill {
  name: string;
  description: string;
}

/** Absolute path of the bundled base skills folder. */
export async function bundledSkillsDir(): Promise<string> {
  return join(await baseTemplateDir(), SKILLS_DIR);
}

/** Every bundled base skill, sorted by name: each folder that holds a `SKILL.md`. */
export async function listBundledSkills(dir?: string): Promise<BundledSkill[]> {
  const root = dir ?? (await bundledSkillsDir());
  const entries = await readdir(root, { withFileTypes: true });
  const skills: BundledSkill[] = [];
  for (const entry of entries) {
    const file = join(root, entry.name, SKILL_FILE);
    if (!entry.isDirectory() || !(await pathExists(file))) {
      continue;
    }
    const { data } = parseFrontmatter(await readFile(file, "utf-8"));
    const description =
      typeof data.description === "string" ? data.description : "";
    skills.push({ description, name: entry.name });
  }
  return skills.toSorted((a, b) => a.name.localeCompare(b.name));
}

/**
 * The project name the template vars take. Inside a project it is the name `update`
 * renders with; outside one it is `DEFAULT_PROJECT_NAME`. A project whose
 * `saasaloy.json` does not load still gets the skill, with a warning on stderr: the
 * runbook is what an agent needs to repair that project.
 */
export async function projectNameForVars(): Promise<string> {
  const root = await findProjectRoot();
  if (!(await pathExists(join(root, CONFIG_FILE)))) {
    return DEFAULT_PROJECT_NAME;
  }
  try {
    return (await resolveProjectName(root, await loadConfig(root))).name;
  } catch (error) {
    log.warn(
      `Could not read ${CONFIG_FILE} (${formatFailure(error)}); rendering with the default name ${DEFAULT_PROJECT_NAME}.`,
      TUI_ON_STDERR
    );
    return DEFAULT_PROJECT_NAME;
  }
}

/** The bytes `init` writes for `<name>/SKILL.md`, rendered for `projectName`. */
export async function renderBundledSkill(
  name: string,
  projectName: string,
  dir?: string
): Promise<string> {
  const root = dir ?? (await bundledSkillsDir());
  const raw = await readFile(join(root, name, SKILL_FILE), "utf-8");
  return applyVars(raw, templateVars(projectName));
}

/**
 * Stop with `message` on stderr, and under `--json` the error document on stdout. Unlike
 * `createOutput`'s `refuse`, the rail goes to stderr with or without `--json`, so a
 * refused run leaves stdout empty.
 */
function refuse(json: boolean, message: string, code: number): number {
  cancel(message, TUI_ON_STDERR);
  if (json) {
    printJson({ error: { exitCode: code, message: stripAnsi(message) } });
  }
  return code;
}

function printList(skills: BundledSkill[]): void {
  const width = Math.max(...skills.map((skill) => skill.name.length));
  for (const skill of skills) {
    process.stdout.write(`${skill.name.padEnd(width)}  ${skill.description}\n`);
  }
}

export async function runSkill(argv: string[]): Promise<number> {
  // Parse before help answers, so a typo'd flag alongside `--help` still reports the typo.
  const opts = parseArgs(argv);
  if (opts.unknown.length === 0 && wantsHelp(argv)) {
    printCommandHelp(HELP);
    return EXIT_OK;
  }
  if (opts.unknown.length > 0) {
    return refuse(
      opts.json,
      `Unknown argument(s): ${opts.unknown.join(", ")} — usage: \`${USAGE}\`.`,
      EXIT_REFUSED
    );
  }

  try {
    const skills = await listBundledSkills();
    if (opts.name === undefined) {
      if (opts.json) {
        printJson({ skills });
      } else {
        printList(skills);
      }
      return EXIT_OK;
    }

    const skill = skills.find((entry) => entry.name === opts.name);
    if (skill === undefined) {
      return refuse(
        opts.json,
        `No base skill named ${pc.cyan(opts.name)}. This CLI ships: ${skills.map((entry) => entry.name).join(", ")}.`,
        EXIT_REFUSED
      );
    }

    const content = await renderBundledSkill(
      skill.name,
      await projectNameForVars()
    );
    if (opts.json) {
      printJson({ ...skill, content });
    } else {
      process.stdout.write(content);
    }
    return EXIT_OK;
  } catch (error) {
    return refuse(opts.json, formatFailure(error), exitCodeFor(error));
  }
}
