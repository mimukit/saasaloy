// Tests for the rule `requireUser` throws on (`./user-caller-rules.ts`). Not in the
// descriptor, so no project receives it. It runs on `node:test` under `pnpm
// test:modules`, for the reason `./server.test.ts` gives: the rule file imports nothing,
// and the gate beside it pulls `hono` and the auth instance.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { demandDenial } from "./user-caller-rules.ts";
import type { ScopedPrincipal } from "./user-caller-rules.ts";

const key = (statements: ScopedPrincipal["statements"]): ScopedPrincipal => ({
  id: "key_1",
  kind: "apiKey",
  statements,
});

describe("demandDenial", () => {
  it("passes a signed-in person on any demand that names a pair", () => {
    assert.equal(demandDenial({ kind: "user" }, { notes: ["delete"] }), null);
  });

  it("passes a key that holds every demanded action", () => {
    const holder = key({ notes: ["read", "write"] });
    assert.equal(demandDenial(holder, { notes: ["read"] }), null);
    assert.equal(demandDenial(holder, { notes: ["read", "write"] }), null);
  });

  it("refuses a key on the first pair it lacks, with the shared text", () => {
    assert.deepEqual(
      demandDenial(key({ notes: ["read"] }), { notes: ["read", "delete"] }),
      { message: "permission required: notes:delete", status: 403 }
    );
    assert.deepEqual(demandDenial(key({}), { files: ["read"] }), {
      message: "permission required: files:read",
      status: 403,
    });
  });

  it("never reads an inherited property as a held scope", () => {
    assert.deepEqual(demandDenial(key({}), { toString: ["read"] }), {
      message: "permission required: toString:read",
      status: 403,
    });
  });

  it("refuses an empty demand for every caller", () => {
    const empty = { message: "permission required", status: 403 };
    assert.deepEqual(demandDenial({ kind: "user" }, {}), empty);
    assert.deepEqual(demandDenial(key({ a: ["b"] }), { a: [] }), empty);
    assert.deepEqual(demandDenial({ kind: "user" }, { a: undefined }), empty);
  });
});

describe("the gate in ./user-caller.ts", () => {
  const source = readFileSync(
    fileURLToPath(new URL("user-caller.ts", import.meta.url)),
    "utf-8"
  );

  it("ships an empty resolver table in the shape the plugin-array patch reads", () => {
    assert.match(
      source,
      /export const userResolvers = defineUserResolvers\(\{ resolvers: \[\] \}\);/
    );
  });

  it("throws what demandDenial hands back, after any resolver or the session", () => {
    assert.match(source, /demandDenial\(caller\.principal, demand\)/);
    assert.match(source, /: await sessionCaller\(c\)/);
  });
});
