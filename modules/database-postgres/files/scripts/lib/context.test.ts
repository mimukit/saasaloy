// Tests for the migration count in ./context.ts that `db:setup` reads to skip `db:migrate`
// on a project with no table yet. Repo-only, like ./state.test.ts: the descriptor does not
// ship it. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import { journalEntries } from "./context.ts";

const roots: string[] = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeRoot(journal?: string): string {
  const root = mkdtempSync(path.join(tmpdir(), "pg-journal-"));
  roots.push(root);
  if (journal !== undefined) {
    const meta = path.join(root, "packages/db/migrations/meta");
    mkdirSync(meta, { recursive: true });
    writeFileSync(path.join(meta, "_journal.json"), journal);
  }
  return root;
}

describe("journalEntries", () => {
  it("counts zero when no migrations folder exists yet", () => {
    assert.equal(journalEntries(makeRoot()), 0);
  });

  it("counts zero for a journal with no entries", () => {
    assert.equal(journalEntries(makeRoot('{"entries":[]}')), 0);
  });

  it("counts zero for a journal it cannot parse", () => {
    assert.equal(journalEntries(makeRoot("{")), 0);
  });

  it("counts each migration drizzle-kit recorded", () => {
    assert.equal(
      journalEntries(makeRoot('{"entries":[{"idx":0},{"idx":1}]}')),
      2
    );
  });
});
