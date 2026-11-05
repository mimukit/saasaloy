import { afterEach, describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  addYears,
  checkDateTime,
  checkDay,
  clampDay,
  daysInMonth,
  firstDayOfWeek,
  formatDateTime,
  formatDay,
  formatShown,
  isDisabled,
  joinDateTime,
  monthGrid,
  monthNames,
  moveFocus,
  nextRange,
  numericDayOrder,
  parseDateTime,
  parseDay,
  parseTyped,
  quickRange,
  sameDay,
  splitDateTime,
  stepHour,
  stepMinute,
  to12Hour,
  to24Hour,
  weekdayNames,
} from "../../templates/base/packages/ui/src/lib/calendar";
import type { Weekday } from "../../templates/base/packages/ui/src/lib/calendar";

// Local days, so the tests read the same in every time zone.
const day = (year: number, month: number, date: number) =>
  new Date(year, month - 1, date);
const key = (date: Date | null) => (date ? formatDay(date) : null);

// Most tests pin a locale that writes day, month, year, and a Saturday week start, so the
// grid and the Home and End keys run on a week that starts on neither Sunday nor Monday.
const GB = "en-GB";
const SATURDAY: Weekday = 6;

describe("parseDay and formatDay", () => {
  it("round-trips a day in local time", () => {
    expect(formatDay(day(2026, 10, 5))).toBe("2026-10-05");
    expect(parseDay("2026-10-05")).toStrictEqual(day(2026, 10, 5));
  });

  it.each(["2026-02-29", "2026-13-01", "2026-04-31", "5 Oct 2026", ""])(
    "rejects %j",
    (value) => {
      expect(parseDay(value)).toBeNull();
    }
  );

  it("reads 29 Feb in a leap year only", () => {
    expect(key(parseDay("2024-02-29"))).toBe("2024-02-29");
    expect(parseDay("2025-02-29")).toBeNull();
    expect(parseDay("2100-02-29")).toBeNull();
    expect(key(parseDay("2000-02-29"))).toBe("2000-02-29");
  });
});

describe("parseDateTime and formatDateTime", () => {
  it("round-trips a local date-time to the minute", () => {
    const time = new Date(2026, 9, 31, 9, 5, 42);
    expect(formatDateTime(time)).toBe("2026-10-31T09:05");
    expect(parseDateTime("2026-10-31T09:05")).toStrictEqual(
      new Date(2026, 9, 31, 9, 5)
    );
  });

  it("drops the seconds a datetime-local field may add", () => {
    expect(parseDateTime("2026-10-31T09:05:00")).toStrictEqual(
      new Date(2026, 9, 31, 9, 5)
    );
  });

  it.each([
    "2026-10-31T24:00",
    "2026-10-31T09:60",
    "2026-02-30T09:00",
    "2026-10-31",
  ])("rejects %j", (value) => {
    expect(parseDateTime(value)).toBeNull();
  });

  it("splits and joins a date-time value", () => {
    expect(splitDateTime("2026-10-31T09:05")).toStrictEqual({
      day: "2026-10-31",
      time: "09:05",
    });
    expect(splitDateTime("")).toStrictEqual({ day: "", time: "" });
    expect(joinDateTime("2026-10-31", "09:05")).toBe("2026-10-31T09:05");
    expect(joinDateTime("2026-10-31", "")).toBe("2026-10-31T00:00");
    expect(joinDateTime("", "09:05")).toBe("");
  });
});

