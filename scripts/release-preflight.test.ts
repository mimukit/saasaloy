// Tests for `scripts/release-preflight.ts` (issue #46). The preflight runs the whole CI
// gate and the tarball smoke, so the script end to end is a several-minute job. Two
// decisions inside it are worth pinning cheaply.
//
// The skip flag is one of them. `SAASALOY_RELEASE_SKIP_GATE=1` is the only way to pass a
// choice into a release-it hook, because hooks are fixed strings, and a flag that reads as
// "on" for any non-empty value would silently skip the gate for `SAASALOY_RELEASE_SKIP_GATE=0`.
//
// The staleness message is the other. A release cut from a `main` that is behind origin
// publishes code nobody reviewed at that tag, and the maintainer needs to read what to do,
// not just that a comparison failed.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  BASE_SKILLS,
  benchBriefs,
  checkTagPublished,
  badFootersMessage,
  benchmarkMessage,
  checkBenchmark,
  checkUpdateNotes,
  cliSurface,
  GATE_SCRIPTS,
  gatedPaths,
  hasGitHubToken,
  isBreakingCommit,
  lateNoteMessage,
  llmsSurfaceProblems,
  missingTokenMessage,
  missingUpdateNotesMessage,
  optOutMessage,
  parseBenchReport,
  releaseSkills,
  REPORT_NAME,
  shouldSkipGate,
  staleDocsMessage,
  staleMainMessage,
  UNATTENDED_CLI_CONTRACT,
  unpublishedTagMessage,
  updateNoteOptOut,
} from "./release-preflight.ts";
import { MVP_MODULES } from "./scaffold-check.ts";
import type { Git, NpmView, NpmViewResult } from "./release-preflight.ts";

describe("shouldSkipGate", () => {
  it("is off when the variable is unset", () => {
    assert.equal(shouldSkipGate({}), false);
  });

  it("is on for exactly 1", () => {
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "1" }), true);
  });

  // "0" and "" read as off to anyone who writes them, and a truthiness check would read
  // both as on.
  it("is off for 0 and for the empty string", () => {
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "0" }), false);
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "" }), false);
  });

  it("is off for any other value", () => {
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "yes" }), false);
    assert.equal(shouldSkipGate({ SAASALOY_RELEASE_SKIP_GATE: "true" }), false);
  });
});

/**
 * The `pnpm <script>` steps of ci.yml's gate job, in file order, minus the install.
 *
 * A regex and not a YAML parse: the repo has no YAML dependency, and adding one to read
 * five lines costs more than it returns. It reads `- run: pnpm x` steps only, so a gate
 * step written any other way goes missing rather than mismatching. The comment in ci.yml
 * points back here for that reason.
 */
function gateStepsInCi(yaml: string): string[] {
  // The gate job only: from its `gate:` key to the next job key at the same indent. The
  // `scaffold` job runs a script the preflight leaves to `release:smoke`.
  const gate =
    /^ {2}gate:\n[\s\S]*?(?=^ {2}[\w-]+:\n|(?![\s\S]))/m.exec(yaml)?.[0] ?? "";
  return [...gate.matchAll(/^\s*- run: pnpm ([\w:]+)(?: .*)?$/gm)]
    .map((match) => match[1]!)
    .filter((script) => script !== "install");
}

describe("GATE_SCRIPTS", () => {
  // The preflight exists so a release never depends on GitHub's view of CI. That only
  // holds while this list is the same one ci.yml runs, so read ci.yml rather than
  // restating it: a step added, dropped or reordered there fails here.
  it("is the scripts ci.yml runs, in the same order", async () => {
    const yaml = await readFile(
      join(import.meta.dirname, "../.github/workflows/ci.yml"),
      "utf-8"
    );
    assert.deepEqual([...GATE_SCRIPTS], gateStepsInCi(yaml));
  });
});

describe("hasGitHubToken", () => {
  it("is false when the variable is unset", () => {
    assert.equal(hasGitHubToken({}), false);
  });

  // `gh auth token` prints nothing and exits non-zero when gh is not logged in, so the
  // root script hands the hook an empty string rather than no variable at all.
  it("is false when the variable is empty or blank", () => {
    assert.equal(hasGitHubToken({ GITHUB_TOKEN: "" }), false);
    assert.equal(hasGitHubToken({ GITHUB_TOKEN: "  \n" }), false);
  });

  it("is true when the variable holds a token", () => {
    assert.equal(hasGitHubToken({ GITHUB_TOKEN: "gho_example" }), true);
  });
});

