import { config } from "@repo/config";
import {
  formatDateTime,
  formatShown,
  splitDateTime,
} from "@repo/ui/lib/calendar";
import { formatShownTime } from "@repo/ui/lib/date-picker";

// Every date the shop screens show goes through the shell's own formatters, the ones the
// date pickers use, in the project's locale: a day reads "5 Oct 2026", a time "2:30 PM".
// A day and a time are joined with a comma and a space, so they never run together.

const LOCALE = config.app.locale;

/** The project's locale, for the number and money formats beside the dates. */
export const SHOP_LOCALE = LOCALE;

/** A day as the date fields show it: "17 Nov 2026" in `en-GB`. Empty for a bad value. */
export function shownDay(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  return Number.isNaN(date.getTime()) ? "" : formatShown(date, LOCALE);
}

/** A day and a time: "17 Nov 2026, 2:30 PM". Empty for a bad value. */
export function shownDateTime(value: string | Date): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const { time } = splitDateTime(formatDateTime(date));
  return `${formatShown(date, LOCALE)}, ${formatShownTime(time)}`;
}
