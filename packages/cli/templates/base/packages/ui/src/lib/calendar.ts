// The date picker's logic: parse and format, the month grid, min and max, the key moves,
// the range picks, the quick choices and the 12-hour time fields. Pure and IO-free, with
// `Date` and `Intl` only and no date library, so the base calendar and the shell calendar
// share it and a Node test runs it without a DOM.
//
// Every value at a call site is a string in browser local time: a day is `YYYY-MM-DD`, a
// date-time is `YYYY-MM-DDTHH:mm`, and `""` is empty. Inside, a day is a `Date` at local
// midnight. Every function returns a new `Date` and never changes the one it is given.

/** A weekday as `Date#getDay` numbers it: 0 is Sunday, 1 is Monday, 6 is Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Every weekday, indexed by its own number. */
const WEEKDAYS: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** The first weekday when the runtime gives no week info for a locale: Monday. */
const FALLBACK_WEEK_START: Weekday = 1;

/** `Intl.Locale` week info: `firstDay` runs from 1 (Monday) to 7 (Sunday). */
interface WeekInfo {
  firstDay?: number;
}

/** The two shapes runtimes ship week info in: a method (the spec) or an older getter. */
interface LocaleWithWeekInfo {
  getWeekInfo?: () => WeekInfo;
  weekInfo?: WeekInfo;
}

/**
 * The first day of the week in `locale`, as `Date#getDay` numbers it: Sunday (0) for
 * `en-US`, Monday (1) for `en-GB`, Saturday (6) for `ar-EG`. It reads `Intl.Locale` week
 * info, through `getWeekInfo()` or the older `weekInfo` getter, and gives Monday where the
 * runtime has neither. The calendars call it with `config.app.locale`, and their
 * `weekStartsOn` prop overrides it.
 */
export function firstDayOfWeek(locale: string): Weekday {
  const info = new Intl.Locale(locale) as Intl.Locale & LocaleWithWeekInfo;
  const week =
    typeof info.getWeekInfo === "function" ? info.getWeekInfo() : info.weekInfo;
  const first = week?.firstDay;
  // `firstDay` 7 (Sunday) is `getDay` 0; 1 to 6 match. Anything else falls back.
  if (typeof first !== "number" || first < 1 || first > 7) {
    return FALLBACK_WEEK_START;
  }
  return WEEKDAYS[first % 7] ?? FALLBACK_WEEK_START;
}

/** A From/To pair as the fields hold it. Either end may be `""`. */
export interface DayRange {
  from: string;
  to: string;
}

/** The earliest and latest day a calendar allows. Only the day part of each is read. */
export interface DayBounds {
  min?: Date | null;
  max?: Date | null;
}

/** One cell of the month grid. */
export interface CalendarDay {
  /** Local midnight of the day. */
  date: Date;
  /** `YYYY-MM-DD`, for a React key and a `data-day` attribute. */
  key: string;
  /** True for a day of the month before or after the one shown. */
  outside: boolean;
}

/** The time fields' state: an hour from 1 to 12, a minute from 0 to 59, and AM or PM. */
export interface TwelveHourTime {
  hour: number;
  minute: number;
  period: Period;
}

export type Period = "AM" | "PM";

/** The quick choices beside a range calendar, in the order they show. */
export const QUICK_RANGE_IDS = [
  "today",
  "last7",
  "last30",
  "thisMonth",
] as const;

export type QuickRangeId = (typeof QUICK_RANGE_IDS)[number];

/** The keys `moveFocus` handles, from the APG date picker dialog pattern. */
export const FOCUS_KEYS = [
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
] as const;

export type FocusKey = (typeof FOCUS_KEYS)[number];

/** Where a value sits against its limits. */
export type LimitCheck = "ok" | "invalid" | "early" | "late";

