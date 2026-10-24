// Tests for ./registry.ts. This file is NOT in the descriptor's `files` list, so
// `add command` never copies it into a user's project; it exists for this repo only.
//
// It runs on `node:test` under `pnpm test:modules`. The import carries the explicit `.ts`
// extension because Node's type stripping resolves the real file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
  Command,
  CommandGroup,
  CommandRegistration,
  CommandScope,
} from "@repo/ui/lib/shell/commands";
import {
  chordKeycaps,
  dropRegistration,
  findConflicts,
  mergeRegistrations,
  pageExample,
  paletteGroups,
  parseShortcut,
  placeRegistration,
  resolveBindings,
  shortcutSections,
} from "./registry.ts";

function command(
  id: `${string}.${string}`,
  group: CommandGroup,
  extra: Partial<Command> = {}
): Command {
  const run = (): void => {
    // A test command does nothing when it runs.
  };
  return { id, title: id, group, run, ...extra };
}

function registration(
  id: string,
  scope: CommandScope,
  commands: Command[],
  label?: string
): CommandRegistration {
  return { id, scope, commands, label };
}

const devOptions = () => ({
  mode: "development" as const,
  warn: (): void => {
    // Development mode throws before it would warn.
  },
  warned: new Set<string>(),
});

describe("parseShortcut", () => {
  it("reads one chord with the Mod modifier", () => {
    assert.deepEqual(parseShortcut("Mod+K"), [
      { key: "K", mod: true, ctrl: false, alt: false, shift: false },
    ]);
  });

  it("reads a space-separated sequence as its steps", () => {
    const steps = parseShortcut("G U");
    assert.equal(steps.length, 2);
    assert.deepEqual(
      steps.map((step) => step.key),
      ["G", "U"]
    );
  });

  it("keeps a typed character and names a named key canonically", () => {
    assert.equal(parseShortcut("?")[0]?.key, "?");
    assert.equal(parseShortcut("esc")[0]?.key, "Escape");
    assert.equal(parseShortcut("Mod+Backspace")[0]?.key, "Backspace");
  });

  it("throws on an empty shortcut and on an unknown modifier", () => {
    assert.throws(() => parseShortcut("  "), /cannot be empty/);
    assert.throws(() => parseShortcut("Hyper+K"), /unknown modifier "Hyper"/);
  });
});

describe("findConflicts", () => {
  it("finds two commands on the same chord and names both ids", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("shell.toggle-sidebar", "actions", { shortcut: "Mod+B" }),
      ]),
      registration("b", "global", [
        command("admin.bold", "actions", { shortcut: "mod+b" }),
      ]),
    ]);
    const conflicts = findConflicts(resolved);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.kind, "same-chord");
    assert.throws(
      () => resolveBindings(resolved, devOptions()),
      /"shell\.toggle-sidebar".*"admin\.bold"/
    );
  });

  it("finds a binding that is a prefix of another's sequence", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("admin.go-to-users", "navigation", { shortcut: "G U" }),
        command("admin.grid", "actions", { shortcut: "G" }),
      ]),
    ]);
    const conflicts = findConflicts(resolved);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.kind, "sequence-prefix");
  });

  it("counts Ctrl as Mod, since Mod is Control on Windows and Linux", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("shell.toggle-sidebar", "actions", { shortcut: "Mod+B" }),
        command("admin.bold", "actions", { shortcut: "Ctrl+B" }),
        command("admin.other", "actions", { shortcut: "Alt+B" }),
      ]),
    ]);
    const conflicts = findConflicts(resolved);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0]?.second.command.id, "admin.bold");
  });

  it("lets two sequences share a first step when neither is a prefix", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("admin.go-to-overview", "navigation", { shortcut: "G O" }),
        command("admin.go-to-users", "navigation", { shortcut: "G U" }),
      ]),
    ]);
    assert.deepEqual(findConflicts(resolved), []);
  });

  it("finds a conflict across scopes, since every mounted scope overlaps", () => {
    const resolved = mergeRegistrations([
      registration("app", "global", [
        command("admin.close", "actions", { shortcut: "Escape" }),
      ]),
      registration("table", "data-table", [
        command("shell.table-clear-highlight", "page", { shortcut: "Esc" }),
      ]),
    ]);
    assert.equal(findConflicts(resolved).length, 1);
  });

  it("counts a command whose `when` is false, since it still owns its key", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("admin.one", "actions", { shortcut: "C" }),
        command("admin.two", "actions", { shortcut: "C", when: () => false }),
      ]),
    ]);
    assert.equal(findConflicts(resolved).length, 1);
  });

  it("in production warns once and keeps the first binding", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("admin.first", "actions", { shortcut: "C" }),
        command("admin.second", "actions", { shortcut: "C" }),
      ]),
    ]);
    const messages: string[] = [];
    const options = {
      mode: "production" as const,
      warn: (message: string) => {
        messages.push(message);
      },
      warned: new Set<string>(),
    };
    const kept = resolveBindings(resolved, options);
    resolveBindings(resolved, options);
    assert.deepEqual(
      kept.map((entry) => entry.command.id),
      ["admin.first"]
    );
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /"admin\.first".*"admin\.second"/);
  });
});

