/** The calendar day in `timeZone`, such as `Tuesday, 2026-11-24`. */
function dayOf(now: Date, timeZone: string): string {
  const part = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, ...options }).format(now);
  return `${part({ weekday: "long" })}, ${part({ year: "numeric", month: "2-digit", day: "2-digit" })}`;
}

/**
 * Today's date for the model, such as `Today is Tuesday, 2026-11-24 in Dhaka`, with no full
 * stop, so the feature adds its own reading rules after it. Put it last in a system prompt:
 * it changes once a day, and a prompt cache keeps everything before it.
 */
export function dayLine(now: Date, timeZone: string, label: string): string {
  return `Today is ${dayOf(now, timeZone)} in ${label}`;
}

/**
 * Text a person typed, such as a product title, as the model reads it: under an `untrusted`
 * key, which the system prompt names as data and never as instructions.
 */
export function untrusted(text: string | null): { untrusted: string } | null {
  return text === null ? null : { untrusted: text };
}