const DAY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/;
const TIME_PATTERN = /^(\d{2}):(\d{2})$/;
const SLASH_PATTERN = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/;
const YEAR_FIRST_PATTERN = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/;
const WORDS_PATTERN = /^(\d{1,2})\.?\s+(\p{L}+)\.?\s+(\d{4})$/u;
const MONTH_FIRST_PATTERN = /^(\p{L}+)\.?\s+(\d{1,2})\s+(\d{4})$/u;

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/**
 * Local midnight of `year`-`month`-`day`, with `month` from 0, or null when the parts do not
 * name a real day (31 Feb, month 13). `setFullYear` keeps years below 100 as written.
 */
export function makeDay(year: number, month: number, day: number): Date | null {
  const date = new Date(2000, 0, 1);
  date.setFullYear(year, month, day);
  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : null;
}

/** Local midnight of the day `date` falls on. */
export function startOfDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/** The first day of the month `date` falls in. */
export function startOfMonth(date: Date): Date {
  const day = startOfDay(date);
  day.setDate(1);
  return day;
}

/** The first day of the week `date` falls in, for a week that starts on `weekStartsOn`. */
export function startOfWeek(date: Date, weekStartsOn: Weekday): Date {
  const back = (date.getDay() - weekStartsOn + 7) % 7;
  return addDays(date, -back);
}

/** The last day of the week `date` falls in, six days after `startOfWeek`. */
export function endOfWeek(date: Date, weekStartsOn: Weekday): Date {
  return addDays(startOfWeek(date, weekStartsOn), 6);
}

/** `date` moved by `count` days, at local midnight. Daylight saving does not shift it. */
export function addDays(date: Date, count: number): Date {
  const day = startOfDay(date);
  day.setDate(day.getDate() + count);
  return day;
}

/**
 * `date` moved by `count` months, at local midnight. The day of the month clamps to the
 * last day of a shorter month: 31 Jan plus one month is 28 Feb (29 in a leap year).
 */
export function addMonths(date: Date, count: number): Date {
  const target = new Date(2000, 0, 1);
  target.setFullYear(date.getFullYear(), date.getMonth() + count, 1);
  const last = daysInMonth(target);
  target.setDate(Math.min(date.getDate(), last));
  return target;
}

/** `date` moved by `count` years, clamped as `addMonths` does: 29 Feb 2024 → 28 Feb 2025. */
export function addYears(date: Date, count: number): Date {
  return addMonths(date, count * 12);
}

/** The number of days in the month `date` falls in. */
export function daysInMonth(date: Date): number {
  const last = new Date(2000, 0, 1);
  last.setFullYear(date.getFullYear(), date.getMonth() + 1, 0);
  return last.getDate();
}

/** True when `a` and `b` fall on the same local day. */
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** True when `a` and `b` fall in the same month of the same year. */
export function sameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

/** Negative when day `a` is before day `b`, 0 on the same day, positive after. */
export function compareDays(a: Date, b: Date): number {
  return startOfDay(a).getTime() - startOfDay(b).getTime();
}

/** `2026-10-05` as local midnight of that day, or null when it is not a real day. */
export function parseDay(value: string): Date | null {
  const match = DAY_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day] = match;
  return makeDay(Number(year), Number(month) - 1, Number(day));
}