describe("parseTyped and formatShown", () => {
  it.each([
    "5 Oct 2026",
    "5 october 2026",
    "05 OCT 2026",
    "5 Oct, 2026",
    "2026-10-05",
    "5/10/2026",
    "05/10/2026",
    "5.10.2026",
    "5-10-2026",
    "  5 Oct 2026 ",
    "Oct 5 2026",
    "Oct 5, 2026",
    "2026/10/05",
  ])("reads %j as 5 Oct 2026", (text) => {
    expect(key(parseTyped(text, GB))).toBe("2026-10-05");
  });

  it.each([
    "31/02/2026",
    "29/02/2025",
    "31 Apr 2026",
    "5 Oc 2026",
    "5 Foo 2026",
    "5/13/2026",
    "5/10/26",
    "Oct 32 2026",
    "2026-10-32",
    "",
    "tomorrow",
  ])("rejects %j", (text) => {
    expect(parseTyped(text, GB)).toBeNull();
  });

  it("writes a day as 5 Oct 2026 in en-GB", () => {
    expect(formatShown(day(2026, 10, 5), GB)).toBe("5 Oct 2026");
    expect(formatShown("2026-10-05", GB)).toBe("5 Oct 2026");
    expect(formatShown("", GB)).toBe("");
  });

  it("writes a day in the locale's order, with Latin digits", () => {
    expect(formatShown("2026-10-05", "en")).toBe("Oct 5, 2026");
    expect(formatShown("2026-10-05", "ar-EG")).toMatch(/^5 .+ 2026$/u);
  });

  it("reads a numeric day in the locale's order", () => {
    expect(numericDayOrder(GB)).toBe("dmy");
    expect(numericDayOrder("en")).toBe("mdy");
    expect(numericDayOrder("ja")).toBe("ymd");
    expect(key(parseTyped("10/5/2026", "en"))).toBe("2026-10-05");
    expect(key(parseTyped("10/5/2026", GB))).toBe("2026-05-10");
    expect(parseTyped("13/10/2026", "en")).toBeNull();
  });

  it("reads the locale's month words and the English ones", () => {
    expect(key(parseTyped("5. Okt. 2026", "de"))).toBe("2026-10-05");
    expect(key(parseTyped("5 févr. 2026", "fr"))).toBe("2026-02-05");
    expect(key(parseTyped("5 Oct 2026", "de"))).toBe("2026-10-05");
  });

  it.each([GB, "en", "de", "fr", "ar-EG"])(
    "reads back what it writes for every month in %s",
    (locale) => {
      for (let month = 1; month <= 12; month += 1) {
        const shown = formatShown(day(2026, month, 28), locale);
        expect(key(parseTyped(shown, locale))).toBe(
          formatDay(day(2026, month, 28))
        );
      }
    }
  );
});

describe(firstDayOfWeek, () => {
  // The last two tests take `getWeekInfo` off the prototype, as an older runtime ships it,
  // and put it back after.
  const proto = Intl.Locale.prototype as {
    getWeekInfo?: unknown;
    weekInfo?: unknown;
  };
  const saved = proto.getWeekInfo;
  afterEach(() => {
    proto.getWeekInfo = saved;
    delete proto.weekInfo;
  });

  it.each([
    ["en-US", 0],
    ["en-GB", 1],
    ["de", 1],
    ["ar-EG", 6],
  ])("starts the week in %s on day %i", (locale, weekday) => {
    expect(firstDayOfWeek(locale)).toBe(weekday);
  });

  it("reads the older weekInfo getter when getWeekInfo is missing", () => {
    delete proto.getWeekInfo;
    Object.defineProperty(proto, "weekInfo", {
      configurable: true,
      get: () => ({ firstDay: 6 }),
    });
    expect(firstDayOfWeek("en-US")).toBe(6);
  });

  it("starts on Monday when the runtime gives no week info", () => {
    delete proto.getWeekInfo;
    expect(firstDayOfWeek("en-US")).toBe(1);
  });
});

describe("the names", () => {
  it("names the weekdays from the week start", () => {
    expect(weekdayNames(GB, SATURDAY)).toStrictEqual([
      "Sat",
      "Sun",
      "Mon",
      "Tue",
      "Wed",
      "Thu",
      "Fri",
    ]);
    expect(weekdayNames(GB, SATURDAY, "long")[0]).toBe("Saturday");
    expect(weekdayNames(GB, 1)[0]).toBe("Mon");
    expect(weekdayNames("en", 0, "long")).toHaveLength(7);
    expect(weekdayNames("en", 0, "long")[0]).toBe("Sunday");
    expect(weekdayNames("en", 0, "long")[6]).toBe("Saturday");
  });

  it("names the months from January", () => {
    expect(monthNames(GB)).toHaveLength(12);
    expect(monthNames(GB)[0]).toBe("January");
    expect(monthNames(GB)[11]).toBe("December");
    expect(monthNames("de")[9]).toBe("Oktober");
  });
});

