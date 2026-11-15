import { describe, expect, it } from "vitest";

import {
  dateTimeLimitText,
  dayLimitText,
  dayState,
  exampleDay,
  fillTime,
  formatShownTime,
  gridFocus,
  monthOutside,
  periodKey,
  quickChoiceIds,
  rangeLimits,
  readHour,
  readMinute,
  readTypedDay,
  twoDigits,
  yearChoices,
} from "../../templates/base/packages/ui/src/lib/date-picker";

// The limit texts and the typed field read days in a locale; these pin one.
const GB = "en-GB";

const day = (year: number, month: number, date: number) =>
  new Date(year, month - 1, date);

describe(twoDigits, () => {
  it("pads one digit and keeps two", () => {
    expect(twoDigits(5)).toBe("05");
    expect(twoDigits(0)).toBe("00");
    expect(twoDigits(12)).toBe("12");
  });
});

describe(formatShownTime, () => {
  it("reads a 24-hour time in 12-hour words", () => {
    expect(formatShownTime("17:30")).toBe("5:30 PM");
    expect(formatShownTime("00:05")).toBe("12:05 AM");
    expect(formatShownTime("12:00")).toBe("12:00 PM");
  });

  it("gives an empty string for a bad time", () => {
    expect(formatShownTime("")).toBe("");
    expect(formatShownTime("25:00")).toBe("");
  });
});

describe(dayLimitText, () => {
  const limits = { min: "2026-10-01", max: "2026-11-03" };

  it("names the max day for a later day", () => {
    expect(dayLimitText("2026-11-04", limits, GB)).toBe(
      "Pick a date on or before 3 Nov 2026"
    );
  });

  it("names the min day for an earlier day", () => {
    expect(dayLimitText("2026-09-30", limits, GB)).toBe(
      "Pick a date on or after 1 Oct 2026"
    );
  });

  it("is null inside the limits, on a limit day, and for an empty value", () => {
    expect(dayLimitText("2026-11-03", limits, GB)).toBeNull();
    expect(dayLimitText("2026-10-01", limits, GB)).toBeNull();
    expect(dayLimitText("", limits, GB)).toBeNull();
    expect(dayLimitText("2026-12-25", {}, GB)).toBeNull();
  });

  it("reads a date-time limit by its day", () => {
    expect(
      dayLimitText("2026-11-03", { max: "2026-11-03T09:00" }, GB)
    ).toBeNull();
  });
});

describe(dateTimeLimitText, () => {
  it("names the max time for a later time", () => {
    expect(
      dateTimeLimitText("2026-11-03T18:00", { max: "2026-11-03T17:30" }, GB)
    ).toBe("Pick a time on or before 3 Nov 2026, 5:30 PM");
  });

  it("names the min time for an earlier time", () => {
    expect(
      dateTimeLimitText("2026-11-02T08:00", { min: "2026-11-02T09:05" }, GB)
    ).toBe("Pick a time on or after 2 Nov 2026, 9:05 AM");
  });

  it("is null on the limit minute and for an empty value", () => {
    expect(
      dateTimeLimitText("2026-11-03T17:30", { max: "2026-11-03T17:30" }, GB)
    ).toBeNull();
    expect(dateTimeLimitText("", { max: "2026-11-03T17:30" }, GB)).toBeNull();
  });
});

describe(fillTime, () => {
  it("gives midnight with no limit on the day", () => {
    expect(fillTime("2026-11-05", { min: "2026-11-02T09:05" })).toBe(
      "2026-11-05T00:00"
    );
  });

  it("moves onto min when the day holds min", () => {
    expect(fillTime("2026-11-02", { min: "2026-11-02T09:05" })).toBe(
      "2026-11-02T09:05"
    );
  });

  it("keeps midnight when the day holds max and midnight is allowed", () => {
    expect(fillTime("2026-11-02", { max: "2026-11-02T09:05" })).toBe(
      "2026-11-02T00:00"
    );
  });

  it("gives an empty string for a bad day", () => {
    expect(fillTime("", {})).toBe("");
  });
});

