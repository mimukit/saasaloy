// The pure parts of the date pickers (../components/date-picker.tsx, the shell set's
// components/shell/date-picker.tsx when the shell module is installed, and their
// calendars): the error text a field shows, the time fields' reading and stepping, the
// default time of a picked day, the tab stop, the year list and the day marks of the
// calendar, and the quick choices. Everything here is plain data in and out, so a Node
// test runs it without a DOM.

import { datePicker as copy } from "@repo/ui/content/date-picker";
import {
  addDays,
  checkDateTime,
  checkDay,
  compareDays,
  daysInMonth,
  formatDateTime,
  formatDay,
  formatShown,
  isDisabled,
  makeDay,
  parseDay,
  parseLimit,
  parseTyped,
  QUICK_RANGE_IDS,
  sameMonth,
  splitDateTime,
  to12Hour,
} from "@repo/ui/lib/calendar";
import type { DayBounds, DayRange, QuickRangeId } from "@repo/ui/lib/calendar";
import { interpolate } from "@repo/ui/lib/interpolate";

/** A field's `min` and `max` props: a `YYYY-MM-DD` day or a `YYYY-MM-DDTHH:mm` time. */
export interface FieldLimits {
  min?: string;
  max?: string;
}

/** The day the field hint and the bad-text error show as an example. */
const EXAMPLE_DAY = "2026-10-05";

/**
 * The example day as a field shows it in `locale`: `5 Oct 2026` in `en-GB`, `Oct 5, 2026`
 * in `en`. It fills the `{example}` token of the copy's `placeholder` and `errors.invalid`.
 */
export function exampleDay(locale: string): string {
  return formatShown(EXAMPLE_DAY, locale);
}

/** A number as two digits: 5 → `05`. */
export function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

/** `HH:mm` (24-hour) as the time fields read it aloud: `17:30` → `5:30 PM`. */
export function formatShownTime(hhmm: string): string {
  const time = to12Hour(hhmm);
  if (!time) {
    return "";
  }
  const period = time.period === "AM" ? copy.am : copy.pm;
  return `${time.hour}:${twoDigits(time.minute)} ${period}`;
}

/**
 * A limit string as a person reads it in `locale`: a day as `3 Nov 2026` (`en-GB`), a time
 * with its time.
 */
function shownLimit(limit: string, withTime: boolean, locale: string): string {
  const date = parseLimit(limit);
  if (!date) {
    return "";
  }
  if (!withTime) {
    return formatShown(date, locale);
  }
  const { day, time } = splitDateTime(formatDateTime(date));
  return interpolate(copy.dayAndTime, {
    day: formatShown(day, locale),
    time: formatShownTime(time),
  });
}

/**
 * The error a day field shows for a value outside its limits, with the limit day in
 * `locale`, or null. An empty or bad value gives null: the field reports a bad typed text
 * itself.
 */
export function dayLimitText(
  value: string,
  limits: FieldLimits,
  locale: string
): string | null {
  const { min = "", max = "" } = limits;
  const check = checkDay(value, { min, max });
  if (check === "early") {
    return interpolate(copy.errors.early, {
      day: shownLimit(min, false, locale),
    });
  }
  if (check === "late") {
    return interpolate(copy.errors.late, {
      day: shownLimit(max, false, locale),
    });
  }
  return null;
}

/**
 * The error a date-and-time field shows for a value outside its limits, with the limit in
 * `locale`, or null.
 */
export function dateTimeLimitText(
  value: string,
  limits: FieldLimits,
  locale: string
): string | null {
  const { min = "", max = "" } = limits;
  const check = checkDateTime(value, { min, max });
  if (check === "early") {
    return interpolate(copy.errors.timeEarly, {
      when: shownLimit(min, true, locale),
    });
  }
  if (check === "late") {
    return interpolate(copy.errors.timeLate, {
      when: shownLimit(max, true, locale),
    });
  }
  return null;
}

/**
 * The value of a day picked before any time was set: midnight, moved onto `min` or `max`
 * when that day holds the limit, so a "not before now" field gets now and not midnight.
 */
export function fillTime(day: string, limits: FieldLimits): string {
  if (!parseDay(day)) {
    return "";
  }
  const midnight = `${day}T00:00`;
  const check = checkDateTime(midnight, limits);
  const min = parseLimit(limits.min ?? "");
  const max = parseLimit(limits.max ?? "");
  if (check === "early" && min && formatDateTime(min).startsWith(day)) {
    return formatDateTime(min);
  }
  if (check === "late" && max && formatDateTime(max).startsWith(day)) {
    return formatDateTime(max);
  }
  return midnight;
}

/** The hour field's text as 1 to 12, or null. */
export function readHour(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) {
    return null;
  }
  const hour = Number(text);
  return hour >= 1 && hour <= 12 ? hour : null;
}

/** The minute field's text as 0 to 59, or null. */
export function readMinute(text: string): number | null {
  if (!/^\d{1,2}$/.test(text)) {
    return null;
  }
  const minute = Number(text);
  return minute <= 59 ? minute : null;
}

