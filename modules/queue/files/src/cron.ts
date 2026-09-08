import { QueueError } from "./provider";

// A five-field cron matcher, written out rather than pulled in, because the core has
// zero runtime dependencies and this is the whole of what a minute-resolution schedule
// needs: does this expression match this minute?
//
// Supported per field: `*`, a number, a `a-b` range, a `a,b,c` list, and a `*/n` or
// `a-b/n` step. Not supported: named months and weekdays, `?`, `L`, `W`, `#`, and the
// seconds and year fields some cron dialects add. An unsupported token is rejected at
// `defineSchedule`, when a developer is looking at it, rather than silently never firing.

interface FieldSpec {
  readonly label: string;
  readonly min: number;
  readonly max: number;
}

const MINUTE: FieldSpec = { label: "minute", max: 59, min: 0 };
const HOUR: FieldSpec = { label: "hour", max: 23, min: 0 };
const DAY_OF_MONTH: FieldSpec = { label: "day-of-month", max: 31, min: 1 };
const MONTH: FieldSpec = { label: "month", max: 12, min: 1 };
const DAY_OF_WEEK: FieldSpec = { label: "day-of-week", max: 7, min: 0 };

/** One parsed expression: the set of allowed values for each of the five fields. */
export interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
  /** True when the field was `*`, which decides the day-of-month / day-of-week rule. */
  dayOfMonthAny: boolean;
  dayOfWeekAny: boolean;
}

/**
 * Parse a five-field expression, or throw `QueueError("invalid_job")` naming the field
 * and the token that failed.
 */
export function parseCron(expression: string): ParsedCron {
  const parts = expression.trim().split(/\s+/);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  if (
    parts.length !== 5 ||
    minute === undefined ||
    hour === undefined ||
    dayOfMonth === undefined ||
    month === undefined ||
    dayOfWeek === undefined
  ) {
    throw invalid(
      `Cron expression "${expression}" has ${parts.length} fields; five are required ` +
        "(minute hour day-of-month month day-of-week)."
    );
  }

  return {
    dayOfMonth: parseField(dayOfMonth, DAY_OF_MONTH),
    dayOfMonthAny: dayOfMonth === "*",
    dayOfWeek: parseField(dayOfWeek, DAY_OF_WEEK),
    dayOfWeekAny: dayOfWeek === "*",
    hour: parseField(hour, HOUR),
    minute: parseField(minute, MINUTE),
    month: parseField(month, MONTH),
  };
}

/**
 * Does this expression fire at this instant? The date is read in UTC and truncated to
 * the minute, because that is the resolution a cron tick has and the zone every
 * platform scheduler we target runs in.
 */
export function matchesCron(expression: string, at: Date): boolean {
  return matchesParsed(parseCron(expression), at);
}

/** `matchesCron` against an already-parsed expression, for a matcher in a hot loop. */
export function matchesParsed(cron: ParsedCron, at: Date): boolean {
  if (!cron.minute.has(at.getUTCMinutes())) {
    return false;
  }
  if (!cron.hour.has(at.getUTCHours())) {
    return false;
  }
  if (!cron.month.has(at.getUTCMonth() + 1)) {
    return false;
  }

  const dom = cron.dayOfMonth.has(at.getUTCDate());
  const dow = cron.dayOfWeek.has(at.getUTCDay());

  // Cron's one genuine oddity, kept because every other implementation has it: when both
  // day fields are restricted the match is a union, not an intersection, so
  // `0 0 1 * 1` fires on the first of the month *and* on every Monday. When one field is
  // `*` it stops contributing and the other one decides alone.
  if (cron.dayOfMonthAny) {
    return dow;
  }
  if (cron.dayOfWeekAny) {
    return dom;
  }
  return dom || dow;
}

function parseField(token: string, spec: FieldSpec): Set<number> {
  const values = new Set<number>();

  for (const term of token.split(",")) {
    if (term === "") {
      throw invalid(`Empty ${spec.label} term in "${token}".`);
    }

    const [range, stepText, ...extra] = term.split("/");
    if (extra.length > 0 || range === undefined) {
      throw invalid(`Malformed ${spec.label} term "${term}".`);
    }

    let step = 1;
    if (stepText !== undefined) {
      step = toInt(stepText, spec, term);
      if (step < 1) {
        throw invalid(
          `Step must be 1 or more in ${spec.label} term "${term}".`
        );
      }
    }

    let start: number;
    let end: number;
    if (range === "*") {
      start = spec.min;
      end = spec.max;
    } else if (range.includes("-")) {
      const [low, high, ...rest] = range.split("-");
      if (low === undefined || high === undefined || rest.length > 0) {
        throw invalid(`Malformed ${spec.label} range "${term}".`);
      }
      start = toInt(low, spec, term);
      end = toInt(high, spec, term);
      if (start > end) {
        throw invalid(
          `Descending ${spec.label} range "${term}"; write it low-high.`
        );
      }
    } else {
      start = toInt(range, spec, term);
      // A bare number with a step means "from here to the end of the field", the way
      // `5/10` does in vixie cron. A bare number with no step is just itself.
      end = stepText === undefined ? start : spec.max;
    }

    for (let value = start; value <= end; value += step) {
      values.add(normalize(value, spec));
    }
  }

  return values;
}

function toInt(text: string, spec: FieldSpec, term: string): number {
  if (!/^\d+$/.test(text)) {
    throw invalid(
      `"${text}" is not a number in ${spec.label} term "${term}". Named months and ` +
        "weekdays, `?`, `L`, `W` and `#` are not supported."
    );
  }
  const value = Number(text);
  if (value < spec.min || value > spec.max) {
    throw invalid(
      `${value} is out of range for ${spec.label} (${spec.min}-${spec.max}) in "${term}".`
    );
  }
  return value;
}

/** Sunday is both 0 and 7 in every cron dialect; store it as 0 so `getUTCDay` matches. */
function normalize(value: number, spec: FieldSpec): number {
  return spec.label === "day-of-week" && value === 7 ? 0 : value;
}

function invalid(message: string): QueueError {
  return new QueueError("invalid_job", message);
}