describe("readHour and readMinute", () => {
  it("reads 1 to 12 as an hour", () => {
    expect(readHour("1")).toBe(1);
    expect(readHour("09")).toBe(9);
    expect(readHour("12")).toBe(12);
    expect(readHour("0")).toBeNull();
    expect(readHour("13")).toBeNull();
    expect(readHour("")).toBeNull();
    expect(readHour("1a")).toBeNull();
  });

  it("reads 0 to 59 as a minute", () => {
    expect(readMinute("0")).toBe(0);
    expect(readMinute("59")).toBe(59);
    expect(readMinute("60")).toBeNull();
    expect(readMinute("")).toBeNull();
  });
});

describe(periodKey, () => {
  it("maps a and p in either case", () => {
    expect(periodKey("a")).toBe("AM");
    expect(periodKey("P")).toBe("PM");
    expect(periodKey("1")).toBeNull();
    expect(periodKey("ArrowUp")).toBeNull();
  });
});

describe(rangeLimits, () => {
  it("stops From at To and To at From", () => {
    expect(
      rangeLimits({ from: "2026-10-05", to: "2026-10-20" }, {})
    ).toStrictEqual({
      from: { min: "", max: "2026-10-20" },
      to: { min: "2026-10-05", max: "" },
    });
  });

  it("keeps the tighter of the range limit and the other end", () => {
    expect(
      rangeLimits(
        { from: "2026-09-01", to: "2026-12-01" },
        { min: "2026-10-01", max: "2026-11-03T10:00" }
      )
    ).toStrictEqual({
      from: { min: "2026-10-01", max: "2026-11-03" },
      to: { min: "2026-10-01", max: "2026-11-03" },
    });
  });

  it("uses the range limits alone when an end is empty", () => {
    expect(
      rangeLimits({ from: "", to: "" }, { min: "2026-10-01", max: "" })
    ).toStrictEqual({
      from: { min: "2026-10-01", max: "" },
      to: { min: "2026-10-01", max: "" },
    });
  });
});

describe(gridFocus, () => {
  const october = day(2026, 10, 1);

  it("takes the first preferred day in the month", () => {
    expect(
      gridFocus(october, [null, day(2026, 9, 3), day(2026, 10, 12)], {})
    ).toStrictEqual(day(2026, 10, 12));
  });

  it("skips a preferred day that is disabled", () => {
    expect(
      gridFocus(october, [day(2026, 10, 2)], { min: day(2026, 10, 10) })
    ).toStrictEqual(day(2026, 10, 10));
  });

  it("falls back to the 1st, or the first enabled day", () => {
    expect(gridFocus(october, [], {})).toStrictEqual(day(2026, 10, 1));
    expect(gridFocus(october, [], { min: day(2026, 10, 15) })).toStrictEqual(
      day(2026, 10, 15)
    );
  });

  it("gives the 1st when no day of the month is enabled", () => {
    expect(gridFocus(october, [], { max: day(2026, 9, 1) })).toStrictEqual(
      day(2026, 10, 1)
    );
  });
});

describe(yearChoices, () => {
  const today = day(2026, 11, 2);

  it("lists ten years either side of today without limits", () => {
    const years = yearChoices(today, {}, today);
    expect(years[0]).toBe(2016);
    expect(years.at(-1)).toBe(2036);
    expect(years).toHaveLength(21);
  });

  it("runs from min's year to max's year", () => {
    expect(
      yearChoices(today, { min: day(2025, 3, 1), max: day(2026, 11, 2) }, today)
    ).toStrictEqual([2025, 2026]);
  });

  it("always holds the shown year", () => {
    expect(yearChoices(day(2001, 1, 1), {}, today)[0]).toBe(2001);
  });
});

