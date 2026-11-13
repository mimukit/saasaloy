// Tests for ./shortcut-hints.ts. This file is NOT in the descriptor's `files` list, so
// `add shell` never copies it into a user's project; it exists for this repo only.
//
// It runs on `node:test` under `pnpm test:modules`. The import needs the explicit `.ts`
// extension because Node's type stripping resolves the real file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PendingShortcut } from "./commands.ts";
import { sidebarHints } from "./shortcut-hints.ts";

const USERS: PendingShortcut = {
  shortcut: "G U",
  title: "Go to Users",
  rest: [["U"]],
};
const NEW_USER: PendingShortcut = {
  shortcut: "G N",
  title: "Go to New user",
  rest: [["N"]],
};

describe("sidebarHints", () => {
  it("puts a hint on its row and lists a hint with no row at the foot", () => {
    const { rows, offSidebar } = sidebarHints(
      ["G O", "G U", undefined],
      [USERS, NEW_USER]
    );
    assert.deepEqual([...rows.entries()], [["G U", USERS]]);
    assert.deepEqual(offSidebar, [NEW_USER]);
  });

  it("shows nothing when no sequence is in progress", () => {
    const { rows, offSidebar } = sidebarHints(["G U"], []);
    assert.equal(rows.size, 0);
    assert.deepEqual(offSidebar, []);
  });
});
