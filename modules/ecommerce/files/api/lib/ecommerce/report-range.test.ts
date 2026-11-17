// Tests for the report range. Repo-only: the descriptor does not ship this file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { reportRange } from "./report-range.ts";

// 2026-11-17 01:30 in Dhaka (UTC+6) is still 2026-11-16 in UTC.
const NOW = new Date("2026-11-16T19:30:00.000Z");
const DHAKA = "Asia/Dhaka";

describe("reportRange", () => {
  it("starts today at local midnight in the shop's time zone", () => {
    const range = reportRange({ range: "today" }, NOW, DHAKA);
    assert.equal(range.from.toISOString(), "2026-11-16T18:00:00.000Z");
    assert.equal(range.to.toISOString(), "2026-11-17T18:00:00.000Z");
    assert.deepEqual(range.days, ["2026-11-17"]);
  });

  it("covers seven days ending today", () => {
    const range = reportRange({ range: "7d" }, NOW, DHAKA);
    assert.equal(range.from.toISOString(), "2026-11-10T18:00:00.000Z");
    assert.equal(range.days.length, 7);
    assert.equal(range.days[0], "2026-11-11");
    assert.equal(range.days.at(-1), "2026-11-17");
  });

  it("covers thirty days ending today", () => {
    const range = reportRange({ range: "30d" }, NOW, DHAKA);
    assert.equal(range.days.length, 30);
    assert.equal(range.days[0], "2026-10-19");
  });

  it("takes a custom pair of dates, both included", () => {
    const range = reportRange(
      { from: "2026-11-01", range: "custom", to: "2026-11-03" },
      NOW,
      "UTC"
    );
    assert.equal(range.from.toISOString(), "2026-11-01T00:00:00.000Z");
    assert.equal(range.to.toISOString(), "2026-11-04T00:00:00.000Z");
    assert.deepEqual(range.days, ["2026-11-01", "2026-11-02", "2026-11-03"]);
  });

  it("refuses a custom range that ends before it starts", () => {
    assert.throws(
      () =>
        reportRange(
          { from: "2026-11-03", range: "custom", to: "2026-11-01" },
          NOW,
          DHAKA
        ),
      /before/
    );
  });

  it("refuses a custom range with a date missing", () => {
    assert.throws(
      () => reportRange({ from: "2026-11-03", range: "custom" }, NOW, DHAKA),
      /from and to/
    );
  });

  it("refuses a custom range longer than a year", () => {
    assert.throws(
      () =>
        reportRange(
          { from: "2024-01-01", range: "custom", to: "2026-01-01" },
          NOW,
          DHAKA
        ),
      /366/
    );
  });
});