describe(monthGrid, () => {
  // The first of each month here falls on Saturday, Sunday … Friday in turn.
  it.each([
    [2026, 8, 0],
    [2026, 2, 1],
    [2026, 6, 2],
    [2026, 9, 3],
    [2026, 4, 4],
    [2026, 1, 5],
    [2026, 5, 6],
  ])("puts the first of %i-%i after %i outside days", (year, month, before) => {
    const grid = monthGrid(day(year, month, 15), SATURDAY);
    expect(grid).toHaveLength(6);
    expect(grid.every((week) => week.length === 7)).toBeTruthy();
    const cells = grid.flat();
    expect(cells[0]?.date.getDay()).toBe(6);
    expect(cells.findIndex((cell) => !cell.outside)).toBe(before);
    expect(cells[before]?.key).toBe(formatDay(day(year, month, 1)));
    expect(cells.filter((cell) => !cell.outside)).toHaveLength(
      daysInMonth(day(year, month, 1))
    );
  });

  it("marks the days of the months before and after as outside", () => {
    const cells = monthGrid(day(2026, 10, 1), SATURDAY).flat();
    expect(cells[0]).toMatchObject({ key: "2026-09-26", outside: true });
    expect(cells[6]).toMatchObject({ key: "2026-10-02", outside: false });
    expect(cells[41]).toMatchObject({ key: "2026-11-06", outside: true });
  });

  it("holds 29 days in February of a leap year", () => {
    const inside = (year: number) =>
      monthGrid(day(year, 2, 1), SATURDAY)
        .flat()
        .filter((cell) => !cell.outside).length;
    expect(inside(2024)).toBe(29);
    expect(inside(2025)).toBe(28);
    expect(inside(2100)).toBe(28);
  });

  it("crosses a year end", () => {
    const cells = monthGrid(day(2026, 12, 1), SATURDAY).flat();
    expect(cells.at(-1)?.key).toBe("2027-01-08");
    expect(cells.at(-1)?.outside).toBeTruthy();
  });

  it("starts each week on the weekday it is given", () => {
    for (const start of [0, 1, 6] as const) {
      const grid = monthGrid(day(2026, 10, 15), start);
      expect(
        grid.every((week) => week[0]?.date.getDay() === start)
      ).toBeTruthy();
    }
    // 1 Oct 2026 is a Thursday: three outside days from Monday, four from Sunday.
    expect(monthGrid(day(2026, 10, 1), 1)[0]?.[0]?.key).toBe("2026-09-28");
    expect(monthGrid(day(2026, 10, 1), 0)[0]?.[0]?.key).toBe("2026-09-27");
  });
});

describe("day math", () => {
  it("moves across a month end and a year end", () => {
    expect(key(addDays(day(2026, 1, 31), 1))).toBe("2026-02-01");
    expect(key(addDays(day(2026, 12, 31), 1))).toBe("2027-01-01");
    expect(key(addDays(day(2027, 1, 1), -1))).toBe("2026-12-31");
  });

  it("clamps the day when a month is shorter", () => {
    expect(key(addMonths(day(2026, 1, 31), 1))).toBe("2026-02-28");
    expect(key(addMonths(day(2024, 1, 31), 1))).toBe("2024-02-29");
    expect(key(addMonths(day(2026, 3, 31), -1))).toBe("2026-02-28");
    expect(key(addMonths(day(2026, 12, 15), 1))).toBe("2027-01-15");
    expect(key(addYears(day(2024, 2, 29), 1))).toBe("2025-02-28");
  });

  it("compares days, not times", () => {
    expect(
      sameDay(new Date(2026, 9, 5, 23, 59), day(2026, 10, 5))
    ).toBeTruthy();
    expect(sameDay(day(2026, 10, 5), day(2026, 10, 6))).toBeFalsy();
  });
});