describe("missingTokenMessage", () => {
  it("tells the maintainer how to recover", () => {
    assert.match(missingTokenMessage(), /gh auth login/);
  });
});

describe("checkTagPublished", () => {
  /** A fake `npm view` that answers every spec with `result` and records what it was asked. */
  function npmView(result: NpmViewResult): { view: NpmView; asked: string[] } {
    const asked: string[] = [];
    return {
      asked,
      view: (spec) => {
        asked.push(spec);
        return result;
      },
    };
  }

  it("asks npm for the version of the tag, without the v", () => {
    const fake = npmView({ status: 0, stdout: "0.8.0\n", stderr: "" });
    checkTagPublished(fake.view, "saasaloy", "v0.8.0");
    assert.deepEqual(fake.asked, ["saasaloy@0.8.0"]);
  });

  it("reads a printed version as published", () => {
    const fake = npmView({ status: 0, stdout: "0.8.0\n", stderr: "" });
    assert.deepEqual(checkTagPublished(fake.view, "saasaloy", "v0.8.0"), {
      state: "published",
      version: "0.8.0",
    });
  });

  it("reads an E404 as missing", () => {
    const fake = npmView({
      status: 1,
      stdout: "",
      stderr:
        "npm error code E404\nnpm error 404 No match found for version 0.9.0\n",
    });
    assert.deepEqual(checkTagPublished(fake.view, "saasaloy", "v0.9.0"), {
      state: "missing",
      version: "0.9.0",
    });
  });

  it("reads a network error as unknown, never as missing", () => {
    const fake = npmView({
      status: 1,
      stdout: "",
      stderr:
        "npm error code ENOTFOUND\nnpm error request to https://registry.npmjs.org/saasaloy failed\n",
    });
    const result = checkTagPublished(fake.view, "saasaloy", "v0.9.0");
    assert.equal(result.state, "unknown");
    assert.match(result.state === "unknown" ? result.detail : "", /ENOTFOUND/);
  });

  it("reads an npm that cannot start as unknown", () => {
    const fake = npmView({
      status: null,
      stdout: "",
      stderr: "",
      error: new Error("spawn npm ENOENT"),
    });
    assert.equal(
      checkTagPublished(fake.view, "saasaloy", "v0.9.0").state,
      "unknown"
    );
  });

  it("reads an empty answer with exit 0 as unknown, not as published", () => {
    const fake = npmView({ status: 0, stdout: "", stderr: "" });
    assert.equal(
      checkTagPublished(fake.view, "saasaloy", "v0.9.0").state,
      "unknown"
    );
  });
});

describe("unpublishedTagMessage", () => {
  const message = unpublishedTagMessage("saasaloy", "v0.9.0");

  it("names the version, the tag and the workflow to rerun", () => {
    assert.match(message, /saasaloy@0\.9\.0/);
    assert.match(message, /v0\.9\.0/);
    assert.match(message, /publish\.yml/);
  });
});

describe("staleDocsMessage", () => {
  it("is undefined when every page is current", () => {
    assert.equal(staleDocsMessage({ base: undefined, pages: [] }), undefined);
  });

  it("lists each stale page with its commits and says the release goes on", () => {
    const text = staleDocsMessage({
      base: undefined,
      pages: [
        {
          path: "getting-started.md",
          title: "Getting started",
          stamp: "928b4f03",
          commits: [{ sha: "e04a7e7a", subject: "fix(cli): use org keys" }],
          note: undefined,
        },
      ],
    });
    assert.ok(text !== undefined);
    assert.match(text, /1 page\(s\) have covered files/);
    assert.match(text, /docs\/wiki\/getting-started\.md \(Getting started\)/);
    assert.match(text, /e04a7e7a fix\(cli\): use org keys/);
    assert.match(text, /does not stop the release/);
  });
});

describe("staleMainMessage", () => {
  const message = staleMainMessage("abc1234", "def5678");

  it("names both commits", () => {
    assert.match(message, /abc1234/);
    assert.match(message, /def5678/);
  });

  it("tells the maintainer how to recover", () => {
    assert.match(message, /git pull/);
  });
});

