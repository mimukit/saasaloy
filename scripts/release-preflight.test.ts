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
  checkUpdateNotes,
  GATE_SCRIPTS,
  hasGitHubToken,
  isBreakingCommit,
  missingTokenMessage,
  missingUpdateNotesMessage,
  optOutMessage,
  shouldSkipGate,
  staleMainMessage,
  updateNoteOptOut,
} from "./release-preflight.ts";
import type { Git } from "./release-preflight.ts";

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
  return [...yaml.matchAll(/^\s*- run: pnpm ([\w:]+)(?: .*)?$/gm)]
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
    assert.deepEqual(result, { missing: [], optOuts: [] });
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
