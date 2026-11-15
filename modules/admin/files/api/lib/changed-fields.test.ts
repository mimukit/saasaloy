// Tests for ./changed-fields.ts. This file is NOT in the admin descriptor's `files` list,
// so `add admin` never copies it into a project. It exists for this repo only.
//
// It runs on `node:test` because vite has to load a tsconfig for every file it transforms,
// and this payload's tsconfig resolves only inside a scaffolded project. Run it with
// `pnpm test:modules`. The import carries `.ts` because Node's type stripping resolves the
// real file; shipped payload code keeps the extensionless style.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { changedFields, flatten, refusedKey } from "./changed-fields.ts";

describe("changedFields", () => {
  it("keeps only the fields that changed, each side its own value", () => {
    assert.deepEqual(
      changedFields(
        { assignedTo: null, status: "open", subject: "Box" },
        { assignedTo: null, status: "resolved", subject: "Box" }
      ),
      { after: { status: "resolved" }, before: { status: "open" } }
    );
  });

  it("keys a nested field by its dot path", () => {
    assert.deepEqual(
      changedFields(
        { rates: { us: { fx: 122, perKg: 1800 } }, validHours: 72 },
        { rates: { us: { fx: 122, perKg: 1900 } }, validHours: 72 }
      ),
      {
        after: { "rates.us.perKg": 1900 },
        before: { "rates.us.perKg": 1800 },
      }
    );
  });

  it("stores a create as after only and a delete as before only", () => {
    assert.deepEqual(changedFields(null, { name: "Rafi" }), {
      after: { name: "Rafi" },
      before: null,
    });
    assert.deepEqual(changedFields({ name: "Rafi" }, null), {
      after: null,
      before: { name: "Rafi" },
    });
  });

  it("keeps a field on the side that has it when the other side drops it", () => {
    assert.deepEqual(
      changedFields({ note: "x", status: "a" }, { status: "a" }),
      {
        after: null,
        before: { note: "x" },
      }
    );
  });

  it("writes a Date as its ISO string and compares arrays whole", () => {
    const at = new Date("2026-10-28T09:00:00Z");
    assert.deepEqual(
      changedFields({ at: null, tags: ["a"] }, { at, tags: ["a", "b"] }),
      {
        after: { at: "2026-10-28T09:00:00.000Z", tags: ["a", "b"] },
        before: { at: null, tags: ["a"] },
      }
    );
  });

  it("answers null on both sides when nothing changed", () => {
    assert.deepEqual(changedFields({ a: 1 }, { a: 1 }), {
      after: null,
      before: null,
    });
  });
});

describe("flatten", () => {
  it("skips an undefined field", () => {
    assert.deepEqual(flatten({ a: undefined, b: 2 }), { b: 2 });
  });

  it("keeps an empty object as a leaf", () => {
    assert.deepEqual(flatten({ a: {}, b: { c: 1 } }), { a: {}, "b.c": 1 });
  });
});

describe("refusedKey", () => {
  it("refuses a password under any path", () => {
    assert.equal(refusedKey({ name: "Rafi", password: "x" }), "password");
    assert.equal(
      refusedKey({ "account.newPassword": "x" }),
      "account.newPassword"
    );
    assert.equal(refusedKey({ "password.hash": "x" }), "password.hash");
  });

  it("passes fields that name no password", () => {
    assert.equal(refusedKey({ name: "Rafi" }), null);
    assert.equal(refusedKey(null), null);
  });
});
