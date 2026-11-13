// Tests for ./contact.ts. This file is NOT in the descriptor's `scaffolds[].files` list,
// so `add app` never copies it into a user's project. It exists for this repo only, the
// same way ./initials.test.ts does. Run it with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contactOf } from "./contact.ts";

describe("contactOf", () => {
  it("names a phone sign-up by its phone", () => {
    assert.equal(contactOf("12025557101@phone.invalid"), "+12025557101");
  });

  it("keeps a real email as it is", () => {
    assert.equal(contactOf("member@example.test"), "member@example.test");
  });

  it("keeps an address on another .invalid host", () => {
    assert.equal(
      contactOf("12025557101@mail.invalid"),
      "12025557101@mail.invalid"
    );
  });

  it("keeps a placeholder with a non-digit local part", () => {
    assert.equal(contactOf("sam@phone.invalid"), "sam@phone.invalid");
  });
});
