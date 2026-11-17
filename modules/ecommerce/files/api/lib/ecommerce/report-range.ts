// The report range (plan 0106, "Reports", grill Q9): today, 7 days, 30 days or a custom
// pair of dates, each turned into a half-open `[from, to)` of instants and the list of
// days it covers. A day starts at midnight in the shop's time zone
// (`config.ecommerce.timeZone`), not in UTC, so "today" in Dhaka starts at 18:00 UTC.
//
// No imports, so a plain `node --test` covers it.

export type ReportRangeKind = "today" | "7d" | "30d" | "custom";

export interface ReportRangeQuery {
  range: ReportRangeKind;
  /** `YYYY-MM-DD`, for `custom`. */
  from?: string;
  /** `YYYY-MM-DD`, for `custom`, included. */
  to?: string;
}

export interface ResolvedRange {
  from: Date;
  to: Date;
  /** Every day of the range, `YYYY-MM-DD`, oldest first. */
  days: string[];
}

const DAY_MS = 86_400_000;
const MAX_DAYS = 366;
const SPAN: Record<Exclude<ReportRangeKind, "custom">, number> = {
  "30d": 30,
  "7d": 7,
  today: 1,
};

/** The calendar date of `at` in `timeZone`, `YYYY-MM-DD`. */
function localDate(at: Date, timeZone: string): string {
  // `en-CA` writes dates as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).format(at);
}

/** How far `timeZone` runs ahead of UTC at `at`, in milliseconds. */
function zoneOffset(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(at);
  const part = (type: string) =>
    Number(parts.find((entry) => entry.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    part("year"),
    part("month") - 1,
    part("day"),
    part("hour"),
    part("minute"),
    part("second")
  );
  return asUtc - Math.floor(at.getTime() / 1000) * 1000;
}

/** The instant `date` starts in `timeZone`. */
function startOf(date: string, timeZone: string): Date {
  const guess = new Date(`${date}T00:00:00.000Z`);
  const first = new Date(guess.getTime() - zoneOffset(guess, timeZone));
  // A second pass settles a day whose offset changes near midnight.
  return new Date(guess.getTime() - zoneOffset(first, timeZone));
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Resolve a range query at `now`. Throws an `Error` naming the problem for a bad custom range. */
export function reportRange(
  query: ReportRangeQuery,
  now: Date,
  timeZone: string
): ResolvedRange {
  let first: string;
  let last: string;
  if (query.range === "custom") {
    if (
      !query.from ||
      !query.to ||
      !DATE.test(query.from) ||
      !DATE.test(query.to)
    ) {
      throw new Error("A custom range needs from and to, as YYYY-MM-DD.");
    }
    first = query.from;
    last = query.to;
    if (last < first) {
      throw new Error("A custom range cannot end before it starts.");
    }
  } else {
    last = localDate(now, timeZone);
    first = addDays(last, 1 - SPAN[query.range]);
  }
  const count =
    Math.round(
      (Date.parse(`${last}T00:00:00.000Z`) -
        Date.parse(`${first}T00:00:00.000Z`)) /
        DAY_MS
    ) + 1;
  if (count > MAX_DAYS) {
    throw new Error(`A report covers ${MAX_DAYS} days at most.`);
  }
  return {
    days: Array.from({ length: count }, (_unused, index) =>
      addDays(first, index)
    ),
    from: startOf(first, timeZone),
    to: startOf(addDays(last, 1), timeZone),
  };
}
