// Tests for ./format.ts. This file is NOT in the descriptor's `files` list, so
// `add notification` never copies it into a user's project; it exists for this repo only,
// the same way @repo/ui/lib/shell/nav-counts.test.ts does. Run them with
// `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { badgeText, relativeTime } from "./format.ts";

describe("badgeText", () => {
  it("shows no badge at 0 or for an unknown count", () => {
    assert.equal(badgeText(0), null);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- an unknown count is the case under test.
    assert.equal(badgeText(undefined), null);
    assert.equal(badgeText(Number.NaN), null);
  });

  it("shows the count up to 99 and 99+ above it", () => {
    assert.equal(badgeText(3), "3");
    assert.equal(badgeText(99), "99");
    assert.equal(badgeText(100), "99+");
  });
});

describe("relativeTime", () => {
  const now = new Date("2026-11-04T12:00:00Z");
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);

  it("rounds down to the largest whole unit", () => {
    assert.equal(relativeTime(ago(4 * 60 + 30), now), "4 minutes ago");
    assert.equal(relativeTime(ago(90 * 60), now), "1 hour ago");
    assert.equal(relativeTime(ago(3 * 24 * 60 * 60), now), "3 days ago");
  });

  it("says yesterday and last week for one day and one week", () => {
    assert.equal(relativeTime(ago(30 * 60 * 60), now), "yesterday");
    assert.equal(relativeTime(ago(8 * 24 * 60 * 60), now), "last week");
  });

  it("reads now for under a minute and for a future time", () => {
    assert.equal(relativeTime(ago(20), now), "now");
    assert.equal(relativeTime(ago(-120), now), "now");
  });

  it("reads an ISO string and returns nothing for a bad one", () => {
    assert.equal(relativeTime("2026-11-04T11:00:00.000Z", now), "1 hour ago");
    assert.equal(relativeTime("not a date", now), "");
  });
});
