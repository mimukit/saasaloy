import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { devPort } from "./dev-port.ts";

const FILE = "apps/web/.env.local";

describe("devPort", () => {
  it("takes the pinned port when DEV_PORT is unset or blank", () => {
    assert.equal(devPort(undefined, 3000, FILE), 3000);
    assert.equal(devPort("", 3000, FILE), 3000);
  });

  it("takes a set port", () => {
    assert.equal(devPort("12345", 3000, FILE), 12_345);
  });

  it("takes both ends of the port range", () => {
    assert.equal(devPort("1", 3000, FILE), 1);
    assert.equal(devPort("65535", 3000, FILE), 65_535);
  });

  for (const value of ["0", "65536", "-80", "3000.5", "abc"]) {
    it(`refuses ${value}`, () => {
      assert.throws(() => devPort(value, 3000, FILE), /must be an integer/);
    });
  }

  it("names the value and the file in the error", () => {
    assert.throws(
      () => devPort("abc", 3000, FILE),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('"abc"') &&
        error.message.includes(FILE)
    );
  });
});
