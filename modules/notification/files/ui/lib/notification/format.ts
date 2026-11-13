// The two display rules the notification blocks share: the text on the bell's badge, and
// the age of a row ("4 minutes ago", "yesterday").
//
// It is a .ts file with no imports so the tool repo can unit-test it under `node --test`
// with no React and no bundler, the same way @repo/ui/lib/shell/nav-counts is.

/** The badge stops counting here. A larger count reads `99+`. */
export const BADGE_MAX = 99;

/**
 * The text on the bell's badge, or `null` for no badge.
 *
 * No badge for an unknown count (`undefined`, before the first fetch lands), for 0, or
 * for a value that is not a finite number. A count above BADGE_MAX reads `99+`, so the
 * badge keeps one width however far behind the reader is.
 */
export function badgeText(count: number | undefined): string | null {
  if (typeof count !== "number" || !Number.isFinite(count) || count < 1) {
    return null;
  }
  return count > BADGE_MAX ? `${BADGE_MAX}+` : String(Math.floor(count));
}

/** The unit steps a relative time walks through, each with its length in seconds. */
const STEPS: readonly { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] =
  [
    { unit: "year", seconds: 365 * 24 * 60 * 60 },
    { unit: "month", seconds: 30 * 24 * 60 * 60 },
    { unit: "week", seconds: 7 * 24 * 60 * 60 },
    { unit: "day", seconds: 24 * 60 * 60 },
    { unit: "hour", seconds: 60 * 60 },
    { unit: "minute", seconds: 60 },
  ];

/**
 * How long ago `at` was, from `now`, in the largest whole unit: "4 minutes ago", "1 hour
 * ago", "yesterday", "last week", "3 months ago". Under a minute reads "now".
 *
 * The count rounds down, so a row from 90 minutes ago says "1 hour ago" and never claims
 * an age it has not reached. A time in the future (a clock that runs ahead of the api's)
 * reads "now" rather than "in 2 minutes". `numeric: "auto"` is what turns -1 day into
 * "yesterday". An unreadable date returns an empty string, so a bad row shows no age
 * rather than "NaN years ago".
 */
export function relativeTime(
  at: Date | string,
  now: Date,
  locale = "en"
): string {
  const then = typeof at === "string" ? new Date(at) : at;
  const elapsed = (now.getTime() - then.getTime()) / 1000;
  if (!Number.isFinite(elapsed)) {
    return "";
  }

  const format = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  for (const { unit, seconds } of STEPS) {
    if (elapsed >= seconds) {
      return format.format(-Math.floor(elapsed / seconds), unit);
    }
  }
  return format.format(0, "second");
}
