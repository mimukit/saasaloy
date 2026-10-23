import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { classifyLink, linkSkills, reportLines } from "./link-skills.ts";

describe("link-skills", () => {
  let root = "";

  function skill(name: string): string {
    const dir = path.join(root, ".agents", "skills", name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "SKILL.md"), `# ${name}\n`);
    return dir;
  }

  function linkPath(name: string): string {
    return path.join(root, ".claude", "skills", name);
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "link-skills-"));
  });

  afterEach(() => {
    rmSync(root, { force: true, recursive: true });
  });

  describe(classifyLink, () => {
    it("is missing when nothing is at the path", () => {
      expect(classifyLink(linkPath("a"), skill("a"))).toBe("missing");
    });

    it("is correct for a link that resolves to the skill folder", () => {
      const target = skill("a");
      mkdirSync(path.dirname(linkPath("a")), { recursive: true });
      symlinkSync(
        path.relative(path.dirname(linkPath("a")), target),
        linkPath("a")
      );
      expect(classifyLink(linkPath("a"), target)).toBe("correct");
    });

    it("is a conflict for a real folder or a link that points elsewhere", () => {
      const target = skill("a");
      mkdirSync(linkPath("a"), { recursive: true });
      symlinkSync(skill("b"), linkPath("b-elsewhere"));
      expect(classifyLink(linkPath("a"), target)).toBe("conflict");
      expect(classifyLink(linkPath("b-elsewhere"), target)).toBe("conflict");
    });
  });

  describe(linkSkills, () => {
    it("does nothing when .agents/skills is missing", () => {
      expect(linkSkills(root)).toStrictEqual({
        conflicts: [],
        correct: [],
        created: [],
        failures: [],
      });
    });

    it("links every skill folder with a relative link", () => {
      skill("saasaloy-env");
      skill("project-own");
      writeFileSync(path.join(root, ".agents", "skills", "README.md"), "no\n");

      const report = linkSkills(root);

      expect(report.created).toStrictEqual(["project-own", "saasaloy-env"]);
      expect(lstatSync(linkPath("project-own")).isSymbolicLink()).toBeTruthy();
      expect(readlinkSync(linkPath("project-own"))).toBe(
        path.join("..", "..", ".agents", "skills", "project-own")
      );
    });

    it("leaves a correct link alone on a second run", () => {
      skill("a");
      linkSkills(root);

      const report = linkSkills(root);

      expect(report.created).toStrictEqual([]);
      expect(report.correct).toStrictEqual(["a"]);
    });

    it("reports a path that is not its own link and leaves it alone", () => {
      skill("a");
      mkdirSync(linkPath("a"), { recursive: true });
      writeFileSync(path.join(linkPath("a"), "mine.md"), "keep\n");

      const report = linkSkills(root);

      expect(report.conflicts).toStrictEqual(["a"]);
      expect(lstatSync(linkPath("a")).isDirectory()).toBeTruthy();
      expect(
        lstatSync(path.join(linkPath("a"), "mine.md")).isFile()
      ).toBeTruthy();
    });
  });

  describe(reportLines, () => {
    it("names each new link and each conflict with its fix", () => {
      const lines = reportLines({
        conflicts: ["b"],
        correct: ["c"],
        created: ["a"],
        failures: [{ message: "EACCES", name: "d" }],
      });

      expect(lines).toStrictEqual([
        "link-skills: linked .claude/skills/a -> .agents/skills/a",
        "link-skills: .claude/skills/b is not a link to .agents/skills/b, left alone. Remove it and run `pnpm skills:link` to link the skill.",
        "link-skills: could not link .claude/skills/d: EACCES",
      ]);
    });
  });
});
