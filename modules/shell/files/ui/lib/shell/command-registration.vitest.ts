// Tests for ./command-registration.ts. The file ships as `command-registration.test.ts`
// beside it when testing is on, and `pnpm test:modules` runs it in place on Vitest in
// the saasaloy repo. The type import from ./commands is erased, so React is never
// loaded.

import { describe, expect, it } from "vitest";
import { commandsKey, delegateToLatest } from "./command-registration";
import type { Command } from "./commands";

function command(overrides: Partial<Command> = {}): Command {
  return {
    id: "shell.toggle-sidebar",
    title: "Toggle sidebar",
    group: "actions",
    shortcut: "Mod+B",
    run: () => {},
    ...overrides,
  };
}

describe(commandsKey, () => {
  it("ignores new run and when closures", () => {
    const first = commandsKey([command({ when: () => true })]);
    const second = commandsKey([command({ run: () => {}, when: () => false })]);
    expect(first).toBe(second);
  });

  const changes: [string, Partial<Command>][] = [
    ["id", { id: "shell.other" }],
    ["title", { title: "Hide sidebar" }],
    ["group", { group: "preferences" }],
    ["shortcut", { shortcut: "Mod+Shift+B" }],
    ["shortcut removed", { shortcut: undefined }],
    ["keywords", { keywords: ["nav"] }],
    ["when", { when: () => true }],
    ["active", { active: () => true }],
  ];

  it.each(changes)("changes with the command's %s", (_part, change) => {
    expect(commandsKey([command(change)])).not.toBe(commandsKey([command()]));
  });

  it("changes with the order and the length of the list", () => {
    const a = command({ id: "shell.a" });
    const b = command({ id: "shell.b" });
    expect(commandsKey([a, b])).not.toBe(commandsKey([b, a]));
    expect(commandsKey([a])).not.toBe(commandsKey([a, b]));
  });
});

describe(delegateToLatest, () => {
  it("reads the latest active closure of the same id", () => {
    let current = false;
    let latest: readonly Command[] = [command({ active: () => false })];
    const [registered] = delegateToLatest(latest, () => latest);
    latest = [command({ active: () => current })];

    expect(registered?.active?.()).toBeFalsy();
    current = true;
    expect(registered?.active?.()).toBeTruthy();
  });

  it("runs the latest closure of the same id", () => {
    const calls: string[] = [];
    let latest: readonly Command[] = [
      command({
        run: () => {
          calls.push("old");
        },
      }),
    ];
    const [registered] = delegateToLatest(latest, () => latest);
    latest = [
      command({
        run: () => {
          calls.push("new");
        },
      }),
    ];

    registered?.run({ source: "shortcut" });
    expect(calls).toStrictEqual(["new"]);
  });

  it("passes the context through", () => {
    const sources: string[] = [];
    const latest = [
      command({
        run: (ctx) => {
          sources.push(ctx.source);
        },
      }),
    ];
    const [registered] = delegateToLatest(latest, () => latest);

    registered?.run({ source: "palette" });
    expect(sources).toStrictEqual(["palette"]);
  });

  it("reads the latest when, and keeps when absent when it was absent", () => {
    let open = false;
    const latest = [command({ when: () => open }), command({ id: "shell.b" })];
    const [gated, plain] = delegateToLatest(latest, () => latest);

    expect(gated?.when?.()).toBeFalsy();
    open = true;
    expect(gated?.when?.()).toBeTruthy();
    expect(plain?.when).toBeUndefined();
  });

  it("does nothing, and reports false, once the id has left the list", () => {
    const calls: string[] = [];
    let latest: readonly Command[] = [
      command({
        when: () => true,
        run: () => {
          calls.push("ran");
        },
      }),
    ];
    const [registered] = delegateToLatest(latest, () => latest);
    latest = [];

    registered?.run({ source: "shortcut" });
    expect(calls).toStrictEqual([]);
    expect(registered?.when?.()).toBeFalsy();
  });

  it("keeps every other field", () => {
    const latest = [command({ keywords: ["nav"] })];
    const [registered] = delegateToLatest(latest, () => latest);
    expect(registered?.id).toBe("shell.toggle-sidebar");
    expect(registered?.title).toBe("Toggle sidebar");
    expect(registered?.group).toBe("actions");
    expect(registered?.shortcut).toBe("Mod+B");
    expect(registered?.keywords).toStrictEqual(["nav"]);
  });
});
