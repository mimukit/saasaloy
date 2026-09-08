// Tests for the five-field cron matcher in ./cron.ts. This file is NOT in the
// descriptor's `scaffolds[].files` list, so `add queue` never copies it into a user's
// project — it exists for this repo only.
//
// It runs on `node:test`, not on the CLI's vitest instance, for the mechanical reason
// `modules/email/files/src/render.test.ts` documents: vite loads a tsconfig for every
// file it transforms, and this payload's `tsconfig.json` extends `@repo/tsconfig`, which
// resolves only inside a scaffolded project. Run them with `pnpm test:modules`.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { matchesCron, parseCron } from "./cron.ts";
import { QueueError } from "./provider.ts";

/** A UTC instant, written the way a cron field reads. */
const at = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number
) => new Date(Date.UTC(year, month - 1, day, hour, minute));

describe("matchesCron — field forms", () => {
  it("matches every minute on `* * * * *`", () => {
    assert.equal(matchesCron("* * * * *", at(2026, 9, 8, 13, 37)), true);
    assert.equal(matchesCron("* * * * *", at(2026, 1, 1, 0, 0)), true);
  });

  it("matches an exact minute and hour", () => {
    assert.equal(matchesCron("30 2 * * *", at(2026, 9, 8, 2, 30)), true);
    assert.equal(matchesCron("30 2 * * *", at(2026, 9, 8, 2, 31)), false);
    assert.equal(matchesCron("30 2 * * *", at(2026, 9, 8, 3, 30)), false);
  });

  it("honours a step", () => {
    // 2026-09-08 is a Tuesday, so the day fields are both wide open here.
    assert.equal(matchesCron("*/15 * * * *", at(2026, 9, 8, 4, 45)), true);
    assert.equal(matchesCron("*/15 * * * *", at(2026, 9, 8, 4, 46)), false);
  });

  it("honours a range and a comma list", () => {
    assert.equal(matchesCron("0 9-17 * * *", at(2026, 9, 8, 17, 0)), true);
    assert.equal(matchesCron("0 9-17 * * *", at(2026, 9, 8, 18, 0)), false);
    assert.equal(matchesCron("0 0,12 * * *", at(2026, 9, 8, 12, 0)), true);
    assert.equal(matchesCron("0 0,12 * * *", at(2026, 9, 8, 6, 0)), false);
  });

  it("honours a stepped range", () => {
    assert.equal(matchesCron("0 8-20/6 * * *", at(2026, 9, 8, 14, 0)), true);
    assert.equal(matchesCron("0 8-20/6 * * *", at(2026, 9, 8, 15, 0)), false);
  });

  it("matches a month", () => {
    assert.equal(matchesCron("0 0 1 9 *", at(2026, 9, 1, 0, 0)), true);
    assert.equal(matchesCron("0 0 1 9 *", at(2026, 10, 1, 0, 0)), false);
  });
});

describe("matchesCron — day-of-week", () => {
  it("treats 0 and 7 as the same Sunday", () => {
    const sunday = at(2026, 9, 6, 0, 0);
    assert.equal(sunday.getUTCDay(), 0);
    assert.equal(matchesCron("0 0 * * 0", sunday), true);
    assert.equal(matchesCron("0 0 * * 7", sunday), true);
    assert.equal(matchesCron("0 0 * * 1", sunday), false);
  });

  it("unions the two day fields when both are restricted", () => {
    // `0 0 1 * 1` fires on the 1st AND on every Monday — cron's own rule.
    const first = at(2026, 9, 1, 0, 0); // a Tuesday
    const monday = at(2026, 9, 7, 0, 0);
    const neither = at(2026, 9, 9, 0, 0); // a Wednesday, not the 1st
    assert.equal(matchesCron("0 0 1 * 1", first), true);
    assert.equal(matchesCron("0 0 1 * 1", monday), true);
    assert.equal(matchesCron("0 0 1 * 1", neither), false);
  });

  it("lets the restricted field decide alone when the other is `*`", () => {
    const monday = at(2026, 9, 7, 0, 0);
    assert.equal(matchesCron("0 0 * * 1", monday), true);
    assert.equal(matchesCron("0 0 8 * *", monday), false);
  });
});

describe("parseCron — rejection", () => {
  const bad: [string, string][] = [
    ["* * * *", "four fields"],
    ["* * * * * *", "six fields"],
    ["60 * * * *", "minute out of range"],
    ["* 24 * * *", "hour out of range"],
    ["* * 0 * *", "day-of-month below one"],
    ["* * * 13 *", "month out of range"],
    ["0 0 * * MON", "named weekday"],
    ["0 0 ? * *", "the `?` token"],
    ["0 0 L * *", "the `L` token"],
    ["0 0 * * 1#2", "the `#` token"],
    ["*/0 * * * *", "a zero step"],
    ["10-5 * * * *", "a descending range"],
    ["0,,5 * * * *", "an empty term"],
  ];

  for (const [expression, why] of bad) {
    it(`refuses ${why}: "${expression}"`, () => {
      assert.throws(
        () => parseCron(expression),
        (error: unknown) =>
          error instanceof QueueError && error.code === "invalid_job"
      );
    });
  }
});
