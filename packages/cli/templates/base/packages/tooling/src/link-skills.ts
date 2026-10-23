#!/usr/bin/env node
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  symlinkSync,
} from "node:fs";
import path from "node:path";

// Links every folder in `.agents/skills/` into `.claude/skills/`, so Claude Code finds each
// skill while every other agent reads the committed files. `.claude/skills/` is gitignored:
// a link is a per-machine file, so the root `prepare` script runs this on `pnpm install`,
// and a fresh clone gets its links with no extra step. pnpm skips `prepare` when it answers
// "Already up to date", so after you add a skill folder to a checkout that is already
// installed, run `pnpm skills:link`.
//
// It follows the same rule `saasaloy init`, `add` and `update` follow. A missing link is
// created (relative on POSIX, a junction on Windows). A link that already points at its
// skill folder is left alone. Anything else at the path, a real folder or a link that
// points elsewhere, is not this linker's own link, so it is reported and left untouched.
// It never fails the install: a link only helps discovery, and the skill files stay in
// `.agents/skills/` whatever happens here.

export type LinkState = "missing" | "correct" | "conflict";

export interface LinkReport {
  created: string[];
  correct: string[];
  conflicts: string[];
  failures: { name: string; message: string }[];
}

/** How the path at `linkAbs` relates to a link that should point at `targetAbs`. */
export function classifyLink(linkAbs: string, targetAbs: string): LinkState {
  let isLink: boolean;
  try {
    isLink = lstatSync(linkAbs).isSymbolicLink();
  } catch {
    return "missing";
  }
  if (!isLink) {
    return "conflict";
  }
  // A POSIX link reads back relative to its own folder; a Windows junction reads back
  // absolute. `resolve` handles both.
  const dest = path.resolve(path.dirname(linkAbs), readlinkSync(linkAbs));
  return dest === path.resolve(targetAbs) ? "correct" : "conflict";
}

function skillFolders(skillsDir: string): string[] {
  try {
    return readdirSync(skillsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted();
  } catch (error) {
    const code =
      error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return [];
    }
    throw error;
  }
}

function createLink(linkAbs: string, targetAbs: string): void {
  mkdirSync(path.dirname(linkAbs), { recursive: true });
  if (process.platform === "win32") {
    symlinkSync(path.resolve(targetAbs), linkAbs, "junction");
  } else {
    symlinkSync(
      path.relative(path.dirname(linkAbs), targetAbs),
      linkAbs,
      "dir"
    );
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Link every `.agents/skills/<name>` folder under `root` into `.claude/skills/<name>`. */
export function linkSkills(root: string): LinkReport {
  const report: LinkReport = {
    conflicts: [],
    correct: [],
    created: [],
    failures: [],
  };
  const skillsDir = path.join(root, ".agents", "skills");
  for (const name of skillFolders(skillsDir)) {
    const linkAbs = path.join(root, ".claude", "skills", name);
    const targetAbs = path.join(skillsDir, name);
    try {
      const state = classifyLink(linkAbs, targetAbs);
      if (state === "missing") {
        createLink(linkAbs, targetAbs);
        report.created.push(name);
      } else if (state === "correct") {
        report.correct.push(name);
      } else {
        report.conflicts.push(name);
      }
    } catch (error) {
      report.failures.push({ message: message(error), name });
    }
  }
  return report;
}

/** One line per new link, conflict and failure. A link already in place prints nothing. */
export function reportLines(report: LinkReport): string[] {
  return [
    ...report.created.map(
      (name) =>
        `link-skills: linked .claude/skills/${name} -> .agents/skills/${name}`
    ),
    ...report.conflicts.map(
      (name) =>
        `link-skills: .claude/skills/${name} is not a link to .agents/skills/${name}, left alone. Remove it and run \`pnpm skills:link\` to link the skill.`
    ),
    ...report.failures.map(
      ({ name, message: text }) =>
        `link-skills: could not link .claude/skills/${name}: ${text}`
    ),
  ];
}

if (import.meta.main) {
  // This file sits at packages/tooling/src/, three folders below the repository root.
  const root = path.resolve(import.meta.dirname, "..", "..", "..");
  try {
    for (const line of reportLines(linkSkills(root))) {
      process.stdout.write(`${line}\n`);
    }
  } catch (error) {
    // `.agents/skills` exists but cannot be read. Say so, and still let the install finish.
    process.stderr.write(`link-skills: ${message(error)}\n`);
  }
}