/**
 * A fake git for `breakingCommitsSince`: a log of commits and the files each one added.
 * Answers only the calls the function makes, and throws on any other, so a test fails
 * loudly when the function starts asking git something new.
 */
function fakeGit(
  commits: readonly {
    hash: string;
    message: string;
    added?: readonly string[];
  }[]
): Git {
  return (args) => {
    if (args[0] === "log") {
      return commits
        .map((commit) => `${commit.hash}\u001F${commit.message}\u001E`)
        .join("\n");
    }
    if (args[0] === "diff-tree") {
      const hash = args.at(-1);
      const commit = commits.find((entry) => entry.hash === hash);
      return (commit?.added ?? []).join("\n");
    }
    throw new Error(`unexpected git call: git ${args.join(" ")}`);
  };
}

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);

describe("isBreakingCommit", () => {
  it("is true for `type!:` and `type(scope)!:`", () => {
    assert.equal(isBreakingCommit("feat!: drop node 20"), true);
    assert.equal(isBreakingCommit("feat(cli)!: drop node 20"), true);
  });

  it("is true for a BREAKING CHANGE or BREAKING-CHANGE footer", () => {
    assert.equal(
      isBreakingCommit("feat: x\n\nBREAKING CHANGE: the flag is gone"),
      true
    );
    assert.equal(
      isBreakingCommit("feat: x\n\nBREAKING-CHANGE: the flag is gone"),
      true
    );
  });

  it("is false for a plain commit, or one that only mentions the words", () => {
    assert.equal(isBreakingCommit("feat: add a flag"), false);
    assert.equal(
      isBreakingCommit("fix: x\n\nThis is not a BREAKING CHANGE: honest."),
      false
    );
  });
});

describe("updateNoteOptOut", () => {
  it("reads the reason from `Update-Note: none (<reason>)`", () => {
    assert.equal(
      updateNoteOptOut("feat!: x\n\nUpdate-Note: none (no project impact)"),
      "no project impact"
    );
  });

  it("is null for an empty or blank reason", () => {
    assert.equal(updateNoteOptOut("feat!: x\n\nUpdate-Note: none ()"), null);
    assert.equal(updateNoteOptOut("feat!: x\n\nUpdate-Note: none (  )"), null);
  });

  it("is null when the footer is missing or is not `none`", () => {
    assert.equal(updateNoteOptOut("feat!: x"), null);
    assert.equal(updateNoteOptOut("feat!: x\n\nUpdate-Note: later"), null);
  });
});

describe("checkUpdateNotes", () => {
  it("fails a breaking commit with no note and no footer", () => {
    const result = checkUpdateNotes(
      fakeGit([{ hash: HASH_A, message: "feat(cli)!: drop the old flag\n" }]),
      "v0.8.0"
    );
    assert.equal(result.missing.length, 1);
    assert.equal(result.missing[0]!.shortHash, "aaaaaaa");
    assert.equal(result.missing[0]!.subject, "feat(cli)!: drop the old flag");
  });

  it("passes a breaking commit that adds an update note", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: HASH_A,
          message: "feat(cli)!: drop the old flag\n",
          added: [
            "packages/cli/src/index.ts",
            "packages/cli/update-notes/0.9.0-drop-flag.md",
          ],
        },
        {
          hash: HASH_B,
          message: "feat(auth)!: rename a table\n",
          added: ["modules/auth/update-notes/0.9.0-rename.md"],
        },
      ]),
      "v0.8.0"
    );
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.optOuts, []);
  });

  it("does not count a file that only sits beside a folder named like it", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: HASH_A,
          message: "feat!: x\n",
          added: ["docs/my-update-notes/x.md", "update-notes.md"],
        },
      ]),
      "v0.8.0"
    );
    assert.equal(result.missing.length, 1);
  });

  it("passes a breaking commit with an opt-out footer that has a reason", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: HASH_A,
          message:
            "feat!: drop the old flag\n\nUpdate-Note: none (the flag was never documented)\n",
        },
      ]),
      "v0.8.0"
    );
    assert.deepEqual(result.missing, []);
    assert.equal(result.optOuts.length, 1);
    assert.equal(result.optOuts[0]!.reason, "the flag was never documented");
  });

  it("fails a breaking commit whose opt-out footer has an empty reason", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: HASH_A,
          message: "feat!: drop the old flag\n\nUpdate-Note: none ()\n",
        },
      ]),
      "v0.8.0"
    );
    assert.equal(result.missing.length, 1);
    assert.deepEqual(result.optOuts, []);
  });

  it("ignores a commit that is not breaking", () => {
    const result = checkUpdateNotes(
      fakeGit([{ hash: HASH_A, message: "feat: add a flag\n" }]),
      "v0.8.0"
    );
    assert.deepEqual(result, {
      missing: [],
      optOuts: [],
      late: [],
      badFooters: [],
    });
  });

  it("reads the commits after the tag, skipping merges", () => {
    const calls: string[][] = [];
    const git: Git = (args) => {
      calls.push([...args]);
      return "";
    };
    checkUpdateNotes(git, "v0.8.0");
    assert.ok(calls[0]!.includes("v0.8.0..HEAD"));
    assert.ok(calls[0]!.includes("--no-merges"));
  });
});

