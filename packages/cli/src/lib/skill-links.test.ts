import {
  lstat,
  mkdir,
  mkdtemp,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { linkAgentSkills } from "./skill-links.js";

let root: string;

async function skill(name: string): Promise<void> {
  await mkdir(join(root, ".agents", "skills", name), { recursive: true });
  await writeFile(join(root, ".agents", "skills", name, "SKILL.md"), "# s\n");
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "saasaloy-skill-links-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe(linkAgentSkills, () => {
  it("returns an empty result when .agents/skills is missing", async () => {
    await expect(linkAgentSkills(root)).resolves.toStrictEqual({
      linked: [],
      created: [],
      conflicts: [],
      failures: [],
    });
  });

  it("links every folder, a project skill as much as a module skill", async () => {
    await skill("saasaloy-env");
    await skill("project-own");

    const result = await linkAgentSkills(root);

    expect(result.created).toStrictEqual(["project-own", "saasaloy-env"]);
    expect(result.linked).toStrictEqual(["project-own", "saasaloy-env"]);
    await expect(
      readlink(join(root, ".claude", "skills", "project-own"))
    ).resolves.toBe(join("..", "..", ".agents", "skills", "project-own"));
  });

  it("leaves a correct link alone and does not count it as created", async () => {
    await skill("a");
    await linkAgentSkills(root);

    const result = await linkAgentSkills(root);

    expect(result.created).toStrictEqual([]);
    expect(result.linked).toStrictEqual(["a"]);
  });

  it("reports a path that is not our link and leaves it untouched", async () => {
    await skill("a");
    await mkdir(join(root, ".claude", "skills", "a"), { recursive: true });

    const result = await linkAgentSkills(root);

    expect(result.conflicts).toStrictEqual(["a"]);
    expect(result.linked).toStrictEqual([]);
    const stat = await lstat(join(root, ".claude", "skills", "a"));
    expect(stat.isDirectory()).toBeTruthy();
  });

  it("refuses to create a link through a .claude that leads out of the project", async () => {
    await skill("a");
    const outside = await mkdtemp(join(tmpdir(), "saasaloy-skill-out-"));
    try {
      await symlink(outside, join(root, ".claude"), "dir");

      const result = await linkAgentSkills(root);

      expect(result.created).toStrictEqual([]);
      expect(result.failures.map((f) => f.name)).toStrictEqual(["a"]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("sorts with the order it is given", async () => {
    await skill("a-skill");
    await skill("z-first");

    const result = await linkAgentSkills(root, (a, b) =>
      a.startsWith("z") ? -1 : b.startsWith("z") ? 1 : 0
    );

    expect(result.linked).toStrictEqual(["z-first", "a-skill"]);
  });
});
