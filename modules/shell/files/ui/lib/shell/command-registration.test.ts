// Tests for ./command-registration.ts. This file is NOT in the descriptor's `files` list,
// so `add shell` never copies it into a user's project; it exists for this repo only, the
// same way ./nav-counts.test.ts does. Run them with `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess. The type import from ./commands.ts is erased,
// so React is never loaded.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { commandsKey, delegateToLatest } from "./command-registration.ts";
import type { Command } from "./commands.ts";

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

describe("commandsKey", () => {
  it("ignores new run and when closures", () => {
    const first = commandsKey([command({ when: () => true })]);
    const second = commandsKey([command({ run: () => {}, when: () => false })]);
    assert.equal(first, second);
  });

  it("changes with each part of a command's shape", () => {
    const base = commandsKey([command()]);
    const changes: Partial<Command>[] = [
      { id: "shell.other" },
      { title: "Hide sidebar" },
      { group: "preferences" },
      { shortcut: "Mod+Shift+B" },
      { shortcut: undefined },
      { keywords: ["nav"] },
      { when: () => true },
    ];
    for (const change of changes) {
      assert.notEqual(
        commandsKey([command(change)]),
        base,
        String(Object.keys(change))
      );
    }
  });

  it("changes with the order and the length of the list", () => {
    const a = command({ id: "shell.a" });
    const b = command({ id: "shell.b" });
    assert.notEqual(commandsKey([a, b]), commandsKey([b, a]));
    assert.notEqual(commandsKey([a]), commandsKey([a, b]));
  });
});

describe("delegateToLatest", () => {
  it("runs the latest closure of the same id", () => {
    const calls: string[] = [];
    let latest: readonly Command[] = [
      command({ run: () => calls.push("old") }),
    ];
    const [registered] = delegateToLatest(latest, () => latest);
    latest = [command({ run: () => calls.push("new") })];

    registered?.run({ source: "shortcut" });
    assert.deepEqual(calls, ["new"]);
  });

  it("passes the context through", () => {
    const sources: string[] = [];
    const latest = [command({ run: (ctx) => sources.push(ctx.source) })];
    const [registered] = delegateToLatest(latest, () => latest);

    registered?.run({ source: "palette" });
    assert.deepEqual(sources, ["palette"]);
  });

  it("reads the latest when, and keeps when absent when it was absent", () => {
    let open = false;
    const latest = [command({ when: () => open }), command({ id: "shell.b" })];
    const [gated, plain] = delegateToLatest(latest, () => latest);

    assert.equal(gated?.when?.(), false);
    open = true;
    assert.equal(gated?.when?.(), true);
    assert.equal(plain?.when, undefined);
  });

  it("does nothing, and reports false, once the id has left the list", () => {
    const calls: string[] = [];
    let latest: readonly Command[] = [
      command({ when: () => true, run: () => calls.push("ran") }),
    ];
    const [registered] = delegateToLatest(latest, () => latest);
    latest = [];

    registered?.run({ source: "shortcut" });
    assert.deepEqual(calls, []);
    assert.equal(registered?.when?.(), false);
  });

  it("keeps every other field", () => {
    const latest = [command({ keywords: ["nav"] })];
    const [registered] = delegateToLatest(latest, () => latest);
    assert.equal(registered?.id, "shell.toggle-sidebar");
    assert.equal(registered?.title, "Toggle sidebar");
    assert.equal(registered?.group, "actions");
    assert.equal(registered?.shortcut, "Mod+B");
    assert.deepEqual(registered?.keywords, ["nav"]);
  });
});