describe("paletteGroups", () => {
  const registrations = [
    registration("app", "global", [
      command("admin.theme-dark", "preferences"),
      command("admin.sign-out", "actions"),
      command("admin.go-to-users", "navigation", { shortcut: "G U" }),
    ]),
    registration(
      "users",
      "route",
      [command("admin.show-admins", "page")],
      "Users"
    ),
    registration("table", "data-table", [
      command("shell.table-next-row", "page", { shortcut: "J" }),
    ]),
  ];

  it("orders the groups page, navigation, actions, preferences", () => {
    const groups = paletteGroups(mergeRegistrations(registrations));
    assert.deepEqual(
      groups.map((group) => group.label),
      ["Users", "Navigation", "Actions", "Preferences"]
    );
  });

  it("labels the page group by its registration", () => {
    const [first] = paletteGroups(mergeRegistrations(registrations));
    assert.equal(first?.label, "Users");
    assert.deepEqual(
      first?.items.map((entry) => entry.command.id),
      ["admin.show-admins"]
    );
  });

  it("leaves the data-table scope out of the palette but lists it in the sheet", () => {
    const resolved = mergeRegistrations(registrations);
    const ids = paletteGroups(resolved).flatMap((group) =>
      group.items.map((entry) => entry.command.id)
    );
    assert.equal(ids.includes("shell.table-next-row"), false);
    const sections = shortcutSections(resolved);
    assert.deepEqual(
      sections.map((section) => section.label),
      ["Navigation", "Data table"]
    );
  });

  it("hides a command while its `when` is false, and shows it again after", () => {
    let selected = false;
    const resolved = mergeRegistrations([
      registration(
        "users",
        "route",
        [
          command("admin.close-user-details", "page", {
            when: () => selected,
          }),
        ],
        "Users"
      ),
    ]);
    assert.deepEqual(paletteGroups(resolved), []);
    selected = true;
    assert.equal(paletteGroups(resolved)[0]?.items.length, 1);
  });

  it("leaves out a hidden id and an empty group", () => {
    const resolved = mergeRegistrations([
      registration("root", "global", [
        command("command.open-palette", "actions", { shortcut: "Mod+K" }),
      ]),
    ]);
    assert.deepEqual(
      paletteGroups(resolved, new Set(["command.open-palette"])),
      []
    );
  });
});

describe("palette row order", () => {
  // The order the provider merges them in: its own commands, then the app's, then the
  // sidebar's, which is how the admin shell mounts.
  const resolved = mergeRegistrations([
    registration("command", "global", [
      command("command.open-palette", "actions", { shortcut: "Mod+K" }),
      command("command.show-shortcuts", "actions", { shortcut: "?" }),
    ]),
    registration("app", "global", [
      command("admin.go-to-overview", "navigation", { shortcut: "G O" }),
      command("admin.sign-out", "actions"),
      command("admin.theme-light", "preferences"),
    ]),
    registration("sidebar", "global", [
      command("shell.toggle-sidebar", "actions", { shortcut: "Mod+B" }),
    ]),
  ]);

  it("lists Actions as the shell's, then the module's, then the app's", () => {
    const actions = paletteGroups(
      resolved,
      new Set(["command.open-palette"])
    ).find((group) => group.key === "actions");
    assert.deepEqual(
      actions?.items.map((entry) => entry.command.id),
      ["shell.toggle-sidebar", "command.show-shortcuts", "admin.sign-out"]
    );
  });

  it("keeps declaration order in the sheet's General section", () => {
    const general = shortcutSections(resolved).find(
      (section) => section.key === "general"
    );
    assert.deepEqual(
      general?.items.map((entry) => entry.command.id),
      ["command.open-palette", "command.show-shortcuts", "shell.toggle-sidebar"]
    );
  });

  it("keeps declaration order among one owner's rows", () => {
    const navigation = paletteGroups(
      mergeRegistrations([
        registration("app", "global", [
          command("admin.go-to-overview", "navigation"),
          command("admin.go-to-users", "navigation"),
        ]),
      ])
    )[0];
    assert.deepEqual(
      navigation?.items.map((entry) => entry.command.id),
      ["admin.go-to-overview", "admin.go-to-users"]
    );
  });
});