describe("min and max", () => {
  const bounds = { min: day(2026, 10, 5), max: day(2026, 10, 20) };

  it("allows the limit days and disables the days past them", () => {
    expect(isDisabled(day(2026, 10, 5), bounds)).toBeFalsy();
    expect(isDisabled(day(2026, 10, 20), bounds)).toBeFalsy();
    expect(isDisabled(day(2026, 10, 4), bounds)).toBeTruthy();
    expect(isDisabled(day(2026, 10, 21), bounds)).toBeTruthy();
    expect(isDisabled(day(1999, 1, 1), {})).toBeFalsy();
  });

  it("reads only the day of a limit with a time", () => {
    const max = new Date(2026, 9, 20, 9, 30);
    expect(isDisabled(new Date(2026, 9, 20, 23, 0), { max })).toBeFalsy();
  });

  it("clamps a day onto the nearer limit", () => {
    expect(key(clampDay(day(2026, 10, 1), bounds))).toBe("2026-10-05");
    expect(key(clampDay(day(2026, 10, 30), bounds))).toBe("2026-10-20");
    expect(key(clampDay(day(2026, 10, 10), bounds))).toBe("2026-10-10");
  });

  it("checks a day value against day limits", () => {
    const limits = { min: "2026-10-05", max: "2026-10-20" };
    expect(checkDay("2026-10-05", limits)).toBe("ok");
    expect(checkDay("2026-10-20", limits)).toBe("ok");
    expect(checkDay("2026-10-04", limits)).toBe("early");
    expect(checkDay("2026-10-21", limits)).toBe("late");
    expect(checkDay("5 Oct 2026", limits)).toBe("invalid");
    expect(checkDay("2026-10-21")).toBe("ok");
  });

  it("checks a date-time value to the minute", () => {
    const limits = { min: "2026-10-05T09:30", max: "2026-10-20T17:00" };
    expect(checkDateTime("2026-10-05T09:30", limits)).toBe("ok");
    expect(checkDateTime("2026-10-05T09:29", limits)).toBe("early");
    expect(checkDateTime("2026-10-20T17:00", limits)).toBe("ok");
    expect(checkDateTime("2026-10-20T17:01", limits)).toBe("late");
    expect(checkDateTime("2026-10-20", limits)).toBe("invalid");
    expect(checkDateTime("2026-10-20T17:00:59", limits)).toBe("ok");
  });
});

describe(moveFocus, () => {
  const from = day(2026, 10, 14); // a Wednesday

  it.each([
    ["ArrowLeft", false, "2026-10-13"],
    ["ArrowRight", false, "2026-10-15"],
    ["ArrowUp", false, "2026-10-07"],
    ["ArrowDown", false, "2026-10-21"],
    ["PageUp", false, "2026-09-14"],
    ["PageDown", false, "2026-11-14"],
    ["PageUp", true, "2025-10-14"],
    ["PageDown", true, "2027-10-14"],
    ["Home", false, "2026-10-10"],
    ["End", false, "2026-10-16"],
  ])("moves %s (shift %s) to %s", (focusKey, shift, expected) => {
    expect(
      key(
        moveFocus(from, focusKey, { weekStartsOn: SATURDAY, shiftKey: shift })
      )
    ).toBe(expected);
  });

  it("keeps Home and End on a Saturday and a Friday", () => {
    const move = { weekStartsOn: SATURDAY };
    expect(key(moveFocus(day(2026, 10, 10), "Home", move))).toBe("2026-10-10");
    expect(key(moveFocus(day(2026, 10, 16), "End", move))).toBe("2026-10-16");
  });

  it("moves Home and End to the given week start", () => {
    const monday = { weekStartsOn: 1 } as const;
    expect(key(moveFocus(from, "Home", monday))).toBe("2026-10-12");
    expect(key(moveFocus(from, "End", monday))).toBe("2026-10-18");
    const sunday = { weekStartsOn: 0 } as const;
    expect(key(moveFocus(from, "Home", sunday))).toBe("2026-10-11");
    expect(key(moveFocus(from, "End", sunday))).toBe("2026-10-17");
  });

  it("clamps the day of the month on a month move", () => {
    const move = { weekStartsOn: SATURDAY };
    expect(key(moveFocus(day(2026, 3, 31), "PageUp", move))).toBe("2026-02-28");
    expect(
      key(moveFocus(day(2024, 2, 29), "PageDown", { ...move, shiftKey: true }))
    ).toBe("2025-02-28");
  });

  it("stops at min and max", () => {
    const bounds = { min: day(2026, 10, 12), max: day(2026, 10, 16) };
    const move = { weekStartsOn: SATURDAY, bounds };
    expect(key(moveFocus(from, "ArrowUp", move))).toBe("2026-10-12");
    expect(key(moveFocus(from, "PageDown", move))).toBe("2026-10-16");
  });

  it("ignores a key the grid does not handle", () => {
    expect(moveFocus(from, "Enter", { weekStartsOn: SATURDAY })).toBeNull();
  });
});