/** What a typed character means in a time field: a digit, a period letter, or nothing. */
export function periodKey(key: string): "AM" | "PM" | null {
  const lower = key.toLowerCase();
  if (lower === "a") {
    return "AM";
  }
  if (lower === "p") {
    return "PM";
  }
  return null;
}

/**
 * The limits each end of a range field checks against: From may not pass To, and To may
 * not come before From, inside the range's own `min` and `max`.
 */
export function rangeLimits(
  range: DayRange,
  { min = "", max = "" }: FieldLimits
): { from: FieldLimits; to: FieldLimits } {
  const minDay = min.slice(0, 10);
  const maxDay = max.slice(0, 10);
  const fromMax =
    parseDay(range.to) && (maxDay === "" || range.to < maxDay)
      ? range.to
      : maxDay;
  const toMin =
    parseDay(range.from) && (minDay === "" || range.from > minDay)
      ? range.from
      : minDay;
  return {
    from: { min: minDay, max: fromMax },
    to: { min: toMin, max: maxDay },
  };
}

/**
 * The day that holds the calendar's one tab stop in `month`: the first of `preferred` that
 * lies in the month and is not disabled, else the first enabled day of the month, else the
 * 1st.
 */
export function gridFocus(
  month: Date,
  preferred: readonly (Date | null)[],
  bounds: DayBounds
): Date {
  for (const day of preferred) {
    if (day && sameMonth(day, month) && !isDisabled(day, bounds)) {
      return day;
    }
  }
  const first = makeDay(month.getFullYear(), month.getMonth(), 1) ?? month;
  const count = daysInMonth(first);
  for (let index = 0; index < count; index += 1) {
    const day = addDays(first, index);
    if (!isDisabled(day, bounds)) {
      return day;
    }
  }
  return first;
}

/** How many years the year select lists either side of today when no limit stops it. */
const YEAR_SPAN = 10;

/**
 * The years the calendar's year select lists, oldest first: from `min`'s year (or ten
 * years before today) to `max`'s year (or ten after), always holding the shown year.
 */
export function yearChoices(
  shown: Date,
  bounds: DayBounds,
  today: Date
): number[] {
  const first = Math.min(
    bounds.min ? bounds.min.getFullYear() : today.getFullYear() - YEAR_SPAN,
    shown.getFullYear()
  );
  const last = Math.max(
    bounds.max ? bounds.max.getFullYear() : today.getFullYear() + YEAR_SPAN,
    shown.getFullYear()
  );
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

/** True when no day of `month`'s month lies inside the bounds. */
export function monthOutside(month: Date, bounds: DayBounds): boolean {
  const first = makeDay(month.getFullYear(), month.getMonth(), 1) ?? month;
  const last = addDays(first, daysInMonth(first) - 1);
  return (
    (bounds.max ? compareDays(first, bounds.max) > 0 : false) ||
    (bounds.min ? compareDays(last, bounds.min) < 0 : false)
  );
}

/** Where a calendar day sits against the picked value. */
export interface DayState {
  selected: boolean;
  start: boolean;
  end: boolean;
  middle: boolean;
}

/**
 * Where the day `key` (`YYYY-MM-DD`) sits against a single day (a string) or a range. A
 * range end that is `""` marks nothing, and the middle needs both ends.
 */
export function dayState(value: string | DayRange, key: string): DayState {
  if (typeof value === "string") {
    const selected = value === key;
    return { selected, start: selected, end: selected, middle: false };
  }
  const { from, to } = value;
  const start = from !== "" && key === from;
  const end = to !== "" && key === to;
  const middle = from !== "" && to !== "" && key > from && key < to;
  return { selected: start || end || middle, start, end, middle };
}

/** A range picker's `quickChoices` prop as the list it shows: `true` is all four. */
export function quickChoiceIds(
  choices: boolean | readonly QuickRangeId[]
): readonly QuickRangeId[] {
  if (choices === true) {
    return QUICK_RANGE_IDS;
  }
  return choices === false ? [] : choices;
}

/** What the text in a typed day field means once it is applied. */
export type TypedDay =
  | { kind: "unchanged" }
  | { kind: "empty" }
  | { kind: "bad" }
  | { kind: "day"; day: string };

/**
 * Reads a typed day field's text against its `YYYY-MM-DD` value, in `locale`. Text that
 * still shows the value is `unchanged`, so a field that showed an error clears it when the
 * person types the value back or empties a field that was empty.
 */
export function readTypedDay(
  text: string,
  value: string,
  locale: string
): TypedDay {
  const typed = text.trim();
  if (typed === formatShown(value, locale)) {
    return { kind: "unchanged" };
  }
  if (typed === "") {
    return { kind: "empty" };
  }
  const parsed = parseTyped(typed, locale);
  return parsed ? { day: formatDay(parsed), kind: "day" } : { kind: "bad" };
}
