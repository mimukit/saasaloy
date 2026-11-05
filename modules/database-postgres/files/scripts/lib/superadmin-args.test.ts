// Tests for ./superadmin-args.ts. This file is NOT in the descriptor's `scaffolds[].files`
// list, so `add database-postgres` never copies it into a user's project: it exists for
// this repo only. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultName, parseSuperadminArgs } from "./superadmin-args.ts";

describe("parseSuperadminArgs", () => {
  it("reads the email, trimmed and lowercased", () => {
    assert.deepEqual(parseSuperadminArgs(["--email", " Ada@Example.COM "]), {
      email: "ada@example.com",
      keepPassword: false,
    });
  });

  it("reads --name and --keep-password, in any order", () => {
    assert.deepEqual(
      parseSuperadminArgs([
        "--keep-password",
        "--name",
        " Ada Lovelace ",
        "--email",
        "ada@example.com",
      ]),
      { email: "ada@example.com", name: "Ada Lovelace", keepPassword: true }
    );
  });

  it("skips the -- that pnpm forwards", () => {
    assert.equal(
      parseSuperadminArgs(["--", "--email", "ada@example.com"]).email,
      "ada@example.com"
    );
  });

  it("requires --email", () => {
    assert.throws(() => parseSuperadminArgs([]), /--email is required/);
    assert.throws(
      () => parseSuperadminArgs(["--name", "Ada"]),
      /--email is required/
    );
  });

  it("refuses a flag with no value", () => {
    assert.throws(
      () => parseSuperadminArgs(["--email"]),
      /--email needs a value/
    );
    assert.throws(
      () => parseSuperadminArgs(["--email", "--keep-password"]),
      /--email needs a value/
    );
  });

  it("refuses an unknown argument", () => {
    assert.throws(
      () => parseSuperadminArgs(["--email", "ada@example.com", "--force"]),
      /Unknown argument --force/
    );
  });

  it("refuses something that is not an address", () => {
    assert.throws(
      () => parseSuperadminArgs(["--email", "ada"]),
      /is not an email address/
    );
  });

  it("refuses a seed or placeholder address", () => {
    assert.throws(
      () => parseSuperadminArgs(["--email", "superadmin@example.test"]),
      /seed or placeholder/
    );
    assert.throws(
      () => parseSuperadminArgs(["--email", "x@nowhere.invalid"]),
      /seed or placeholder/
    );
  });
});

describe("defaultName", () => {
  it("is the email's local part", () => {
    assert.equal(defaultName("ada@example.com"), "ada");
  });
});