// Issue #358: a breaking commit that shipped without its note gets one from a later
// commit carrying `Update-Note-For: <full sha>`. These replay the real case, 974d223.
describe("checkUpdateNotes with a late note", () => {
  const BREAKING = "974d223f83c798fc66f674a5bd48a52cee1d7321";
  const LATE = "c".repeat(40);
  const breakingCommit = {
    hash: BREAKING,
    message:
      "feat(auth)!: gate admin routes and close plugin admin endpoints\n\nBREAKING CHANGE: /admin/auth/admin/* no longer answers over http.\n",
    added: [],
  };

  it("counts a later commit's note for the commit its footer names", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: LATE,
          message: `docs(auth): add the update note for the admin endpoints\n\nUpdate-Note-For: ${BREAKING}\n`,
          added: ["modules/auth/update-notes/0006-admin-plugin-endpoints.md"],
        },
        breakingCommit,
      ]),
      "v0.8.0"
    );
    assert.deepEqual(result.missing, []);
    assert.deepEqual(result.badFooters, []);
    assert.equal(result.late.length, 1);
    assert.equal(result.late[0]!.shortHash, "974d223");
    assert.deepEqual(result.late[0]!.by, ["ccccccc"]);
  });

  it("fails a footer that names a commit that is not breaking", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: LATE,
          message: `docs: add a note\n\nUpdate-Note-For: ${HASH_A}\n`,
          added: ["modules/auth/update-notes/0006-x.md"],
        },
        { hash: HASH_A, message: "feat(auth): add a flag\n" },
      ]),
      "v0.8.0"
    );
    assert.equal(result.badFooters.length, 1);
    assert.match(result.badFooters[0]!, /Update-Note-For: a{40}/);
    assert.match(result.badFooters[0]!, /not a breaking commit since v0\.8\.0/);
  });

  it("fails a footer whose commit adds no note, and leaves the commit missing", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: LATE,
          message: `docs: promise a note\n\nUpdate-Note-For: ${BREAKING}\n`,
          added: ["docs/x.md"],
        },
        breakingCommit,
      ]),
      "v0.8.0"
    );
    assert.equal(result.badFooters.length, 1);
    assert.match(result.badFooters[0]!, /Update-Note-For: 974d223f/);
    assert.match(result.badFooters[0]!, /adds no update note/);
    assert.equal(result.missing.length, 1);
  });

  it("fails a short SHA, and leaves the commit missing", () => {
    const result = checkUpdateNotes(
      fakeGit([
        {
          hash: LATE,
          message: "docs: add a note\n\nUpdate-Note-For: 974d223\n",
          added: ["modules/auth/update-notes/0006-x.md"],
        },
        breakingCommit,
      ]),
      "v0.8.0"
    );
    assert.equal(result.badFooters.length, 1);
    assert.match(result.badFooters[0]!, /"Update-Note-For: 974d223"/);
    assert.match(result.badFooters[0]!, /full 40-character/);
    assert.equal(result.missing.length, 1);
  });
});