/** The local day of `date` as `YYYY-MM-DD`. */
export function formatDay(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * `2026-10-05T09:30` as that local time, or null when it is not a real day and time. The
 * seconds a `datetime-local` field may add (`:00`, `:00.000`) are read and dropped.
 */
export function parseDateTime(value: string): Date | null {
  const match = DATE_TIME_PATTERN.exec(value);
  if (!match) {
    return null;
  }
  const [, year, month, day, hours, minutes] = match;
  const date = makeDay(Number(year), Number(month) - 1, Number(day));
  if (!date || Number(hours) > 23 || Number(minutes) > 59) {
    return null;
  }
  date.setHours(Number(hours), Number(minutes));
  return date;
}

/**
 * `date` in local time as `YYYY-MM-DDTHH:mm`, the value a date-time field holds. Seconds
 * drop.
 */
export function formatDateTime(date: Date): string {
  return `${formatDay(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** A date-time value split into its day (`YYYY-MM-DD`) and time (`HH:mm`). */
export function splitDateTime(value: string): { day: string; time: string } {
  const [day = "", time = ""] = value.split("T");
  return { day, time: time.slice(0, 5) };
}

/** A day and a time joined as a date-time value, or `""` when the day is empty. */
export function joinDateTime(day: string, time: string): string {
  return day === "" ? "" : `${day}T${time === "" ? "00:00" : time}`;
}

/** The twelve month names from January, in `locale`. */
export function monthNames(
  locale: string,
  width: "long" | "short" = "long"
): readonly string[] {
  const format = new Intl.DateTimeFormat(locale, { month: width });
  return Array.from({ length: 12 }, (_, month) =>
    format.format(new Date(2000, month, 1))
  );
}

/**
 * The seven weekday names in `locale`, from `weekStartsOn`: for `en-GB` from Monday, `Mon`
 * … `Sun` short, `Monday` … long, `M`, `T`, `W` … narrow.
 */
export function weekdayNames(
  locale: string,
  weekStartsOn: Weekday,
  width: "long" | "short" | "narrow" = "short"
): readonly string[] {
  const format = new Intl.DateTimeFormat(locale, { weekday: width });
  // 2 Jan 2000 was a Sunday, so day `n` of that week is `Date#getDay` `n`.
  const first = new Date(2000, 0, 2 + weekStartsOn);
  return Array.from({ length: 7 }, (_, index) =>
    format.format(addDays(first, index))
  );
}

/**
 * A day as the field shows it, in `locale` with Latin digits: `5 Oct 2026` in `en-GB`,
 * `Oct 5, 2026` in `en`. Takes a `Date` or a `YYYY-MM-DD` value, and gives `""` for a value
 * that is not a day. The digits stay Latin in every locale so `parseTyped` reads the text
 * back.
 */
export function formatShown(day: Date | string, locale: string): string {
  const date = typeof day === "string" ? parseDay(day) : day;
  if (!date) {
    return "";
  }
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
    numberingSystem: "latn",
  }).format(date);
}

/**
 * The month index of a typed month word (`oct`, `October`, `Sept`), or -1. It matches the
 * month names of `locale` first, then the English ones, so `5 Oct 2026` reads in any locale.
 */
function monthFromWord(word: string, locale: string): number {
  if (word.length < 3) {
    return -1;
  }
  for (const names of [monthNames(locale, "long"), monthNames("en", "long")]) {
    const index = names.findIndex((name) =>
      name.toLowerCase().startsWith(word)
    );
    if (index !== -1) {
      return index;
    }
  }
  return -1;
}

/**
 * The order `locale` writes a numeric day in: `dmy` for `en-GB` (5/10/2026), `mdy` for `en`
 * (10/5/2026), `ymd` for `ja` (2026/10/5).
 */
export function numericDayOrder(locale: string): "dmy" | "mdy" | "ymd" {
  const order = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  })
    .formatToParts(new Date(2026, 9, 5))
    .map((part) => part.type)
    .filter((type) => type === "day" || type === "month" || type === "year")
    .map((type) => type[0])
    .join("");
  return order === "mdy" || order === "ymd" ? order : "dmy";
}

/**
 * A day that a person typed, as local midnight, or null when it does not read as a real day.
 * Accepts `2026-10-05` and `2026/10/05`; `5 Oct 2026` and `Oct 5, 2026` (any month word of
 * three letters or more, in `locale` or English); and `5/10/2026`, `5.10.2026` or
 * `5-10-2026` in the order `locale` writes a numeric day (`numericDayOrder`). Rejects
 * 31/02/2026. The digits must be Latin.
 */
