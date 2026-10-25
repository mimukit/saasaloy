// Tests for ./extensions.ts. The file ships as `extensions.test.ts` beside it when
// testing is on, and `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { defineShellExtensions } from "./extensions";
import type { ShellExtension } from "./extensions";

function extension(id: string): ShellExtension {
  return { id, Provider: ({ children }) => children };
}

describe(defineShellExtensions, () => {
  it("keeps the entries in order", () => {
    const list = defineShellExtensions({
      extensions: [extension("command"), extension("help")],
    });
    expect(list.map((entry) => entry.id)).toStrictEqual(["command", "help"]);
  });

  it("accepts the empty list an app ships", () => {
    expect(defineShellExtensions({ extensions: [] })).toStrictEqual([]);
  });

  it("returns a frozen copy", () => {
    const input = [extension("command")];
    const list = defineShellExtensions({ extensions: input });
    expect(Object.isFrozen(list)).toBeTruthy();
    input.push(extension("late"));
    expect(list).toHaveLength(1);
  });

  it("throws on two entries with one id", () => {
    expect(() =>
      defineShellExtensions({
        extensions: [extension("command"), extension("command")],
      })
    ).toThrow(/two extensions share the id "command"/);
  });
});
