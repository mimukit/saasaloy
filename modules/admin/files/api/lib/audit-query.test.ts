// Tests for ./audit-query.ts. This file is NOT in the admin descriptor's `files` list, so
// `add admin` never copies it into a project. It exists for this repo only. Run it with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { areaCounts, decodeCursor, encodeCursor } from "./audit-query.ts";

describe("encodeCursor and decodeCursor", () => {
  it("round-trip a cursor", () => {
    const cursor = {
      createdAt: new Date("2026-11-04T10:41:07.123Z"),
      id: "a1b2",
    };
    const text = encodeCursor(cursor);
    assert.equal(text, "2026-11-04T10:41:07.123Z~a1b2");
    assert.deepEqual(decodeCursor(text), cursor);
  });

  it("refuse anything encodeCursor did not write", () => {
    for (const text of [
      "",
      "nonsense",
      "2026~",
      "1~abc",
      "2026-11-04T10:41:07Z~abc",
      "2026-11-04T10:41:07.123Z~",
      "2026-11-04T10:41:07.123Z~a~b",
      "2026-13-45T10:41:07.123Z~abc",
    ]) {
      assert.equal(decodeCursor(text), null, text);
    }
  });
});

describe("areaCounts", () => {
  const areaOf = (action: string) =>
    action.startsWith("member.")
      ? "members"
      : action.startsWith("payment.")
        ? "payments"
        : null;

  it("sums actions by area and into all", () => {
    assert.deepEqual(
      areaCounts(
        { "member.add": 2, "member.remove": 1, "payment.refund.create": 4 },
        ["members", "payments", "flags"],
        areaOf
      ),
      { all: 7, flags: 0, members: 3, payments: 4 }
    );
  });

  it("counts an action no module names under all only", () => {
    assert.deepEqual(areaCounts({ "widget.polish": 5 }, ["members"], areaOf), {
      all: 5,
      members: 0,
    });
  });
});
