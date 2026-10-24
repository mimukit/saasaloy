// Tests for ./commands.ts against the real ./nav.ts. This file is NOT in the descriptor's
// `scaffolds[].files` list, so `add app` never copies it into a user's project; it
// exists for this repo only, the same way ../lib/initials.test.ts does. Run it with
// `pnpm test:modules`.
//
// nav.ts and commands.ts import icons from lucide-react, which this repo does not
// install. scripts/ts-resolve-hook.ts answers that import with stub components, so the
// real NAV_AREAS loads here unchanged.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { appCommands } from "./commands.ts";
import { NAV_AREAS } from "./nav.ts";

function build() {
  const calls: string[] = [];
  const commands = appCommands({
    navigate: (to) => {
      calls.push(`navigate ${to}`);
    },
    signOut: () => {
      calls.push("sign out");
    },
    setTheme: (theme) => {
      calls.push(`theme ${theme}`);
    },
  });
  return { commands, calls };
}

const rows = NAV_AREAS.flatMap((area) =>
  area.groups.flatMap((group) => group.items)
);

describe("appCommands", () => {
  it("gives every NAV_AREAS row a Go to command that opens the row", () => {
    const { commands, calls } = build();
    assert.ok(rows.length > 0);
    for (const row of rows) {
      const command = commands.find(
        (candidate) => candidate.title === `Go to ${row.label}`
      );
      assert.ok(command, `no command for the nav row "${row.label}"`);
      assert.equal(command.group, "navigation");
      assert.match(command.id, /^app\.go-to-[a-z0-9-]+$/);
      assert.equal(
        command.shortcut,
        "shortcut" in row ? row.shortcut : undefined
      );
      calls.length = 0;
      command.run({ source: "palette" });
      assert.deepEqual(calls, [`navigate ${row.to}`]);
    }
  });

  it("binds G H to Home", () => {
    const { commands } = build();
    const home = commands.find((command) => command.title === "Go to Home");
    assert.equal(home?.shortcut, "G H");
  });

  it("gives no two commands one shortcut", () => {
    const { commands } = build();
    const shortcuts = commands
      .map((command) => command.shortcut?.toUpperCase())
      .filter((shortcut) => shortcut !== undefined);
    assert.ok(shortcuts.length > 0);
    assert.equal(
      new Set(shortcuts).size,
      shortcuts.length,
      shortcuts.join(", ")
    );
  });

  it("gives no two commands one id", () => {
    const { commands } = build();
    const ids = commands.map((command) => command.id);
    assert.equal(new Set(ids).size, ids.length, ids.join(", "));
  });

  it("adds sign out and the three theme choices", () => {
    const { commands, calls } = build();
    const run = (title: string) => {
      const command = commands.find((candidate) => candidate.title === title);
      assert.ok(command, `no command "${title}"`);
      command.run({ source: "palette" });
      return command;
    };

    assert.equal(run("Sign out").group, "actions");
    for (const label of ["Light", "Dark", "System"]) {
      assert.equal(run(`Theme: ${label}`).group, "preferences");
    }
    assert.deepEqual(calls, [
      "sign out",
      "theme light",
      "theme dark",
      "theme system",
    ]);
  });
});
