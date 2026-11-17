// Tests for `scripts/smoke.ts` (#187), the helper behind `modules/<name>/smoke.ts`. The
// HTTP checks themselves run against a live playground through `pnpm play:smoke`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Smoke, pick, readCookies } from "./smoke.ts";

describe("readCookies", () => {
  it("keeps the name and value and drops the attributes", () => {
    const jar = readCookies([
      "client.session_token=abc.def; Path=/; HttpOnly; SameSite=Lax",
      "other=1=2; Path=/",
    ]);
    assert.deepEqual(
      [...jar],
      [
        ["client.session_token", "abc.def"],
        ["other", "1=2"],
      ]
    );
  });
});

describe("pick", () => {
  it("follows a dotted path and stops at a missing key", () => {
    assert.equal(
      pick({ user: { role: "superadmin" } }, "user.role"),
      "superadmin"
    );
    assert.equal(pick({ user: null }, "user.role"), undefined);
    assert.equal(pick("text", "user"), undefined);
  });
});

describe("Smoke", () => {
  it("counts every check and prints one line each", () => {
    const lines: string[] = [];
    const log = console.log;
    console.log = (line: string) => {
      lines.push(line);
    };
    try {
      const smoke = new Smoke("http://localhost:4000");
      smoke.equal("status", 200, 200);
      smoke.equal("role", "superadmin", "user");
      smoke.check("rows", true);
      assert.equal(smoke.passed, 2);
      assert.equal(smoke.failed, 1);
    } finally {
      console.log = log;
    }
    assert.deepEqual(lines, [
      "PASS  status",
      "FAIL  role -- expected [superadmin] got [user]",
      "PASS  rows",
    ]);
  });
});