export function parseTyped(text: string, locale: string): Date | null {
  const clean = text
    .trim()
    .toLowerCase()
    .replaceAll(",", " ")
    .replaceAll(/\s+/g, " ");
  if (DAY_PATTERN.test(clean)) {
    return parseDay(clean);
  }
  const yearFirst = YEAR_FIRST_PATTERN.exec(clean);
  if (yearFirst) {
    const [, year, month, day] = yearFirst;
    return makeDay(Number(year), Number(month) - 1, Number(day));
  }
  const slash = SLASH_PATTERN.exec(clean);
  if (slash) {
    const [, first, second, year] = slash;
    const [day, month] =
      numericDayOrder(locale) === "mdy" ? [second, first] : [first, second];
    return makeDay(Number(year), Number(month) - 1, Number(day));
  }
  const words = WORDS_PATTERN.exec(clean);
  if (words) {
    const [, day, word = "", year] = words;
    const month = monthFromWord(word, locale);
    return month === -1 ? null : makeDay(Number(year), month, Number(day));
  }
  const monthFirst = MONTH_FIRST_PATTERN.exec(clean);
  if (monthFirst) {
    const [, word = "", day, year] = monthFirst;
    const month = monthFromWord(word, locale);
    return month === -1 ? null : makeDay(Number(year), month, Number(day));
  }
  return null;
}

/**
 * The month that holds `month` as six weeks from `weekStartsOn`: 42 days, with the days of
 * the months before and after marked `outside`.
 */
export function monthGrid(month: Date, weekStartsOn: Weekday): CalendarDay[][] {
  const first = startOfMonth(month);
  const start = startOfWeek(first, weekStartsOn);
  return Array.from({ length: 6 }, (_, week) =>
    Array.from({ length: 7 }, (__, weekday) => {
      const date = addDays(start, week * 7 + weekday);
      return { date, key: formatDay(date), outside: !sameMonth(date, first) };
    })
  );
}

/** True when `day` falls on a day before `limit`. A missing limit is never passed. */
function beforeLimit(day: Date, limit: Date | null | undefined): boolean {
  return limit ? compareDays(day, limit) < 0 : false;
}

/** True when `day` falls on a day after `limit`. A missing limit is never passed. */
function afterLimit(day: Date, limit: Date | null | undefined): boolean {
  return limit ? compareDays(day, limit) > 0 : false;
}

/** True when `day` is before the day of `min` or after the day of `max`. */
export function isDisabled(day: Date, { min, max }: DayBounds): boolean {
  return beforeLimit(day, min) || afterLimit(day, max);
}

/** `day` at local midnight, moved onto `min` or `max` when it falls outside them. */
export function clampDay(day: Date, { min, max }: DayBounds): Date {
  if (min && beforeLimit(day, min)) {
    return startOfDay(min);
  }
  if (max && afterLimit(day, max)) {
    return startOfDay(max);
  }
  return startOfDay(day);
}

/** What `moveFocus` needs besides the day and the key. */
export interface FocusMove {
  /** The first day of the week, for Home and End. */
  weekStartsOn: Weekday;
  /** The limits the new day clamps to. */
  bounds?: DayBounds;
  /** True while Shift is held: PageUp and PageDown then move a year. */
  shiftKey?: boolean;
}

/**
 * The day a grid key moves the focus to, clamped to the bounds, or null for a key the grid
 * does not handle. Arrows move a day or a week, PageUp and PageDown a month (a year with
 * Shift), Home and End go to the first and last day of the week.
 */
export function moveFocus(
  day: Date,
  key: string,
  { weekStartsOn, bounds = {}, shiftKey = false }: FocusMove
): Date | null {
  let next: Date;
  switch (key) {
    case "ArrowLeft": {
      next = addDays(day, -1);
      break;
    }
    case "ArrowRight": {
      next = addDays(day, 1);
      break;
    }
    case "ArrowUp": {
      next = addDays(day, -7);
      break;
    }
    case "ArrowDown": {
      next = addDays(day, 7);
      break;
    }
    case "PageUp": {
      next = shiftKey ? addYears(day, -1) : addMonths(day, -1);
      break;
    }
    case "PageDown": {
      next = shiftKey ? addYears(day, 1) : addMonths(day, 1);
      break;
    }
    case "Home": {
      next = startOfWeek(day, weekStartsOn);
      break;
    }
    case "End": {
      next = endOfWeek(day, weekStartsOn);
      break;
    }
    default: {
      return null;
    }
  }
  return clampDay(next, bounds);
}

