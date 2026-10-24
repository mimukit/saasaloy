// Tests for ./extensions.ts. This file is NOT in the descriptor's `files` list, so
// `add shell` never copies it into a user's project; it exists for this repo only, the
// same way ./nav-counts.test.ts does. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineShellExtensions } from "./extensions.ts";
import type { ShellExtension } from "./extensions.ts";

function extension(id: string): ShellExtension {
  return { id, Provider: ({ children }) => children };
}

describe("defineShellExtensions", () => {
  it("keeps the entries in order", () => {
    const list = defineShellExtensions({
      extensions: [extension("command"), extension("help")],
    });
    assert.deepEqual(
      list.map((entry) => entry.id),
      ["command", "help"]
    );
  });

  it("accepts the empty list an app ships", () => {
    assert.deepEqual(defineShellExtensions({ extensions: [] }), []);
  });

  it("returns a frozen copy", () => {
    const input = [extension("command")];
    const list = defineShellExtensions({ extensions: input });
    assert.ok(Object.isFrozen(list));
    input.push(extension("late"));
    assert.equal(list.length, 1);
  });

  it("throws on two entries with one id", () => {
    assert.throws(
      () =>
        defineShellExtensions({
          extensions: [extension("command"), extension("command")],
        }),
      /two extensions share the id "command"/
    );
  });
});
