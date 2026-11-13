// Lints the module skills an unattended agent walks through (issue #228, plan 0074).
// An agent that finishes one skill reads its `## Next` section to find the skill that
// usually follows, so a skill with no such section, or one that names a skill that does
// not exist, leaves the agent with no next step. `saasaloy add` tells the owner to follow
// a module skill's `## Wire-up` section whenever the module wrote a file under
// `@ui/blocks/` (`packages/cli/src/commands/add.ts`), so that section has to exist.
//
// The rules:
//
//   - every `modules/*/skills/*/SKILL.md` has a `## Next` section that names, in a code
//     span, at least one skill that ships in a module or in the base template;
//   - every skill of a module whose descriptor writes a `@ui/blocks/` target has a
//     heading that starts `## Wire-up`;
//   - the eight capability skills the gap audit named have a removal section and a
//     failure-mode section;
//   - the base template ships `saasaloy-build`, `saasaloy-feature` and `saasaloy-update`.
//
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");
const BASE_SKILLS = join(
  ROOT,
  "packages",
  "cli",
  "templates",
  "base",
  "_agents",
  "skills"
);

const NEEDS_REMOVAL_AND_FAILURES = [
  "email",
  "logger",
  "sms",
  "kv",
  "storage",
  "queue",
  "validators",
  "teams",
];

/** The body of the `## <title>` section, up to the next `##` heading. */
export function section(markdown: string, title: RegExp): string | undefined {
  const lines = markdown.split("\n");
  const start = lines.findIndex(
    (line) => line.startsWith("## ") && title.test(line.slice(3))
  );
  if (start === -1) {
    return undefined;
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

/** The skill names a `## Next` section points at, or a reason it points at none. */
export function nextSkills(
  markdown: string,
  known: Set<string>
): string[] | string {
  const body = section(markdown, /^Next$/);
  if (body === undefined) {
    return "no `## Next` section";
  }
  const named = [...body.matchAll(/`(saasaloy-[a-z0-9-]+)`/g)].map(
    (match) => match[1] ?? ""
  );
  if (named.length === 0) {
    return "`## Next` names no skill in a code span";
  }
  const unknown = named.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    return `\`## Next\` names a skill that does not exist: ${unknown.join(", ")}`;
  }
  return named;
}

export function hasWireUp(markdown: string): boolean {
  return section(markdown, /^Wire-up\b/) !== undefined;
}

export function writesUiBlock(descriptor: {
  files?: { target?: string }[];
}): boolean {
  return (descriptor.files ?? []).some((file) =>
    (file.target ?? "").startsWith("@ui/blocks/")
  );
}

interface ModuleSkill {
  module: string;
  skill: string;
  path: string;
  markdown: string;
}

function moduleSkills(): ModuleSkill[] {
  const found: ModuleSkill[] = [];
  for (const module of readdirSync(MODULES).toSorted()) {
    const skillsDir = join(MODULES, module, "skills");
    if (!existsSync(skillsDir)) {
      continue;
    }
    for (const skill of readdirSync(skillsDir).toSorted()) {
      const path = join(skillsDir, skill, "SKILL.md");
      if (existsSync(path)) {
        found.push({
          module,
          skill,
          path,
          markdown: readFileSync(path, "utf-8"),
        });
      }
    }
  }
  return found;
}

function knownSkills(skills: ModuleSkill[]): Set<string> {
  return new Set([
    ...skills.map((entry) => entry.skill),
    ...readdirSync(BASE_SKILLS),
  ]);
}

describe("the rule checkers", () => {
  const known = new Set(["saasaloy-api", "saasaloy-app"]);

  it("accepts a Next section that names a known skill", () => {
    assert.deepEqual(
      nextSkills("# x\n\n## Next\n\nRun `saasaloy-api` next.\n", known),
      ["saasaloy-api"]
    );
  });

  it("rejects a skill with no Next section", () => {
    assert.equal(
      nextSkills("# x\n\n## Usage\n", known),
      "no `## Next` section"
    );
  });

  it("rejects a Next section that names an unknown skill", () => {
    assert.match(
      String(nextSkills("## Next\n\nRun `saasaloy-nope`.\n", known)),
      /does not exist: saasaloy-nope/
    );
  });

  it("does not read a later section as part of Next", () => {
    assert.equal(
      nextSkills(
        "## Next\n\nSee below.\n\n## Other\n\n`saasaloy-api`\n",
        known
      ),
      "`## Next` names no skill in a code span"
    );
  });

  it("finds a Wire-up heading with a suffix, and misses a lookalike", () => {
    assert.equal(hasWireUp("## Wire-up: the blocks\n"), true);
    assert.equal(hasWireUp("## Wiring recipes\n"), false);
  });

  it("treats only a @ui/blocks/ target as a UI block", () => {
    assert.equal(
      writesUiBlock({ files: [{ target: "@ui/blocks/a.tsx" }] }),
      true
    );
    assert.equal(
      writesUiBlock({ files: [{ target: "@admin/routes/a.tsx" }] }),
      false
    );
  });
});

describe("the module skills", () => {
  const skills = moduleSkills();
  const known = knownSkills(skills);

  it("finds the module skills", () => {
    assert.ok(skills.length > 20, `found only ${skills.length} module skills`);
  });

  it("each has a Next section naming a skill that exists", () => {
    const problems = skills.flatMap((entry) => {
      const result = nextSkills(entry.markdown, known);
      return typeof result === "string" ? [`${entry.skill}: ${result}`] : [];
    });
    assert.deepEqual(problems, []);
  });

  it("each skill of a module that writes a UI block has a Wire-up section", () => {
    const missing = skills
      .filter((entry) => {
        const descriptor = JSON.parse(
          readFileSync(
            join(MODULES, entry.module, "registry-item.json"),
            "utf-8"
          )
        ) as { files?: { target?: string }[] };
        return writesUiBlock(descriptor) && !hasWireUp(entry.markdown);
      })
      .map((entry) => entry.skill);
    assert.deepEqual(missing, []);
  });

  it("the audited capability skills cover removal and failure modes", () => {
    const missing = NEEDS_REMOVAL_AND_FAILURES.flatMap((module) => {
      const entry = skills.find((skill) => skill.module === module);
      if (!entry) {
        return [`${module}: no skill`];
      }
      return [
        section(entry.markdown, /remov/i)
          ? []
          : [`${module}: no removal section`],
        section(entry.markdown, /failure/i)
          ? []
          : [`${module}: no failure-mode section`],
      ].flat();
    });
    assert.deepEqual(missing, []);
  });
});

describe("the base skills", () => {
  for (const name of [
    "saasaloy-build",
    "saasaloy-feature",
    "saasaloy-update",
  ]) {
    it(`ship ${name} with its name in the frontmatter`, () => {
      const path = join(BASE_SKILLS, name, "SKILL.md");
      assert.ok(existsSync(path), `${path} is missing`);
      assert.match(
        readFileSync(path, "utf-8"),
        new RegExp(`^---\\nname: ${name}\\n`)
      );
    });
  }
});
