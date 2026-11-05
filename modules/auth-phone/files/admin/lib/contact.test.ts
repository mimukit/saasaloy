// Repo-only: the descriptor ships `contact.ts`, never this file. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { contactOf, placeholderPhone } from "./contact.ts";

describe("contactOf", () => {
  it("shows the phone behind a phone sign-up's placeholder email", () => {
    assert.equal(placeholderPhone("12025550101@phone.invalid"), "+12025550101");
    assert.equal(contactOf("12025550101@phone.invalid"), "+12025550101");
  });

  it("keeps a real email", () => {
    assert.equal(placeholderPhone("admin@example.test"), null);
    assert.equal(contactOf("admin@example.test"), "admin@example.test");
  });

  it("keeps an address that only looks like a placeholder", () => {
    for (const email of [
      "12025550101@phone.invalid.example",
      "ada12025550101@phone.invalid",
      "12025550101@phone.example",
      "@phone.invalid",
    ]) {
      assert.equal(contactOf(email), email, email);
    }
  });
});