describe(nextRange, () => {
  it("starts a range on the first pick", () => {
    expect(nextRange({ from: "", to: "" }, "2026-10-05")).toStrictEqual({
      from: "2026-10-05",
      to: "",
    });
  });

  it("ends the range on the second pick", () => {
    expect(
      nextRange({ from: "2026-10-05", to: "" }, "2026-10-09")
    ).toStrictEqual({
      from: "2026-10-05",
      to: "2026-10-09",
    });
    expect(
      nextRange({ from: "2026-10-05", to: "" }, "2026-10-05")
    ).toStrictEqual({
      from: "2026-10-05",
      to: "2026-10-05",
    });
  });

  it("swaps when the second pick is before From", () => {
    expect(
      nextRange({ from: "2026-10-05", to: "" }, "2026-10-01")
    ).toStrictEqual({
      from: "2026-10-01",
      to: "2026-10-05",
    });
  });

  it("starts again on a third pick", () => {
    expect(
      nextRange({ from: "2026-10-05", to: "2026-10-09" }, "2026-10-20")
    ).toStrictEqual({ from: "2026-10-20", to: "" });
  });

  it("fills From against a typed To, swapping a later pick", () => {
    expect(
      nextRange({ from: "", to: "2026-10-09" }, "2026-10-01")
    ).toStrictEqual({
      from: "2026-10-01",
      to: "2026-10-09",
    });
    expect(
      nextRange({ from: "", to: "2026-10-09" }, "2026-10-20")
    ).toStrictEqual({
      from: "2026-10-09",
      to: "2026-10-20",
    });
  });
});

describe(quickRange, () => {
  const today = new Date(2026, 2, 4, 15, 30);

  it.each([
    ["today", "2026-03-04"],
    ["last7", "2026-02-26"],
    ["last30", "2026-02-03"],
    ["thisMonth", "2026-03-01"],
  ] as const)("starts %s on %s and ends today", (id, from) => {
    expect(quickRange(id, today)).toStrictEqual({ from, to: "2026-03-04" });
  });
});

describe("12-hour time", () => {
  it.each([
    ["00:00", { hour: 12, minute: 0, period: "AM" }],
    ["00:30", { hour: 12, minute: 30, period: "AM" }],
    ["09:05", { hour: 9, minute: 5, period: "AM" }],
    ["12:00", { hour: 12, minute: 0, period: "PM" }],
    ["13:45", { hour: 1, minute: 45, period: "PM" }],
    ["23:59", { hour: 11, minute: 59, period: "PM" }],
  ] as const)("reads %s both ways", (hhmm, time) => {
    expect(to12Hour(hhmm)).toStrictEqual(time);
    expect(to24Hour(time)).toBe(hhmm);
  });

  it.each(["24:00", "12:60", "9:05", ""])("rejects %j", (hhmm) => {
    expect(to12Hour(hhmm)).toBeNull();
  });

  it("wraps the hour inside 1 to 12", () => {
    expect(stepHour(12, 1)).toBe(1);
    expect(stepHour(1, -1)).toBe(12);
    expect(stepHour(11, 1)).toBe(12);
    expect(stepHour(5, 1)).toBe(6);
    expect(stepHour(5, -1)).toBe(4);
  });

  it("wraps the minute inside 0 to 59", () => {
    expect(stepMinute(59, 1)).toBe(0);
    expect(stepMinute(0, -1)).toBe(59);
    expect(stepMinute(30, 1)).toBe(31);
  });
});
