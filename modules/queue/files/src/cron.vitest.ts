// Tests for the five-field cron matcher in ./cron.ts. The file ships as
// `packages/queue/src/cron.test.ts` when testing is on, and `pnpm test:modules` runs it
// in place on Vitest in the saasaloy repo, with imports resolved by project path.

import { describe, expect, it } from "vitest";
import { matchesCron, parseCron } from "./cron";
import { QueueError } from "./provider";

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
    expect(matchesCron("* * * * *", at(2026, 9, 8, 13, 37))).toBeTruthy();
    expect(matchesCron("* * * * *", at(2026, 1, 1, 0, 0))).toBeTruthy();
  });

  it("matches an exact minute and hour", () => {
    expect(matchesCron("30 2 * * *", at(2026, 9, 8, 2, 30))).toBeTruthy();
    expect(matchesCron("30 2 * * *", at(2026, 9, 8, 2, 31))).toBeFalsy();
    expect(matchesCron("30 2 * * *", at(2026, 9, 8, 3, 30))).toBeFalsy();
  });

  it("honours a step", () => {
    // 2026-09-08 is a Tuesday, so the day fields are both wide open here.
    expect(matchesCron("*/15 * * * *", at(2026, 9, 8, 4, 45))).toBeTruthy();
    expect(matchesCron("*/15 * * * *", at(2026, 9, 8, 4, 46))).toBeFalsy();
  });

  it("takes a step wider than the field, the way vixie cron does", () => {
    // `*/60` and `*/24` count values, so each selects only the first one in its field.
    expect(matchesCron("*/60 * * * *", at(2026, 9, 8, 4, 0))).toBeTruthy();
    expect(matchesCron("*/60 * * * *", at(2026, 9, 8, 4, 30))).toBeFalsy();
    expect(matchesCron("0 */24 * * *", at(2026, 9, 8, 0, 0))).toBeTruthy();
    expect(matchesCron("0 */24 * * *", at(2026, 9, 8, 12, 0))).toBeFalsy();
  });

  it("honours a range and a comma list", () => {
    expect(matchesCron("0 9-17 * * *", at(2026, 9, 8, 17, 0))).toBeTruthy();
    expect(matchesCron("0 9-17 * * *", at(2026, 9, 8, 18, 0))).toBeFalsy();
    expect(matchesCron("0 0,12 * * *", at(2026, 9, 8, 12, 0))).toBeTruthy();
    expect(matchesCron("0 0,12 * * *", at(2026, 9, 8, 6, 0))).toBeFalsy();
  });

  it("honours a stepped range", () => {
    expect(matchesCron("0 8-20/6 * * *", at(2026, 9, 8, 14, 0))).toBeTruthy();
    expect(matchesCron("0 8-20/6 * * *", at(2026, 9, 8, 15, 0))).toBeFalsy();
  });

  it("matches a month", () => {
    expect(matchesCron("0 0 1 9 *", at(2026, 9, 1, 0, 0))).toBeTruthy();
    expect(matchesCron("0 0 1 9 *", at(2026, 10, 1, 0, 0))).toBeFalsy();
  });
});

describe("matchesCron — day-of-week", () => {
  it("treats 0 and 7 as the same Sunday", () => {
    const sunday = at(2026, 9, 6, 0, 0);
    expect(sunday.getUTCDay()).toBe(0);
    expect(matchesCron("0 0 * * 0", sunday)).toBeTruthy();
    expect(matchesCron("0 0 * * 7", sunday)).toBeTruthy();
    expect(matchesCron("0 0 * * 1", sunday)).toBeFalsy();
  });

  it("unions the two day fields when both are restricted", () => {
    // `0 0 1 * 1` fires on the 1st AND on every Monday — cron's own rule.
    const first = at(2026, 9, 1, 0, 0); // a Tuesday
    const monday = at(2026, 9, 7, 0, 0);
    const neither = at(2026, 9, 9, 0, 0); // a Wednesday, not the 1st
    expect(matchesCron("0 0 1 * 1", first)).toBeTruthy();
    expect(matchesCron("0 0 1 * 1", monday)).toBeTruthy();
    expect(matchesCron("0 0 1 * 1", neither)).toBeFalsy();
  });

  it("lets the restricted field decide alone when the other is `*`", () => {
    const monday = at(2026, 9, 7, 0, 0);
    expect(matchesCron("0 0 * * 1", monday)).toBeTruthy();
    expect(matchesCron("0 0 8 * *", monday)).toBeFalsy();
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

  it.each(bad)('refuses "%s" (%s)', (expression) => {
    expect(() => parseCron(expression)).toThrow(
      expect.toSatisfy(
        (error: unknown) =>
          error instanceof QueueError && error.code === "invalid_job"
      )
    );
  });
});