describe(monthOutside, () => {
  it("is true only when the whole month is past a limit", () => {
    const bounds = { min: day(2026, 10, 31), max: day(2026, 12, 1) };
    expect(monthOutside(day(2026, 9, 1), bounds)).toBeTruthy();
    expect(monthOutside(day(2026, 10, 1), bounds)).toBeFalsy();
    expect(monthOutside(day(2026, 12, 1), bounds)).toBeFalsy();
    expect(monthOutside(day(2027, 1, 1), bounds)).toBeTruthy();
    expect(monthOutside(day(2027, 1, 1), {})).toBeFalsy();
  });
});

describe(dayState, () => {
  it("marks a single day as start, end and selected", () => {
    expect(dayState("2026-10-05", "2026-10-05")).toStrictEqual({
      selected: true,
      start: true,
      end: true,
      middle: false,
    });
    expect(dayState("2026-10-05", "2026-10-06").selected).toBeFalsy();
    expect(dayState("", "2026-10-06").selected).toBeFalsy();
  });

  it("marks the ends and the middle of a range", () => {
    const range = { from: "2026-10-05", to: "2026-10-08" };
    expect(dayState(range, "2026-10-05")).toStrictEqual({
      selected: true,
      start: true,
      end: false,
      middle: false,
    });
    expect(dayState(range, "2026-10-06")).toStrictEqual({
      selected: true,
      start: false,
      end: false,
      middle: true,
    });
    expect(dayState(range, "2026-10-08").end).toBeTruthy();
    expect(dayState(range, "2026-10-09").selected).toBeFalsy();
  });

  it("draws no middle while one end is empty", () => {
    expect(
      dayState({ from: "2026-10-05", to: "" }, "2026-10-06")
    ).toStrictEqual({
      selected: false,
      start: false,
      end: false,
      middle: false,
    });
    expect(
      dayState({ from: "", to: "2026-10-08" }, "2026-10-08").end
    ).toBeTruthy();
  });
});

describe(quickChoiceIds, () => {
  it("reads true as all four, false as none, and a list as itself", () => {
    expect(quickChoiceIds(true)).toStrictEqual([
      "today",
      "last7",
      "last30",
      "thisMonth",
    ]);
    expect(quickChoiceIds(false)).toStrictEqual([]);
    expect(quickChoiceIds(["last7"])).toStrictEqual(["last7"]);
  });
});

describe(exampleDay, () => {
  it("writes the example day as the field shows it in the locale", () => {
    expect(exampleDay(GB)).toBe("5 Oct 2026");
    expect(exampleDay("en")).toBe("Oct 5, 2026");
  });
});

describe(readTypedDay, () => {
  it("treats text that shows the value as unchanged, so a stale error clears", () => {
    expect(readTypedDay(" 5 Oct 2026 ", "2026-10-05", GB)).toStrictEqual({
      kind: "unchanged",
    });
    expect(readTypedDay("", "", GB)).toStrictEqual({ kind: "unchanged" });
  });

  it("reads emptied text as a clear", () => {
    expect(readTypedDay("  ", "2026-10-05", GB)).toStrictEqual({
      kind: "empty",
    });
  });

  it("reads a typed date as its day", () => {
    expect(readTypedDay("6/10/2026", "2026-10-05", GB)).toStrictEqual({
      day: "2026-10-06",
      kind: "day",
    });
  });

  it("reads the locale's own shown text and numeric order", () => {
    expect(readTypedDay("Oct 5, 2026", "2026-10-05", "en")).toStrictEqual({
      kind: "unchanged",
    });
    expect(readTypedDay("Oct 6, 2026", "2026-10-05", "en")).toStrictEqual({
      day: "2026-10-06",
      kind: "day",
    });
    expect(readTypedDay("10/6/2026", "", "en")).toStrictEqual({
      day: "2026-10-06",
      kind: "day",
    });
  });

  it("reads text that does not parse as bad", () => {
    expect(readTypedDay("31 Feb 2026", "", GB)).toStrictEqual({ kind: "bad" });
  });
});
