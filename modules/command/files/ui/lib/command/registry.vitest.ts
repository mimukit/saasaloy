// Tests for ./registry.ts. It ships as `registry.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { assert, describe, expect, it } from "vitest";
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
} from "./registry";

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

describe(parseShortcut, () => {
  it("reads one chord with the Mod modifier", () => {
    expect(parseShortcut("Mod+K")).toStrictEqual([
      { key: "K", mod: true, ctrl: false, alt: false, shift: false },
    ]);
  });

  it("reads a space-separated sequence as its steps", () => {
    const steps = parseShortcut("G U");
    expect(steps).toHaveLength(2);
    expect(steps.map((step) => step.key)).toStrictEqual(["G", "U"]);
  });

  it("keeps a typed character and names a named key canonically", () => {
    expect(parseShortcut("?")[0]?.key).toBe("?");
    expect(parseShortcut("esc")[0]?.key).toBe("Escape");
    expect(parseShortcut("Mod+Backspace")[0]?.key).toBe("Backspace");
  });

  it("throws on an empty shortcut and on an unknown modifier", () => {
    expect(() => parseShortcut("  ")).toThrow(/cannot be empty/);
    expect(() => parseShortcut("Hyper+K")).toThrow(/unknown modifier "Hyper"/);
  });
});

describe(findConflicts, () => {
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
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("same-chord");
    expect(() => resolveBindings(resolved, devOptions())).toThrow(
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
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.kind).toBe("sequence-prefix");
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
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.second.command.id).toBe("admin.bold");
  });

  it("lets two sequences share a first step when neither is a prefix", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("admin.go-to-overview", "navigation", { shortcut: "G O" }),
        command("admin.go-to-users", "navigation", { shortcut: "G U" }),
      ]),
    ]);
    expect(findConflicts(resolved)).toStrictEqual([]);
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
    expect(findConflicts(resolved)).toHaveLength(1);
  });

  it("counts a command whose `when` is false, since it still owns its key", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [
        command("admin.one", "actions", { shortcut: "C" }),
        command("admin.two", "actions", { shortcut: "C", when: () => false }),
      ]),
    ]);
    expect(findConflicts(resolved)).toHaveLength(1);
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
    expect(kept.map((entry) => entry.command.id)).toStrictEqual([
      "admin.first",
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0] ?? "").toMatch(/"admin\.first".*"admin\.second"/);
  });
});

describe(paletteGroups, () => {
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
    expect(groups.map((group) => group.label)).toStrictEqual([
      "Users",
      "Navigation",
      "Actions",
      "Preferences",
    ]);
  });

  it("labels the page group by its registration", () => {
    const [first] = paletteGroups(mergeRegistrations(registrations));
    expect(first?.label).toBe("Users");
    expect(first?.items.map((entry) => entry.command.id)).toStrictEqual([
      "admin.show-admins",
    ]);
  });

  it("leaves the data-table scope out of the palette but lists it in the sheet", () => {
    const resolved = mergeRegistrations(registrations);
    const ids = paletteGroups(resolved).flatMap((group) =>
      group.items.map((entry) => entry.command.id)
    );
    expect(ids).not.toContain("shell.table-next-row");
    const sections = shortcutSections(resolved);
    expect(sections.map((section) => section.label)).toStrictEqual([
      "Navigation",
      "Data table",
    ]);
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
    expect(paletteGroups(resolved)).toStrictEqual([]);
    selected = true;
    expect(paletteGroups(resolved)[0]?.items.length).toBe(1);
  });

  it("leaves out a hidden id and an empty group", () => {
    const resolved = mergeRegistrations([
      registration("root", "global", [
        command("command.open-palette", "actions", { shortcut: "Mod+K" }),
      ]),
    ]);
    expect(
      paletteGroups(resolved, new Set(["command.open-palette"]))
    ).toStrictEqual([]);
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
    expect(actions?.items.map((entry) => entry.command.id)).toStrictEqual([
      "shell.toggle-sidebar",
      "command.show-shortcuts",
      "admin.sign-out",
    ]);
  });

  it("keeps declaration order in the sheet's General section", () => {
    const general = shortcutSections(resolved).find(
      (section) => section.key === "general"
    );
    expect(general?.items.map((entry) => entry.command.id)).toStrictEqual([
      "command.open-palette",
      "command.show-shortcuts",
      "shell.toggle-sidebar",
    ]);
  });

  it("keeps declaration order among one owner's rows", () => {
    const [navigation] = paletteGroups(
      mergeRegistrations([
        registration("app", "global", [
          command("admin.go-to-overview", "navigation"),
          command("admin.go-to-users", "navigation"),
        ]),
      ])
    );
    expect(navigation?.items.map((entry) => entry.command.id)).toStrictEqual([
      "admin.go-to-overview",
      "admin.go-to-users",
    ]);
  });
});

describe(pageExample, () => {
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
    expect(pageExample(navigation(["Go to Overview", "Go to Users"]))).toBe(
      "users"
    );
  });

  it("names the only Navigation row when there is one", () => {
    expect(pageExample(navigation(["Go to Home"]))).toBe("home");
  });

  it("names no page when there is no Navigation row", () => {
    expect(pageExample([])).toBeUndefined();
  });
});

describe(mergeRegistrations, () => {
  const repeated = () => [
    registration("a", "global", [command("admin.one", "actions")]),
    registration("b", "global", [
      command("admin.one", "preferences"),
      command("admin.two", "actions"),
    ]),
  ];

  it("throws on a repeated id in development, naming the id", () => {
    expect(() => mergeRegistrations(repeated(), devOptions())).toThrow(
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
    expect(
      resolved.map((entry) => `${entry.command.id}:${entry.command.group}`)
    ).toStrictEqual(["admin.one:actions", "admin.two:actions"]);
    expect(messages).toHaveLength(1);
    expect(messages[0] ?? "").toMatch(/"admin\.one"/);
  });

  it("keeps the first command of a repeated id", () => {
    const resolved = mergeRegistrations([
      registration("a", "global", [command("admin.one", "actions")]),
      registration("b", "global", [
        command("admin.one", "preferences"),
        command("admin.two", "actions"),
      ]),
    ]);
    expect(
      resolved.map((entry) => `${entry.command.id}:${entry.command.group}`)
    ).toStrictEqual(["admin.one:actions", "admin.two:actions"]);
  });
});

describe(placeRegistration, () => {
  it("replaces a held id in its place and appends a new one", () => {
    const first = registration("a", "global", []);
    const second = registration("b", "route", []);
    const again = registration("a", "global", [
      command("admin.one", "actions"),
    ]);
    const list = placeRegistration(placeRegistration([], first), second);
    expect(placeRegistration(list, again)).toStrictEqual([again, second]);
  });

  it("leaves a replaced entry alone when its old unregister runs", () => {
    const first = registration("a", "global", []);
    const again = registration("a", "global", [
      command("admin.one", "actions"),
    ]);
    const list = placeRegistration([first], again);
    expect(dropRegistration(list, first)).toStrictEqual([again]);
    expect(dropRegistration(list, again)).toStrictEqual([]);
  });
});

describe(chordKeycaps, () => {
  it("draws Mod as ⌘ on macOS and Ctrl elsewhere", () => {
    const [chord] = parseShortcut("Mod+K");
    assert(chord, "Mod+K parsed to no chord");
    expect(chordKeycaps(chord, "mac")).toStrictEqual(["⌘", "K"]);
    expect(chordKeycaps(chord, "windows")).toStrictEqual(["Ctrl", "K"]);
  });
});
