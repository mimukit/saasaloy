// The words and dates the CMS screens show. Pure on purpose: no React, no router and no
// `@repo/cms` value import, so `cms-format.test.ts` runs it under `node --test`.

/** An entry's status, as the api answers it. */
export type CmsStatus = "draft" | "published" | "archived";

/** The list's filter chips. `current` (draft and published) is the default. */
export type CmsListFilter =
  "current" | "draft" | "published" | "archived" | "all";

export const LIST_FILTERS: readonly { id: CmsListFilter; label: string }[] = [
  { id: "current", label: "Current" },
  { id: "draft", label: "Draft" },
  { id: "published", label: "Published" },
  { id: "archived", label: "Archived" },
  { id: "all", label: "All" },
];

/** The status pill's tone per status, as the approved mockup settled it. */
export const STATUS_TONE = {
  archived: "neutral",
  draft: "open",
  published: "ok",
} as const satisfies Record<CmsStatus, string>;

export const STATUS_LABEL: Record<CmsStatus, string> = {
  archived: "Archived",
  draft: "Draft",
  published: "Published",
};

/** Optional formatting settings. Tests pin `timeZone`; the app uses the browser's. */
export interface FormatOptions {
  timeZone?: string;
}

const LOCALE = "en-GB";
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
/** Under this age a time reads as relative ("26 hours ago"), from it on as a date. */
const RELATIVE_LIMIT = 36 * HOUR;

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

/** "4 Nov 2026, 10:00". */
export function dateTime(
  value: Date | string,
  options: FormatOptions = {}
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
    timeZone: options.timeZone,
    year: "numeric",
  }).format(toDate(value));
}

/** "12 Oct 2026". */
export function shortDate(
  value: Date | string,
  options: FormatOptions = {}
): string {
  return new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "short",
    timeZone: options.timeZone,
    year: "numeric",
  }).format(toDate(value));
}

/** "09:58". */
function clockTime(value: Date, options: FormatOptions): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: options.timeZone,
  }).format(value);
}

/**
 * The Updated column: "38 min ago" and "26 hours ago" under 36 hours, then the date and
 * the time. A time slightly ahead of `now` (clock skew) reads as "just now".
 */
export function relativeTime(
  value: Date | string,
  now: Date,
  options: FormatOptions = {}
): string {
  const date = toDate(value);
  const age = now.getTime() - date.getTime();
  if (age < MINUTE) {
    return "just now";
  }
  if (age < HOUR) {
    return `${String(Math.round(age / MINUTE))} min ago`;
  }
  if (age < RELATIVE_LIMIT) {
    const hours = Math.round(age / HOUR);
    return hours === 1 ? "1 hour ago" : `${String(hours)} hours ago`;
  }
  return dateTime(date, options);
}

/** The count on each chip, from the api's per-status counts. */
export function chipCounts(
  counts: Record<CmsStatus, number>
): Record<CmsListFilter, number> {
  return {
    ...counts,
    all: counts.draft + counts.published + counts.archived,
    current: counts.draft + counts.published,
  };
}

/**
 * The number each revision shows, for a newest-first list of `count` revisions: the oldest
 * kept revision is 1. Pruning drops the oldest, so the numbers count the kept revisions.
 */
export function revisionNumbers(count: number): number[] {
  return Array.from({ length: count }, (_, index) => count - index);
}

/** The line under the editor's title. */
export function savedLine(
  entry: {
    status: CmsStatus;
    hasUnpublishedEdits: boolean;
    updatedAt: Date | string;
  },
  now: Date,
  options: FormatOptions = {}
): string {
  const when = relativeTime(entry.updatedAt, now, options);
  if (entry.status === "archived") {
    return `Archived. Saved ${when}.`;
  }
  if (entry.status === "draft") {
    return `Draft saved ${when}. Not live.`;
  }
  return entry.hasUnpublishedEdits
    ? `Draft saved ${when}. Unpublished edits.`
    : `Saved ${when}. The live post matches the draft.`;
}

/** What a stale write's 409 carries: who moved the version, when, and to what. */
export interface CmsConflict {
  updatedAt: string;
  updatedByName: string | null;
  version: number;
}

/** The `conflict` block of a 409 body, or null when the body is anything else. */
export function readConflict(body: unknown): CmsConflict | null {
  if (typeof body !== "object" || body === null || !("conflict" in body)) {
    return null;
  }
  const { conflict } = body;
  if (typeof conflict !== "object" || conflict === null) {
    return null;
  }
  const { updatedAt, updatedByName, version } = conflict as Record<
    string,
    unknown
  >;
  if (
    typeof updatedAt !== "string" ||
    typeof version !== "number" ||
    (updatedByName !== null && typeof updatedByName !== "string")
  ) {
    return null;
  }
  return { updatedAt, updatedByName, version };
}

/** The write a conflict stopped. It names the action in the alert. */
export type CmsWriteAction = "save" | "publish" | "unpublish" | "restore";

function sameDay(left: Date, right: Date, options: FormatOptions): boolean {
  return shortDate(left, options) === shortDate(right, options);
}

/** The conflict alert's title and text. It names the other editor and the time. */
export function conflictText(input: {
  action: CmsWriteAction;
  conflict: CmsConflict;
  now: Date;
  singular: string;
  timeZone?: string;
}): { title: string; description: string } {
  const options = { timeZone: input.timeZone };
  const at = new Date(input.conflict.updatedAt);
  const time = clockTime(at, options);
  const when = sameDay(at, input.now, options)
    ? `at ${time}`
    : `on ${shortDate(at, options)} at ${time}`;
  const who = input.conflict.updatedByName ?? "Someone";
  return {
    description: `${who} saved a newer version ${when}, so your ${input.action} was not applied. Reload to load the newer version. Your edits in this form are lost on reload, so copy any text you want to keep first.`,
    title: `This ${input.singular.toLowerCase()} changed in another tab`,
  };
}
