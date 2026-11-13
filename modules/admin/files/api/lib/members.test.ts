// Tests for ./members.ts. This file is NOT in the admin descriptor's `files` list, so
// `add admin` never copies it into a project. It exists for this repo only. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { authRefusal, splitMembers } from "./members.ts";

const created = new Date("2026-10-03T09:00:00.000Z");
const updated = new Date("2026-10-20T09:00:00.000Z");

const users = [
  {
    banned: false,
    createdAt: created,
    email: "rafi@acme.test",
    id: "rafi",
    name: "Rafi Hasan",
    role: "admin",
    updatedAt: updated,
  },
  {
    createdAt: created,
    email: "nadia@acme.test",
    id: "nadia",
    name: "Nadia Rahman",
    role: "superadmin",
    updatedAt: updated,
  },
  {
    banned: true,
    createdAt: created,
    email: "imran@acme.test",
    id: "imran",
    name: "Imran Chowdhury",
    role: "admin",
    updatedAt: updated,
  },
  {
    banned: true,
    createdAt: created,
    email: "old@acme.test",
    id: "old",
    name: "Old Hand",
    role: null,
    updatedAt: "2026-09-01T00:00:00.000Z",
  },
];

describe("splitMembers", () => {
  const removedAt = new Date("2026-11-01T14:22:00.000Z");
  const split = splitMembers(
    users,
    {
      added: new Map([["rafi", { at: created, by: "Nadia Rahman" }]]),
      removed: new Map([["imran", { at: removedAt, by: "Nadia Rahman" }]]),
      signedIn: new Map([["nadia", new Date("2026-11-04T09:12:00.000Z")]]),
    },
    "admin"
  );

  it("puts a banned account on the removed side and sorts active by name", () => {
    assert.deepEqual(
      split.members.map((member) => member.id),
      ["nadia", "rafi"]
    );
    assert.deepEqual(
      split.removed.map((member) => member.id),
      ["imran", "old"]
    );
  });

  it("reads the removal date and person from the member.remove row", () => {
    assert.deepEqual(split.removed[0], {
      createdAt: created.toISOString(),
      email: "imran@acme.test",
      id: "imran",
      name: "Imran Chowdhury",
      removedAt: removedAt.toISOString(),
      removedBy: "Nadia Rahman",
      role: "admin",
    });
  });

  it("falls back to updatedAt and no person for a removal with no row", () => {
    assert.equal(split.removed[1]?.removedAt, "2026-09-01T00:00:00.000Z");
    assert.equal(split.removed[1]?.removedBy, null);
    assert.equal(split.removed[1]?.role, "admin");
  });

  it("carries who added a member and their last sign-in, or null", () => {
    const [nadia, rafi] = split.members;
    assert.equal(nadia?.addedBy, null);
    assert.equal(nadia?.lastSignInAt, "2026-11-04T09:12:00.000Z");
    assert.equal(rafi?.addedBy, "Nadia Rahman");
    assert.equal(rafi?.lastSignInAt, null);
  });
});

describe("authRefusal", () => {
  it("reads a Better Auth refusal's status and message", () => {
    assert.deepEqual(
      authRefusal({ body: { message: "Invalid password" }, statusCode: 400 }),
      { message: "Invalid password", status: 400 }
    );
    assert.deepEqual(authRefusal({ statusCode: 403 }), {
      message: "refused",
      status: 403,
    });
  });

  it("answers null for anything else, a 500 included", () => {
    assert.equal(authRefusal(new Error("boom")), null);
    assert.equal(authRefusal({ statusCode: 500 }), null);
    assert.equal(authRefusal(null), null);
    assert.equal(authRefusal("403"), null);
  });
});
