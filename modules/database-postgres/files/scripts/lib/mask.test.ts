// Tests for ./mask.ts. Repo-only, like ./state.test.ts: the descriptor does not ship it.
// Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { maskRow, maskValue, piiColumns } from "./mask.ts";

describe("maskValue", () => {
  it("keeps only the domain of an email", () => {
    assert.equal(maskValue("ada@example.com"), "***@example.com");
  });

  it("keeps the first four and last four characters of a phone number", () => {
    assert.equal(maskValue("+15551234567"), "+155****4567");
    assert.equal(maskValue("01729099118"), "0172***9118");
  });

  it("gives any other string its length only", () => {
    assert.equal(maskValue("Ada Lovelace"), "[masked, 12 chars]");
    assert.equal(maskValue("10.0.0.1"), "[masked, 8 chars]");
  });

  it("masks a non-string whole", () => {
    assert.equal(maskValue(42), "[masked]");
    assert.equal(maskValue({ a: 1 }), "[masked]");
    assert.equal(maskValue(true), "[masked]");
  });

  it("keeps null", () => {
    assert.equal(maskValue(null), null);
  });
});

describe("maskRow", () => {
  it("masks the pii columns and leaves the rest", () => {
    assert.deepEqual(
      maskRow(
        { id: "u1", email: "ada@example.com", name: null },
        new Set(["email", "name"])
      ),
      { id: "u1", email: "***@example.com", name: null }
    );
  });
});

describe("piiColumns", () => {
  it("collects every column some table classes pii", () => {
    assert.deepEqual(
      piiColumns([
        { columns: { id: "plain", email: "pii" } },
        { columns: { ip_address: "pii", token: "secret" } },
      ]),
      new Set(["email", "ip_address"])
    );
  });
});