describe("pageExample", () => {
  const navigation = (titles: string[]) =>
    paletteGroups(
      mergeRegistrations([
        registration(
          "app",
          "global",
          titles.map((title, index) =>
            command(`app.go-${index}`, "navigation", { title })
          )
        ),
      ])
    );

  it("names the second Navigation row, past the root page", () => {
    assert.equal(
      pageExample(navigation(["Go to Overview", "Go to Users"])),
      "users"
    );
  });

  it("names the only Navigation row when there is one", () => {
    assert.equal(pageExample(navigation(["Go to Home"])), "home");
  });

  it("names no page when there is no Navigation row", () => {
    assert.equal(pageExample([]), undefined);
  });
});

describe("mergeRegistrations", () => {
  const repeated = () => [
    registration("a", "global", [command("admin.one", "actions")]),
    registration("b", "global", [
      command("admin.one", "preferences"),
      command("admin.two", "actions"),
    ]),
  ];

  it("throws on a repeated id in development, naming the id", () => {
    assert.throws(
      () => mergeRegistrations(repeated(), devOptions()),
      /"admin\.one" is declared twice/
    );
  });

  it("warns once on a repeated id in production and keeps the first", () => {
    const messages: string[] = [];
    const options = {
      mode: "production" as const,
      warn: (message: string) => {
        messages.push(message);
      },
      warned: new Set<string>(),
    };
    mergeRegistrations(repeated(), options);
    const resolved = mergeRegistrations(repeated(), options);
    assert.deepEqual(
      resolved.map((entry) => `${entry.command.id}:${entry.command.group}`),
      ["admin.one:actions", "admin.two:actions"]
    );
    assert.equal(messages.length, 1);
    assert.match(messages[0] ?? "", /"admin\.one"/);
  });

  it("keeps the first command of a repeated id", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [command("admin.one", "actions")]),
      registration("b", "global", [
        command("admin.one", "preferences"),
        command("admin.two", "actions"),
      ]),
    ]);
    assert.deepEqual(
      resolved.map((entry) => `${entry.command.id}:${entry.command.group}`),
      ["admin.one:actions", "admin.two:actions"]
    );
  });
});

describe("placeRegistration", () => {
  it("replaces a held id in its place and appends a new one", () => {
    const first = registration("a", "global", []);
    const second = registration("b", "route", []);
    const again = registration("a", "global", [
      command("admin.one", "actions"),
    ]);
    const list = placeRegistration(placeRegistration([], first), second);
    assert.deepEqual(placeRegistration(list, again), [again, second]);
  });

  it("leaves a replaced entry alone when its old unregister runs", () => {
    const first = registration("a", "global", []);
    const again = registration("a", "global", [
      command("admin.one", "actions"),
    ]);
    const list = placeRegistration([first], again);
    assert.deepEqual(dropRegistration(list, first), [again]);
    assert.deepEqual(dropRegistration(list, again), []);
  });
});

describe("chordKeycaps", () => {
  it("draws Mod as ⌘ on macOS and Ctrl elsewhere", () => {
    const [chord] = parseShortcut("Mod+K");
    assert.ok(chord);
    assert.deepEqual(chordKeycaps(chord, "mac"), ["⌘", "K"]);
    assert.deepEqual(chordKeycaps(chord, "windows"), ["Ctrl", "K"]);
  });
});
