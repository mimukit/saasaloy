// The "Updated 12s ago" text a page header shows at the end of its status line. The page
// passes when its data last arrived; the header redraws the text every few seconds, and a
// click refetches.
//
// Pure, so the steps are unit-tested without a clock.

/** The words, with `{n}` where the number goes. The app's content file holds them. */
export interface UpdatedWords {
  justNow: string;
  seconds: string;
  minutes: string;
  hours: string;
}

/** The words with `{n}` swapped for the number. Local, so this file imports nothing. */
function withCount(template: string, n: number): string {
  return template.replaceAll("{n}", String(n));
}

/** How often the header redraws the text. */
export const UPDATED_TICK_MS = 5000;

/**
 * "Updated just now" under 10 s, then seconds under a minute, minutes under an hour, and
 * hours after. A time in the future (a clock that moved) reads as just now.
 */
export function updatedLabel(
  at: number,
  now: number,
  words: UpdatedWords
): string {
  const seconds = Math.floor((now - at) / 1000);
  if (seconds < 10) {
    return words.justNow;
  }
  if (seconds < 60) {
    return withCount(words.seconds, seconds);
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return withCount(words.minutes, minutes);
  }
  return withCount(words.hours, Math.floor(minutes / 60));
}