describe("badFootersMessage and lateNoteMessage", () => {
  it("names the footer and its form", () => {
    const message = badFootersMessage(["ccccccc docs: x: bad"]);
    assert.match(message, /Update-Note-For/);
    assert.match(message, /ccccccc docs: x: bad/);
  });

  it("names the commit that added the late note", () => {
    assert.equal(
      lateNoteMessage({
        hash: HASH_A,
        shortHash: "aaaaaaa",
        subject: "feat!: x",
        by: ["ccccccc"],
      }),
      "aaaaaaa feat!: x: update note added later by ccccccc (Update-Note-For)"
    );
  });
});

describe("missingUpdateNotesMessage", () => {
  const message = missingUpdateNotesMessage([
    {
      hash: HASH_A,
      shortHash: "aaaaaaa",
      subject: "feat(cli)!: drop the old flag",
    },
  ]);

  it("names the commit", () => {
    assert.match(message, /aaaaaaa feat\(cli\)!: drop the old flag/);
  });

  it("says what to add", () => {
    assert.match(message, /update-notes\//);
    assert.match(message, /Update-Note: none \(<reason>\)/);
    assert.match(message, /Update-Note-For: <full sha>/);
  });
});

describe("optOutMessage", () => {
  it("prints the short SHA, the subject and the reason", () => {
    assert.equal(
      optOutMessage({
        hash: HASH_A,
        shortHash: "aaaaaaa",
        subject: "feat!: x",
        reason: "no project impact",
      }),
      "aaaaaaa feat!: x: no update note (no project impact)"
    );
  });
});

// ADR 0062: `llms.txt` is the first file an agent reads, and it must not name a skill, a
// command or a flag the release lacks. The release is the npm package (the base skills
// under its template, and the commands and flags the built CLI's help prints) plus the
// registry at the release tag, which is this commit's `modules/`.
describe("llmsSurfaceProblems", () => {
  const TOP_HELP = [
    "Usage: saasaloy <command> [options]",
    "",
    "Commands:",
    "  init     scaffold a new Saasaloy project",
    "  add      apply a module",
    "  list     list the modules a registry offers",
    "",
    "Options:",
    "  -h, --help     show this help, or a command's own usage",
    "  -v, --version  print the installed saasaloy version",
    "",
  ].join("\n");
  const surface = cliSurface(TOP_HELP, {
    add: "Flags:\n  -y, --yes        skip the prompt\n  --with <module>  pick one\n  -h, --help       show this help\n",
    init: "Flags:\n  --force           scaffold anyway\n  -y, --yes         install\n  --testing=<mode>  the mode\n  -h, --help        show this help\n",
    list: "Flags:\n  --json  print JSON\n  -h, --help  show this help\n",
  });
  const skills = new Set(["saasaloy-build", "saasaloy-setup"]);
  const BASE =
    "https://github.com/mimukit/saasaloy/blob/main/packages/cli/templates/base/_agents/skills";

  it("reads the commands and flags off the help text", () => {
    assert.deepEqual([...surface.commands.keys()], ["init", "add", "list"]);
    assert.deepEqual(
      [...(surface.commands.get("init") ?? [])],
      ["--force", "-y", "--yes", "--testing", "-h", "--help"]
    );
    assert.ok(surface.globalFlags.has("--version"));
  });

  it("passes a file that names only what the release holds", () => {
    const markdown = [
      "Run `npx saasaloy@latest init . --force --yes --testing=tests-after`, then `saasaloy add <module>@main` and `saasaloy list --json`.",
      "`--yes` runs install. Read `.agents/skills/saasaloy-build/SKILL.md`, then the `saasaloy-setup` skill.",
      `- [saasaloy-build](${BASE}/saasaloy-build/SKILL.md): the build.`,
    ].join("\n");
    assert.deepEqual(llmsSurfaceProblems(markdown, surface, skills), []);
  });

  it("fails a skill the release lacks, by link, by path and by name", () => {
    const markdown = [
      `- [saasaloy-gone](${BASE}/saasaloy-gone/SKILL.md): gone.`,
      "Read `.agents/skills/saasaloy-old/SKILL.md` and the `saasaloy-missing` skill.",
    ].join("\n");
    assert.deepEqual(llmsSurfaceProblems(markdown, surface, skills), [
      'the skill "saasaloy-gone" is not in the release',
      'the skill "saasaloy-old" is not in the release',
      'the skill "saasaloy-missing" is not in the release',
    ]);
  });

  it("fails a command the CLI does not register", () => {
    assert.deepEqual(
      llmsSurfaceProblems("Run `saasaloy build --yes`.", surface, skills),
      ['the command "saasaloy build" is not in the CLI']
    );
  });

  it("fails a flag the command does not take, and a bare flag no command takes", () => {
    assert.deepEqual(
      llmsSurfaceProblems(
        "Run `saasaloy list --all` and pass `--quiet`.",
        surface,
        skills
      ),
      [
        'the flag "--all" is not a flag of "saasaloy list"',
        'the flag "--quiet" is not a flag of any command',
      ]
    );
  });

  it("holds the real llms.txt to the skills this commit ships", async () => {
    const root = join(import.meta.dirname, "..");
    const markdown = await readFile(join(root, "llms.txt"), "utf-8");
    const problems = llmsSurfaceProblems(
      markdown,
      { commands: new Map(), globalFlags: new Set() },
      releaseSkills(root)
    ).filter((problem) => problem.startsWith("the skill"));
    assert.deepEqual(problems, []);
  });
});

// Plan 0109, "Which releases need a run": a release that changes a base skill, the
// unattended CLI contract or a module of the MVP set calls for a score report for the three
// benchmark briefs with no FAIL line. Any other release calls for none. The preflight only
// warns: the benchmark runs on demand and never blocks a release.
describe("gatedPaths", () => {
  it("names a base skill, a contract file and a module of the MVP set", () => {
    assert.deepEqual(
      gatedPaths([
        `${BASE_SKILLS}saasaloy-build/SKILL.md`,
        "packages/cli/src/commands/env.ts",
        "modules/auth/files/src/auth.ts",
        "modules/database-postgres/registry-item.json",
      ]),
      [
        `${BASE_SKILLS}saasaloy-build/SKILL.md`,
        "packages/cli/src/commands/env.ts",
        "modules/auth/files/src/auth.ts",
        "modules/database-postgres/registry-item.json",
      ]
    );
  });

  it("passes over docs, other CLI files, other modules and a contract file's test", () => {
    assert.deepEqual(
      gatedPaths([
        "docs/wiki/getting-started.md",
        "packages/cli/src/commands/add.ts",
        "packages/cli/src/commands/env.test.ts",
        "modules/teams/files/src/teams.ts",
        "modules/cms/registry-item.json",
        "modules/authx/README.md",
        "packages/cli/templates/base/AGENTS.md",
      ]),
      []
    );
  });

  it("takes the MVP set from scaffold-check and the contract from ADR 0046's files", () => {
    assert.ok(MVP_MODULES.length > 0);
    for (const name of MVP_MODULES) {
      assert.deepEqual(gatedPaths([`modules/${name}/x`]), [
        `modules/${name}/x`,
      ]);
    }
    assert.deepEqual(
      [...UNATTENDED_CLI_CONTRACT],
      [
        "packages/cli/src/lib/prompts.ts",
        "packages/cli/src/lib/tui.ts",
        "packages/cli/src/lib/exit.ts",
        "packages/cli/src/lib/json-output.ts",
        "packages/cli/src/commands/env.ts",
        "packages/cli/src/commands/list.ts",
      ]
    );
  });
});

describe("benchBriefs", () => {
  it("lists the three brief folders of the benchmark", () => {
    assert.deepEqual(benchBriefs(join(import.meta.dirname, "..")), [
      "prepline",
      "receiptbox",
      "shelfnote",
    ]);
  });
});

const REV = "0123456789abcdef0123456789abcdef01234567";
const score = (brief: string, rows: string, mode = "interview", rev = REV) =>
  [
    `# Agent benchmark: ${brief}`,
    "",
    `Brief: ${brief}`,
    `Mode: ${mode}`,
    `Revision: ${rev}`,
    "",
    "| #  | MVP bar line | Result | Detail |",
    "| -- | ------------ | ------ | ------ |",
    rows,
    "",
  ].join("\n");
const PASS_ROW = "| 1  | Landing      | PASS   | ok     |";
const FAIL_ROW = "| 4  | Entity       | FAIL   | no app |";

describe("REPORT_NAME and parseBenchReport", () => {
  it("matches a research report of the benchmark only", () => {
    assert.match("0012-research-agent-bench-v0-10-2026-11-20.md", REPORT_NAME);
    assert.doesNotMatch(
      "0011-research-agent-native-readiness-2026-11-17.md",
      REPORT_NAME
    );
  });

  it("reads each brief's mode and revision, and each FAIL line", () => {
    const report = parseBenchReport(
      "0012-research-agent-bench-x-2026-11-20.md",
      `# Report\n\n${score("shelfnote", PASS_ROW)}\n${score("prepline", FAIL_ROW, "brief")}\nFAIL 4: stop point: x\n`
    );
    assert.deepEqual(report.briefs, [
      { brief: "shelfnote", mode: "interview", revision: REV },
      { brief: "prepline", mode: "brief", revision: REV },
    ]);
    assert.deepEqual(report.fails, [FAIL_ROW, "FAIL 4: stop point: x"]);
  });
});

describe("checkBenchmark", () => {
  const briefs = ["prepline", "receiptbox", "shelfnote"];
  const all = (rows: string) =>
    briefs.map((brief) => score(brief, rows)).join("\n");
  const report = (file: string, text: string) => parseBenchReport(file, text);
  const covers = (revision: string) => revision === REV;
  const SKILL = `${BASE_SKILLS}saasaloy-setup/SKILL.md`;

  it("passes with no report when no gated path changed", () => {
    const result = checkBenchmark({
      changed: ["docs/wiki/reference.md", "packages/cli/src/commands/add.ts"],
      reports: [],
      briefs,
      covers,
    });
    assert.deepEqual(result.needed, []);
    assert.deepEqual(result.problems, []);
  });

  it("suggests a run for a gated change with no report, and lets the release go on", () => {
    const result = checkBenchmark({
      changed: [SKILL],
      reports: [],
      briefs,
      covers,
    });
    assert.deepEqual(result.needed, [SKILL]);
    assert.match(result.problems.join("\n"), /no score report/);
    assert.match(benchmarkMessage(result), /saasaloy-setup\/SKILL\.md/);
    assert.match(benchmarkMessage(result), /The release may go on/);
  });

  it("suggests a run when the covering report holds a FAIL line", () => {
    const result = checkBenchmark({
      changed: [SKILL],
      reports: [
        report("0012-research-agent-bench-a-2026-11-20.md", all(FAIL_ROW)),
      ],
      briefs,
      covers,
    });
    assert.match(result.problems.join("\n"), /FAIL/);
  });

  it("passes a report for the three briefs with no FAIL line", () => {
    const result = checkBenchmark({
      changed: [SKILL],
      reports: [
        report("0012-research-agent-bench-a-2026-11-20.md", all(PASS_ROW)),
      ],
      briefs,
      covers,
    });
    assert.deepEqual(result.problems, []);
    assert.equal(result.cleared, "0012-research-agent-bench-a-2026-11-20.md");
  });

  it("does not count a report that misses a brief, ran brief mode, or scored an older revision", () => {
    const missing = checkBenchmark({
      changed: [SKILL],
      reports: [
        report(
          "0012-research-agent-bench-a-2026-11-20.md",
          score("shelfnote", PASS_ROW)
        ),
      ],
      briefs,
      covers,
    });
    assert.match(
      missing.problems.join("\n"),
      /no score for the brief prepline/
    );
    const briefMode = checkBenchmark({
      changed: [SKILL],
      reports: [
        report(
          "0012-research-agent-bench-a-2026-11-20.md",
          briefs.map((b) => score(b, PASS_ROW, "brief")).join("\n")
        ),
      ],
      briefs,
      covers,
    });
    assert.match(briefMode.problems.join("\n"), /brief mode, not interview/);
    const old = checkBenchmark({
      changed: [SKILL],
      reports: [
        report(
          "0012-research-agent-bench-a-2026-11-20.md",
          briefs
            .map((b) => score(b, PASS_ROW, "interview", "abcdef1"))
            .join("\n")
        ),
      ],
      briefs,
      covers,
    });
    assert.match(old.problems.join("\n"), /abcdef1/);
  });

  it("takes the newest report that covers this release", () => {
    const result = checkBenchmark({
      changed: [SKILL],
      reports: [
        report("0012-research-agent-bench-a-2026-11-20.md", all(PASS_ROW)),
        report("0013-research-agent-bench-b-2026-11-21.md", all(FAIL_ROW)),
      ],
      briefs,
      covers,
    });
    assert.match(result.problems.join("\n"), /0013-research-agent-bench-b/);
  });
});
