// The pure rules the Activity and Members screens share: the date range menu, the filters
// the address holds, the query the api takes, and the words for a time or a stored value.
//
// It imports nothing, React and the api client included, so the saasaloy repo tests it with
// `node --test` (`./activity.test.ts`). The requests live in `./activity-query.ts`.

/** Every Activity query hangs from this key, so one invalidation reloads the page. */
export const ACTIVITY_KEY = ["admin", "activity"] as const;

/** The date range menu, in menu order. `7d` is the resting state. */
export const ACTIVITY_RANGES = ["today", "7d", "30d", "90d", "all"] as const;

export type ActivityRange = (typeof ACTIVITY_RANGES)[number];

export const RANGE_LABELS: Readonly<Record<ActivityRange, string>> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
  today: "Today",
};

export function isActivityRange(value: string): value is ActivityRange {
  return (ACTIVITY_RANGES as readonly string[]).includes(value);
}

const DAY_MS = 24 * 60 * 60 * 1000;

const RANGE_DAYS: Readonly<
  Record<Exclude<ActivityRange, "today" | "all">, number>
> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

/** Where a range starts, as an ISO time, or `undefined` for all time. */
export function rangeStart(
  range: ActivityRange,
  now: Date
): string | undefined {
  if (range === "all") {
    return undefined;
  }
  if (range === "today") {
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    return midnight.toISOString();
  }
  return new Date(now.getTime() - RANGE_DAYS[range] * DAY_MS).toISOString();
}

/** The filters the address holds. The defaults (everyone, every area, 7 days) stay out. */
export interface ActivitySearch {
  actor?: string;
  area?: string;
  range?: Exclude<ActivityRange, "7d">;
}

/** The route's `validateSearch`: keeps each known filter and drops the rest. */
export function activitySearch(
  search: Record<string, unknown>
): ActivitySearch {
  const { actor, area, range } = search;
  return {
    ...(typeof actor === "string" && actor !== "" ? { actor } : {}),
    ...(typeof area === "string" && area !== "" && area !== "all"
      ? { area }
      : {}),
    ...(typeof range === "string" && isActivityRange(range) && range !== "7d"
      ? { range }
      : {}),
  };
}

/** The search a filter change leads to: the defaults stay out of the address. */
export function searchOf(
  actor: string | undefined,
  area: string,
  range: ActivityRange
): ActivitySearch {
  return {
    ...(actor === undefined ? {} : { actor }),
    ...(area === "all" ? {} : { area }),
    ...(range === "7d" ? {} : { range }),
  };
}

export interface ActivityFilters {
  actor?: string | undefined;
  area: string;
  range: ActivityRange;
  q: string;
}

/** The query `GET /admin/audit-events` takes. A filter at its default stays out. */
export function activityParams(
  filters: ActivityFilters,
  now: Date,
  cursor?: string
): {
  actor?: string;
  area?: string;
  q?: string;
  from?: string;
  cursor?: string;
} {
  const from = rangeStart(filters.range, now);
  const q = filters.q.trim();
  return {
    ...(filters.actor === undefined ? {} : { actor: filters.actor }),
    ...(filters.area === "all" ? {} : { area: filters.area }),
    ...(q === "" ? {} : { q }),
    ...(from === undefined ? {} : { from }),
    ...(cursor === undefined ? {} : { cursor }),
  };
}

// Times read the way the approved mockup writes them: "Today, 10:41", "Yesterday, 17:40",
// "1 Nov 2026, 14:22". Day, month and a 24-hour clock in the viewer's own time zone.

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const CLOCK = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
});
const CLOCK_SECONDS = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  second: "2-digit",
});

/** Whole local days between `then` and `now`: 0 today, 1 yesterday. */
function daysAgo(then: Date, now: Date): number {
  const start = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((start(now) - start(then)) / DAY_MS);
}

/** "12 Sep 2026". */
export function dateLabel(iso: string): string {
  return DATE.format(new Date(iso));
}

/** "4 Nov 2026, 10:41:07", the detail panel's exact time. */
export function exactTime(iso: string): string {
  const date = new Date(iso);
  return `${DATE.format(date)}, ${CLOCK_SECONDS.format(date)}`;
}

/**
 * "Today, 10:41", "Yesterday, 17:40", then "1 Nov 2026, 14:22". Pass `withTime: false` to
 * drop the clock from an older date, as the Last sign-in column does.
 */
export function whenLabel(
  iso: string,
  now: Date,
  { withTime = true }: { withTime?: boolean } = {}
): string {
  const date = new Date(iso);
  const days = daysAgo(date, now);
  if (days === 0) {
    return `Today, ${CLOCK.format(date)}`;
  }
  if (days === 1) {
    return `Yesterday, ${CLOCK.format(date)}`;
  }
  return withTime
    ? `${DATE.format(date)}, ${CLOCK.format(date)}`
    : DATE.format(date);
}

/** A short age: "just now", "5 min ago", "2 h ago", "Yesterday", then the date. */
export function agoLabel(iso: string, now: Date): string {
  const date = new Date(iso);
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 1) {
    return "just now";
  }
  if (minutes < 60) {
    return `${minutes} min ago`;
  }
  if (minutes < 24 * 60 && daysAgo(date, now) === 0) {
    return `${Math.floor(minutes / 60)} h ago`;
  }
  return daysAgo(date, now) === 1 ? "Yesterday" : DATE.format(date);
}

/** One stored value as text. A missing one reads as a dash, a string as itself. */
export function valueText(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "–";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

export interface ChangeRow {
  field: string;
  before: unknown;
  after: unknown;
}

/** The "What changed" table: one row per stored field, in the order the api sent them. */
export function changeRows(
  before: Readonly<Record<string, unknown>> | null,
  after: Readonly<Record<string, unknown>> | null
): ChangeRow[] {
  const fields = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ];
  return fields.map((field) => ({
    after: after?.[field],
    before: before?.[field],
    field,
  }));
}
