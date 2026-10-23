import { join } from "node:path";
import type { LinkState } from "./fs-utils.js";
import {
  assertNoSymlinkPath,
  classifyLink,
  createDirLink,
  readDirNames,
} from "./fs-utils.js";

export interface SkillLinkResult {
  /** Every skill whose link is in place after the run, new or already correct. */
  linked: string[];
  /** The subset of `linked` this run created. */
  created: string[];
  /** Skills whose `.claude/skills/<name>` path holds something that is not our link. */
  conflicts: string[];
  failures: { name: string; message: string }[];
  // `.agents/skills` itself couldn't be read, so no per-skill result is meaningful.
  // A *missing* directory isn't this: that's the ordinary "no skills" case and comes back
  // as an empty result.
  unreadable?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Point `.claude/skills/<name>` at every folder in `.agents/skills/`, so Claude Code
 * discovers each skill while every other agent reads the committed files (ADR 0015).
 *
 * Every folder, not only the skills a descriptor names: a project's own skill and a skill
 * a base update adds need the link as much as a module's does. `init`, `add` and `update`
 * call this one function, and the project's `prepare` script runs the same rule through
 * `packages/tooling/src/link-skills.ts`, so a fresh clone gets the links on
 * `pnpm install`.
 *
 * A missing link is created, a correct one is left alone, and any other path is reported
 * as a conflict and never touched. The links are per-machine and gitignored, so none of
 * them goes into the manifest here; `add` and `update` still record a module's own skill
 * links, which is what `remove` reads back.
 *
 * Never throws: a link is a convenience, and losing it costs discovery, not files.
 */
export async function linkAgentSkills(
  root: string,
  order?: (a: string, b: string) => number
): Promise<SkillLinkResult> {
  const result: SkillLinkResult = {
    linked: [],
    created: [],
    conflicts: [],
    failures: [],
  };
  const skillsDir = join(root, ".agents", "skills");
  let names: string[];
  try {
    names = await readDirNames(skillsDir);
  } catch (error) {
    // readDirNames returns [] when the directory is simply absent, so reaching here means
    // it exists and we couldn't read it. Say so: the alternative is printing no links and
    // no reason, which reads exactly like a project that has no skills.
    result.unreadable = errorMessage(error);
    return result;
  }
  for (const name of names.toSorted(order)) {
    const linkAbs = join(root, ".claude", "skills", name);
    const targetAbs = join(skillsDir, name);
    // classifyLink can reject after its lstat succeeds (the readlink behind it), and the
    // symlink guard refuses a `.claude` that leads out of the project, so both stay inside
    // the non-fatal path.
    let state: LinkState;
    try {
      state = await classifyLink(linkAbs, targetAbs);
    } catch (error) {
      result.failures.push({ name, message: errorMessage(error) });
      continue;
    }
    if (state === "conflict") {
      result.conflicts.push(name);
      continue;
    }
    if (state === "correct") {
      result.linked.push(name);
      continue;
    }
    try {
      await assertNoSymlinkPath(root, linkAbs);
      await createDirLink(linkAbs, targetAbs);
      result.linked.push(name);
      result.created.push(name);
    } catch (error) {
      result.failures.push({ name, message: errorMessage(error) });
    }
  }
  return result;
}
