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
import { updateNoteReasonRule as rule } from "./update-note-footer.ts";

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
