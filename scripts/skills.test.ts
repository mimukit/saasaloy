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
//   - the base template ships `saasaloy-build`, `saasaloy-feature` and `saasaloy-update`;
//   - `saasaloy-build` names the steps a fresh scaffold needs (plan 0109): the install
//     that tolerates a changed lockfile, `db:generate` before `db:setup`, the env step
//     after each `add`, the first commit, and the resume rules, and the base `AGENTS.md`
//     agrees with it on who runs `pnpm env:setup`;
//   - the interview joins the build (plan 0109 phase 6): `saasaloy-setup` asks about
//     fifteen questions, the preview one last, and ends with one read-back that starts
//     `saasaloy-build`; the build commits once per spec entity; `saasaloy-feature` builds
//     its screens from the four `shell` parts, which the `shell` module really writes;
//     and `llms.txt`, the base `AGENTS.md` and the skills tell an agent with no brief and
//     no person to stop. `scripts/product-spec.test.ts` checks the spec's headings.
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

describe("saasaloy-build runs on a fresh scaffold (plan 0109)", () => {
  const build = readFileSync(
    join(BASE_SKILLS, "saasaloy-build", "SKILL.md"),
    "utf-8"
  );
  const agents = readFileSync(
    join(ROOT, "packages", "cli", "templates", "base", "AGENTS.md"),
    "utf-8"
  );
  /** The body of the `### <title>` section, up to the next `##` or `###` heading. */
  const subsection = (title: string): string => {
    const lines = build.split("\n");
    const start = lines.indexOf(`### ${title}`);
    if (start === -1) {
      return "";
    }
    const rest = lines.slice(start + 1);
    const end = rest.findIndex((line) => /^#{2,3} /.test(line));
    return (end === -1 ? rest : rest.slice(0, end)).join("\n");
  };
  const afterAdd = subsection("Stage: Validate and Stage: MVP");

  it("installs with --no-frozen-lockfile after an add", () => {
    assert.match(afterAdd, /pnpm install --no-frozen-lockfile/);
  });

  it("names db:generate before db:setup, and the env step after each add", () => {
    const generate = afterAdd.indexOf("pnpm --filter @repo/db db:generate");
    const setup = afterAdd.indexOf("pnpm db:setup");
    assert.ok(generate !== -1, "db:generate is not named");
    assert.ok(setup > generate, "db:setup is not after db:generate");
    assert.match(afterAdd, /pnpm env:setup`, after every `add`/);
  });

  it("makes the first commit at Intake when init skipped it", () => {
    const intake = subsection("Stage: Intake");
    assert.match(intake, /chore\(repo\): initial commit/);
    assert.match(intake, /git rev-parse --verify --quiet HEAD/);
  });

  it("has a rule for a dirty tree on resume, and reads stage commits from git", () => {
    assert.match(subsection("A dirty tree on resume"), /git stash/);
    assert.match(build, /git log --format='%h %s' main\.\.HEAD/);
  });

  it("agrees with AGENTS.md that the agent runs pnpm env:setup", () => {
    assert.match(build, /The build runs `pnpm env:setup` itself/);
    assert.match(agents, /The agent runs `pnpm env:setup` itself/);
    assert.doesNotMatch(agents, /The person also runs `pnpm env:setup`/);
  });
});

describe("the interview joins the build (plan 0109 phase 6)", () => {
  const read = (name: string): string =>
    readFileSync(join(BASE_SKILLS, name, "SKILL.md"), "utf-8");
  const setup = read("saasaloy-setup");
  const build = read("saasaloy-build");
  const feature = read("saasaloy-feature");
  const agents = readFileSync(
    join(ROOT, "packages", "cli", "templates", "base", "AGENTS.md"),
    "utf-8"
  );
  const llms = readFileSync(join(ROOT, "llms.txt"), "utf-8");

  /** The numbered rows of the interview's question tables: `| 11 | **Entities** |`. */
  const questions = [
    ...setup.matchAll(/^\| (\d+) \| \*\*([^*]+)\*\* \|/gm),
  ].map((match) => ({ number: Number(match[1]), name: match[2] ?? "" }));

  it("asks about fifteen questions, numbered in order, with the preview last", () => {
    assert.deepEqual(
      questions.map((question) => question.number),
      Array.from({ length: 15 }, (_, index) => index + 1)
    );
    assert.equal(questions.at(-1)?.name, "Preview deploy");
  });

  it("asks for the entities, the capabilities and the driver", () => {
    const names = new Set(questions.map((question) => question.name));
    for (const name of ["Entities", "Capabilities", "Database driver"]) {
      assert.ok(names.has(name), `no ${name} question`);
    }
    assert.match(setup, /saasaloy list --json/);
    assert.match(setup, /recommends one driver/);
  });

  it("records the preview choice in the frontmatter, and names the temporary database", () => {
    assert.match(setup, /`deploy: preview`/);
    assert.match(setup, /`deploy: none`/);
    assert.match(setup, /preview runs on a temporary database/);
  });

  it("ends with one read-back that accepts thin answers and sets autonomy", () => {
    const readBack = section(setup, /^Step 1/) ?? "";
    assert.match(readBack, /### The read-back/);
    assert.match(readBack, /`weak-accepted:`/);
    assert.match(readBack, /Set `autonomy: afk`/);
    assert.match(readBack, /Ask nothing after the confirmation/);
    assert.doesNotMatch(setup, /Run the build unattended\?/);
  });

  it("starts saasaloy-build in the same session", () => {
    assert.match(
      section(setup, /^Start the build$/) ?? "",
      /`\.agents\/skills\/saasaloy-build\/SKILL\.md` and follow it, in this session/
    );
  });

  it("writes the brief and the spec, and no longer says a scaffold has no commit", () => {
    assert.match(setup, /`docs\/product-spec\.md`/);
    assert.doesNotMatch(setup, /a fresh scaffold has no commit yet/);
  });

  it("counts a weak-accepted answer as filled, in setup, the build and AGENTS.md", () => {
    assert.match(setup, /and so does an answer tagged `weak-accepted:`/);
    assert.match(build, /`weak-accepted:` counts as filled/);
    assert.match(agents, /`weak-accepted:` counts as filled/);
  });

  it("builds each spec entity with its own commit, in order, with no limit", () => {
    const featureStage = section(build, /^The stages$/) ?? "";
    assert.match(featureStage, /with no limit on their number/);
    assert.match(featureStage, /`feat\(build\): feature <table>`/);
    assert.match(build, /`## Feature: <table>`/);
    assert.match(build, /`feat\(build\): feature <table>` commit/);
  });

  it("takes the driver and the picks from the spec, and drops each optional extra", () => {
    assert.match(build, /spec's `## Database driver`/);
    assert.match(build, /spec's `## Modules`/);
    for (const extra of [
      "ci",
      "infra-ci-deploy",
      "auth-phone",
      "notification",
    ]) {
      assert.match(
        build,
        new RegExp(`\`${extra}\``),
        `${extra} is not handled`
      );
    }
  });

  it("gives a picked module that needs an account its local provider", () => {
    assert.match(setup, /Put its capability's local provider there instead/);
    assert.match(build, /add its capability's local provider instead/);
    assert.match(build, /spec's `## Left for the owner`/);
  });

  it("records a preview choice and deploys nothing", () => {
    assert.match(build, /With `deploy: preview`[^\n]*deploys nothing/);
  });

  it("builds the screens from the shell parts the shell module writes", () => {
    const descriptor = JSON.parse(
      readFileSync(join(MODULES, "shell", "registry-item.json"), "utf-8")
    ) as { files: { target: string }[] };
    const targets = new Set(descriptor.files.map((file) => file.target));
    for (const part of [
      "blocks/shell/data-table",
      "blocks/shell/detail-panel",
      "components/shell/form",
      "components/shell/field",
    ]) {
      assert.match(
        feature,
        new RegExp(`@repo/ui/${part}\``),
        `${part} is not named`
      );
      assert.ok(targets.has(`@ui/${part}.tsx`), `shell writes no ${part}.tsx`);
    }
  });

  it("tells an agent with no brief and no person to stop and say why", () => {
    assert.match(setup, /Stop when there is no brief and no person/);
    assert.match(build, /With no brief and no person, stop/);
    assert.match(agents, /No brief and no person: stop/);
    assert.match(llms, /No brief and no person in the session: stop/);
  });

  it("stops only with no brief in docs/ or the folder, and counts a scripted owner as a person", () => {
    const rule = (text: string, heading: RegExp): string =>
      text.split("\n").find((line) => heading.test(line)) ?? "";
    const rules = {
      agents: rule(agents, /No brief and no person: stop/),
      build: rule(build, /With no brief and no person, stop/),
      setup: rule(setup, /Stop when there is no brief and no person/),
      llms: rule(llms, /No brief and no person in the session: stop/),
    };
    for (const [name, line] of Object.entries(rules)) {
      assert.match(
        line,
        /headless run whose prompt says the owner is here and answers[^.]*questions has a person/,
        `${name} does not count a scripted owner as a person`
      );
      assert.match(
        line,
        /Never (?:invent|answer)|do not write a brief yourself/,
        `${name} lets the agent answer the interview`
      );
    }
    for (const name of ["agents", "build"] as const) {
      assert.match(
        rules[name],
        /neither `docs\/product-brief\.md` nor `\.\/product-brief\.md` exists/,
        `${name} stops while ./product-brief.md exists`
      );
    }
    assert.match(rules.setup, /steps 1 and 2 found none/);
    assert.match(setup, /`\.\/product-brief\.md` does/);
    assert.match(rules.llms, /holds no `product-brief\.md`/);
  });

  it("gives one path in llms.txt and AGENTS.md: init, the interview, the build", () => {
    assert.match(
      llms,
      /One path, in one session: `init`, the interview, the build/
    );
    assert.match(agents, /One path: `saasaloy init`, the interview, the build/);
    assert.doesNotMatch(llms, /Do not write the brief yourself/);
  });
});
