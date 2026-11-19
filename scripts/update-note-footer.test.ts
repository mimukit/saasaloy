// Tests for `scripts/update-note-footer.ts`, the local commitlint rule that
// `commitlint.config.js` registers (issue #298). A breaking
// commit may opt out of an update note with `Update-Note: none (<reason>)`, and the release
// preflight prints that reason, so the rule rejects the footer at commit time when the
// reason is empty or the value is not `none (...)`.
//
// It calls the rule directly with the one field it reads. Pipe a message through
// `pnpm exec commitlint` to check the wiring, which is what the commit-msg hook runs.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  updateNoteForFooters,
  updateNoteForRule,
  updateNoteReasonRule as rule,
} from "./update-note-footer.ts";

function check(raw: string): boolean {
  return rule({ raw })[0];
}

describe("the update-note-reason rule", () => {
  it("passes a message with no Update-Note footer", () => {
    assert.equal(check("feat!: drop the old flag\n"), true);
  });

  it("passes `none (<reason>)`", () => {
    assert.equal(
      check(
        "feat!: drop the old flag\n\nUpdate-Note: none (no project impact)\n"
      ),
      true
    );
  });

  it("fails an empty or blank reason", () => {
    assert.equal(check("feat!: x\n\nUpdate-Note: none ()\n"), false);
    assert.equal(check("feat!: x\n\nUpdate-Note: none (   )\n"), false);
  });

  it("fails a value that is not `none (...)`", () => {
    assert.equal(check("feat!: x\n\nUpdate-Note: none\n"), false);
    assert.equal(check("feat!: x\n\nUpdate-Note: later\n"), false);
  });

  it("names the expected form in its message", () => {
    assert.match(
      rule({ raw: "feat!: x\n\nUpdate-Note: none ()\n" })[1] ?? "",
      /none \(<reason>\)/
    );
  });

  // git leaves `#` lines in the message the hook reads; they are not part of the commit.
  it("ignores a commented-out footer", () => {
    assert.equal(check("feat!: x\n\n# Update-Note: none ()\n"), true);
  });

  it("passes when commitlint hands it no raw message", () => {
    assert.equal(rule({})[0], true);
  });
});

const SHA = "974d223f83c798fc66f674a5bd48a52cee1d7321";

describe("updateNoteForFooters", () => {
  it("reads each `Update-Note-For:` footer, several per commit", () => {
    const other = "b".repeat(40);
    assert.deepEqual(
      updateNoteForFooters(
        `docs(auth): add the note\n\nUpdate-Note-For: ${SHA}\nUpdate-Note-For: ${other}\n`
      ),
      [
        { value: SHA, sha: SHA },
        { value: other, sha: other },
      ]
    );
  });

  it("gives a null SHA for a short or malformed value", () => {
    assert.deepEqual(
      updateNoteForFooters("docs: x\n\nUpdate-Note-For: 974d223\n"),
      [{ value: "974d223", sha: null }]
    );
    assert.equal(
      updateNoteForFooters(`docs: x\n\nUpdate-Note-For: ${SHA}0\n`)[0]!.sha,
      null
    );
    assert.equal(
      updateNoteForFooters(
        `docs: x\n\nUpdate-Note-For: ${"g".repeat(40)}\n`
      )[0]!.sha,
      null
    );
  });

  it("is not confused with an `Update-Note:` footer", () => {
    assert.deepEqual(
      updateNoteForFooters("feat!: x\n\nUpdate-Note: none (no impact)\n"),
      []
    );
  });
});

describe("the update-note-for-sha rule", () => {
  it("passes a full SHA and a message with no footer", () => {
    assert.equal(
      updateNoteForRule({ raw: `docs: x\n\nUpdate-Note-For: ${SHA}\n` })[0],
      true
    );
    assert.equal(updateNoteForRule({ raw: "docs: x\n" })[0], true);
    assert.equal(updateNoteForRule({})[0], true);
  });

  it("fails a short SHA and names the footer", () => {
    const [ok, message] = updateNoteForRule({
      raw: "docs: x\n\nUpdate-Note-For: 974d223f\n",
    });
    assert.equal(ok, false);
    assert.match(message ?? "", /Update-Note-For: 974d223f/);
    assert.match(message ?? "", /full 40-character/);
  });

  it("does not let the update-note-reason rule read the footer", () => {
    assert.equal(check(`docs: x\n\nUpdate-Note-For: ${SHA}\n`), true);
  });
});
