// Tests for `scripts/changelog-update-notes.ts` (issue #298). release-it's changelog plugin
// calls `finalizeUpdateNotes` through `packages/cli/.release-it.js`, so a breaking item in
// the generated CHANGELOG links the update note its commit added, at the release tag.
//
// It runs on `node:test` under Node's type stripping, like the other maintainer-script
// suites. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Git } from "./changelog-update-notes.ts";
import {
  addedUpdateNotes,
  finalizeUpdateNotes,
  isUpdateNotePath,
  updateNoteUrl,
} from "./changelog-update-notes.ts";

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);

/** A fake git that answers `diff-tree` from a table of added files per commit. */
function fakeGit(added: Record<string, readonly string[]>): Git {
  return (args) => {
    if (args[0] !== "diff-tree") {
      throw new Error(`unexpected git call: git ${args.join(" ")}`);
    }
    return (added[args.at(-1) ?? ""] ?? []).join("\n");
  };
}

describe("isUpdateNotePath", () => {
  it("matches a file under any update-notes folder", () => {
    assert.equal(
      isUpdateNotePath("packages/cli/update-notes/0.9.0-x.md"),
      true
    );
    assert.equal(
      isUpdateNotePath("modules/auth/update-notes/0.9.0-x.md"),
      true
    );
    assert.equal(isUpdateNotePath("update-notes/x.md"), true);
  });

  it("does not match a folder that only ends in the name, or a file", () => {
    assert.equal(isUpdateNotePath("docs/my-update-notes/x.md"), false);
    assert.equal(isUpdateNotePath("update-notes.md"), false);
  });
});

describe("addedUpdateNotes", () => {
  it("keeps only the added files under update-notes folders", () => {
    const git = fakeGit({
      [HASH_A]: [
        "packages/cli/src/a.ts",
        "packages/cli/update-notes/0.9.0-a.md",
      ],
    });
    assert.deepEqual(addedUpdateNotes(git, HASH_A), [
      "packages/cli/update-notes/0.9.0-a.md",
    ]);
  });

  it("asks git for the files the commit added, and only those", () => {
    let seen: readonly string[] = [];
    addedUpdateNotes((args) => {
      seen = args;
      return "";
    }, HASH_A);
    assert.ok(seen.includes("--diff-filter=A"));
    assert.equal(seen.at(-1), HASH_A);
  });
});

describe("updateNoteUrl", () => {
  it("points at the file at the release tag", () => {
    assert.equal(
      updateNoteUrl("0.9.0", "modules/auth/update-notes/0.9.0-x.md"),
      "https://github.com/mimukit/saasaloy/blob/v0.9.0/modules/auth/update-notes/0.9.0-x.md"
    );
  });
});

/** The slice of the writer context `finalizeUpdateNotes` reads. */
function context(notes: { text: string; hash: string }[]) {
  return {
    linkCompare: undefined as boolean | undefined,
    version: "0.9.0",
    previousTag: "v0.8.0",
    currentTag: "v0.9.0",
    noteGroups: [
      {
        title: "BREAKING CHANGES",
        notes: notes.map((note) => ({
          title: "BREAKING CHANGES",
          text: note.text,
          commit: { hash: note.hash },
        })),
      },
    ],
  };
}

describe("finalizeUpdateNotes", () => {
  it("appends a link to the note the breaking commit added", () => {
    const result = finalizeUpdateNotes(
      context([{ text: "drop the old flag", hash: HASH_A }]),
      fakeGit({ [HASH_A]: ["packages/cli/update-notes/0.9.0-flag.md"] })
    );
    assert.equal(
      result.noteGroups[0]!.notes[0]!.text,
      "drop the old flag (update note: [packages/cli/update-notes/0.9.0-flag.md](https://github.com/mimukit/saasaloy/blob/v0.9.0/packages/cli/update-notes/0.9.0-flag.md))"
    );
  });

  it("leaves a note alone when its commit added no update note", () => {
    const result = finalizeUpdateNotes(
      context([{ text: "drop the old flag", hash: HASH_B }]),
      fakeGit({})
    );
    assert.equal(result.noteGroups[0]!.notes[0]!.text, "drop the old flag");
  });

  it("turns on the compare link the way the default finalizer does", () => {
    const result = finalizeUpdateNotes(context([]), fakeGit({}));
    assert.equal(result.linkCompare, true);
  });
});
