// Tests for ./commands.ts against the real ./nav.ts. `add admin` ships this file as
// `commands.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest.
//
// nav.ts and commands.ts import icons from lucide-react, which this repo does not
// install. The repo's Vitest config answers that import with stub components, so the
// real NAV_AREAS loads here unchanged.

import { assert, describe, expect, it } from "vitest";
import type { Command } from "@repo/ui/lib/shell/commands";
import {
  COMMAND_KEYS,
  findConflicts,
  mergeRegistrations,
} from "@repo/ui/lib/command/registry";
import { SIDEBAR_KEYS, TABLE_KEYS } from "@repo/ui/lib/shell/shell-keys";
import { adminCommands } from "./commands";
import { NAV_AREAS } from "./nav";

function build() {
  const calls: string[] = [];
  const commands = adminCommands({
    navigate: (to) => {
      calls.push(`navigate ${to}`);
    },
    signOut: () => {
      calls.push("sign out");
    },
    setTheme: (theme) => {
      calls.push(`theme ${theme}`);
    },
    currentTheme: () => "dark",
  });
  return { commands, calls };
}

const rows = NAV_AREAS.flatMap((area) =>
  area.groups.flatMap((group) => group.items)
);

describe(adminCommands, () => {
  it("gives every NAV_AREAS row a Go to command that opens the row", () => {
    const { commands, calls } = build();
    expect(rows.length > 0).toBeTruthy();
    for (const row of rows) {
      const command = commands.find(
        (candidate) => candidate.title === `Go to ${row.label}`
      );
      assert(command, `no command for the nav row "${row.label}"`);
      expect(command.group).toBe("navigation");
      expect(command.id).toMatch(/^admin\.go-to-[a-z0-9-]+$/);
      expect(command.shortcut).toBe(
        "shortcut" in row ? row.shortcut : undefined
      );
      calls.length = 0;
      command.run({ source: "palette" });
      expect(calls).toStrictEqual([`navigate ${row.to}`]);
    }
  });

  it("binds G O to Overview and G U to Users", () => {
    const { commands } = build();
    const keyOf = (title: string) =>
      commands.find((command) => command.title === title)?.shortcut;
    expect(keyOf("Go to Overview")).toBe("G O");
    expect(keyOf("Go to Users")).toBe("G U");
  });

  it("gives no two commands one shortcut", () => {
    const { commands } = build();
    const shortcuts = commands
      .map((command) => command.shortcut?.toUpperCase())
      .filter((shortcut) => shortcut !== undefined);
    expect(shortcuts.length > 0).toBeTruthy();
    // A failure diff names the repeated shortcut.
    expect(shortcuts).toStrictEqual([...new Set(shortcuts)]);
  });

  it("gives no two commands one id", () => {
    const { commands } = build();
    const ids = commands.map((command) => command.id);
    // A failure diff names the repeated id.
    expect(ids).toStrictEqual([...new Set(ids)]);
  });

  it("adds sign out and the three theme choices", () => {
    const { commands, calls } = build();
    const run = (title: string) => {
      const command = commands.find((candidate) => candidate.title === title);
      assert(command, `no command "${title}"`);
      command.run({ source: "palette" });
      return command;
    };

    expect(run("Sign out").group).toBe("actions");
    for (const label of ["Light", "Dark", "System"]) {
      expect(run(`Theme: ${label}`).group).toBe("preferences");
    }
    expect(calls).toStrictEqual([
      "sign out",
      "theme light",
      "theme dark",
      "theme system",
    ]);
  });

  it("marks the theme in use as the active choice", () => {
    const { commands } = build();
    const active = commands
      .filter((command) => command.active?.() === true)
      .map((command) => command.id);
    expect(active).toStrictEqual(["admin.theme-dark"]);
  });
});

// The shipped key map with every module installed: this app's commands, the `command`
// module's own two, the sidebar toggle and the four table keys, all read from the same
// constants the components bind. Plan 0084 makes this the gate for the default bindings.
describe("the default key map", () => {
  it("has no conflict between any two default bindings", () => {
    const { commands } = build();
    const keys = (
      group: Command["group"],
      entries: readonly { id: Command["id"]; shortcut: string }[]
    ): Command[] =>
      entries.map(({ id, shortcut }) => ({
        id,
        title: id,
        group,
        shortcut,
        run: () => {
          // The conflict check never runs a command.
        },
      }));

    const resolved = mergeRegistrations([
      {
        id: "command",
        scope: "global",
        commands: keys("actions", Object.values(COMMAND_KEYS)),
      },
      {
        id: "shell",
        scope: "global",
        commands: keys("actions", Object.values(SIDEBAR_KEYS)),
      },
      { id: "app", scope: "global", commands },
      {
        id: "table",
        scope: "data-table",
        commands: keys("page", Object.values(TABLE_KEYS)),
      },
    ]);
    expect(resolved).toHaveLength(commands.length + 7);
    const conflicts = findConflicts(resolved).map(
      ({ first, second }) =>
        `${first.command.id} (${first.command.shortcut ?? ""}) / ` +
        `${second.command.id} (${second.command.shortcut ?? ""})`
    );
    expect(conflicts).toStrictEqual([]);
  });
});