/**
 * The range after a pick in the range calendar. With no From, or with both ends set, the
 * pick starts a new range at From. With From only, the pick sets To, and a pick before
 * From swaps the two. With To only (typed), the pick sets From, swapping when it is later.
 */
export function nextRange(range: DayRange, day: string): DayRange {
  const { from, to } = range;
  if (from !== "" && to === "") {
    return day < from ? { from: day, to: from } : { from, to: day };
  }
  if (from === "" && to !== "") {
    return day > to ? { from: to, to: day } : { from: day, to };
  }
  return { from: day, to: "" };
}

/**
 * A quick choice as a range ending today: Today, the last 7 or 30 days counting today, or
 * this month from its first day to today.
 */
export function quickRange(id: QuickRangeId, today: Date): DayRange {
  const to = formatDay(today);
  switch (id) {
    case "today": {
      return { from: to, to };
    }
    case "last7": {
      return { from: formatDay(addDays(today, -6)), to };
    }
    case "last30": {
      return { from: formatDay(addDays(today, -29)), to };
    }
    case "thisMonth": {
      return { from: formatDay(startOfMonth(today)), to };
    }
    default: {
      return { from: to, to };
    }
  }
}

/** A day value against `min` and `max` (each `YYYY-MM-DD` or a date-time, `""` for none). */
export function checkDay(
  value: string,
  { min = "", max = "" }: { min?: string; max?: string } = {}
): LimitCheck {
  const day = parseDay(value);
  if (!day) {
    return "invalid";
  }
  const bounds = { min: parseLimit(min), max: parseLimit(max) };
  if (bounds.min && compareDays(day, bounds.min) < 0) {
    return "early";
  }
  if (bounds.max && compareDays(day, bounds.max) > 0) {
    return "late";
  }
  return "ok";
}

/**
 * A date-time value against `min` and `max`, to the minute: seconds on either side are
 * dropped, so a value equal to `min` or `max` is `ok`. A day-only limit means its midnight.
 */
export function checkDateTime(
  value: string,
  { min = "", max = "" }: { min?: string; max?: string } = {}
): LimitCheck {
  const time = parseDateTime(value);
  if (!time) {
    return "invalid";
  }
  const low = parseLimit(min);
  const high = parseLimit(max);
  if (low && time.getTime() < low.getTime()) {
    return "early";
  }
  if (high && time.getTime() > high.getTime()) {
    return "late";
  }
  return "ok";
}

/**
 * A `min` or `max` prop as a `Date`: a date-time (to the minute) or a day (its midnight),
 * or null for `""` and for a value that reads as neither.
 */
export function parseLimit(value: string): Date | null {
  return parseDateTime(value) ?? parseDay(value);
}

/** `HH:mm` (24-hour) as the time fields show it, or null when it is not a time. */
export function to12Hour(hhmm: string): TwelveHourTime | null {
  const match = TIME_PATTERN.exec(hhmm);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minute = Number(match[2]);
  if (hours > 23 || minute > 59) {
    return null;
  }
  return {
    hour: hours % 12 === 0 ? 12 : hours % 12,
    minute,
    period: hours < 12 ? "AM" : "PM",
  };
}

/** The time fields as the stored 24-hour `HH:mm`: 12 AM is `00`, 12 PM is `12`. */
export function to24Hour({ hour, minute, period }: TwelveHourTime): string {
  const hours = (hour % 12) + (period === "PM" ? 12 : 0);
  return `${pad(hours)}:${pad(minute)}`;
}

/** An hour field stepped by `delta`, wrapping inside 1 to 12 (12 → 1, 1 → 12). AM/PM stays. */
export function stepHour(hour: number, delta: number): number {
  return ((((hour - 1 + delta) % 12) + 12) % 12) + 1;
}

/** A minute field stepped by `delta`, wrapping inside 0 to 59 (59 → 0, 0 → 59). */
export function stepMinute(minute: number, delta: number): number {
  return (((minute + delta) % 60) + 60) % 60;
}
