// The base calendar: one month as a grid of day buttons, with month and year selects and
// previous and next buttons. It renders the base primitives in the web theme. The shell
// module ships a twin in components/shell/calendar.tsx for the signed-in apps. The day
// classes are adapted from the coss ui calendar (MIT License, see NOTICE.md beside this
// file). The behaviour follows the WAI-ARIA APG date picker dialog: the grid has one
// tab stop, the arrow keys, PageUp, PageDown, Home and End move it, and Enter or Space
// picks the day. The logic is in lib/calendar.ts and lib/date-picker.ts.

import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import * as React from "react";
import { config } from "@repo/config";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/select";
import { datePicker as copy } from "@repo/ui/content/date-picker";
import {
  addMonths,
  firstDayOfWeek,
  formatDay,
  makeDay,
  monthGrid,
  monthNames,
  moveFocus,
  nextRange,
  parseDay,
  parseLimit,
  sameDay,
  sameMonth,
  startOfDay,
  startOfMonth,
  weekdayNames,
  isDisabled,
} from "@repo/ui/lib/calendar";
import type { DayRange, Weekday } from "@repo/ui/lib/calendar";
import {
  dayState,
  gridFocus,
  monthOutside,
  yearChoices,
} from "@repo/ui/lib/date-picker";
import { cn } from "@repo/ui/lib/utils";

const buttonClassNames =
  "relative flex size-(--cell-size) text-base sm:text-sm items-center justify-center rounded-lg text-foreground not-in-data-selected:hover:bg-accent disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0";

const dayButtonClassNames = cn(
  buttonClassNames,
  "in-[.range-middle]:in-data-selected:bg-accent in-data-selected:bg-primary in-[.range-middle]:in-data-selected:text-foreground in-data-disabled:text-muted-foreground/72 in-data-outside:text-muted-foreground/72 in-data-selected:in-data-outside:text-primary-foreground in-data-selected:text-primary-foreground focus-visible:ring-ring/50 outline-none focus-visible:z-1 focus-visible:ring-[3px] in-data-disabled:pointer-events-none in-data-disabled:line-through in-[.range-end:not(.range-start)]:rounded-s-none in-[.range-middle]:rounded-none in-[.range-start:not(.range-end)]:rounded-e-none in-[[data-selected]:not(.range-middle)]:transition-[border-radius,box-shadow]"
);

const todayClassNames =
  "*:after:pointer-events-none *:after:absolute *:after:bottom-1 *:after:start-1/2 *:after:z-1 *:after:size-[3px] *:after:-translate-x-1/2 *:after:rounded-full *:after:bg-primary [&[data-selected]:not(.range-middle)>*]:after:bg-background [&[data-disabled]>*]:after:bg-foreground/30";

const outsideClassNames =
  "text-muted-foreground data-selected:bg-accent/50 data-selected:text-muted-foreground";

/** The project's locale: the day names, the month names and the heading follow it. */
const LOCALE = config.app.locale;

const LONG_DAY = new Intl.DateTimeFormat(LOCALE, {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

const MONTH_HEADING = new Intl.DateTimeFormat(LOCALE, {
  month: "long",
  year: "numeric",
});

interface CalendarCommonProps {
  /** The first day that can be picked: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (its day counts). */
  min?: string;
  /** The last day that can be picked, in the same shapes as `min`. */
  max?: string;
  /** The shown month (any day in it). Pass with `onMonthChange` to control it. */
  month?: Date;
  /** The month shown first when `month` is not passed. Defaults to the value's month, else today's. */
  defaultMonth?: Date;
  /** Called with the 1st of the month whenever the shown month changes. */
  onMonthChange?: (month: Date) => void;
  /** Today, for the marker and the first focus. Defaults to the browser's today. */
  today?: Date;
  /**
   * The first day of the week, as `Date#getDay` numbers it (0 is Sunday, 1 is Monday).
   * Defaults to the week start of `config.app.locale` (lib/calendar.ts `firstDayOfWeek`).
   */
  weekStartsOn?: Weekday;
  className?: string;
}

export interface CalendarSingleProps extends CalendarCommonProps {
  mode?: "single";
  /** The picked day as `YYYY-MM-DD`, or `""`. */
  value: string;
  onSelect: (day: string) => void;
}

export interface CalendarRangeProps extends CalendarCommonProps {
  mode: "range";
  /** The picked range; either end may be `""`. */
  value: DayRange;
  /** Called with the range after the pick (lib/calendar.ts `nextRange`). */
  onSelect: (range: DayRange) => void;
}

export type CalendarProps = CalendarSingleProps | CalendarRangeProps;

export function Calendar(props: CalendarProps): React.ReactElement {
  const {
    min = "",
    max = "",
    month: monthProp,
    defaultMonth,
    onMonthChange,
    today: todayProp,
    weekStartsOn = firstDayOfWeek(LOCALE),
    className,
  } = props;
  // Each render reads the clock on purpose, so the today marker moves at midnight. The
  // value is a day, so two renders on one day agree. A test passes `today` to pin it.
  // oxlint-disable-next-line react/purity -- see above
  const today = startOfDay(todayProp ?? new Date());
  const bounds = React.useMemo(
    () => ({ min: parseLimit(min), max: parseLimit(max) }),
    [min, max]
  );
  const anchor =
    props.mode === "range"
      ? (parseDay(props.value.from) ?? parseDay(props.value.to))
      : parseDay(props.value);

  const [ownMonth, setOwnMonth] = React.useState(() =>
    startOfMonth(defaultMonth ?? anchor ?? today)
  );
  const shown = startOfMonth(monthProp ?? ownMonth);
  const [focusDay, setFocusDay] = React.useState<Date | null>(null);
  const active = gridFocus(shown, [focusDay, anchor, today], bounds);

  const gridRef = React.useRef<HTMLTableElement>(null);
  const focusPending = React.useRef(false);
  const headingId = React.useId();

  React.useEffect(() => {
    if (!focusPending.current) {
      return;
    }
    focusPending.current = false;
    gridRef.current
      ?.querySelector<HTMLButtonElement>(`[data-day="${formatDay(active)}"]`)
      ?.focus();
  });

  const show = (month: Date) => {
    const next = startOfMonth(month);
    if (sameMonth(next, shown)) {
      return;
    }
    if (monthProp === undefined) {
      setOwnMonth(next);
    }
    onMonthChange?.(next);
  };

  const pick = (day: Date) => {
    setFocusDay(day);
    show(day);
    const key = formatDay(day);
    if (props.mode === "range") {
      props.onSelect(nextRange(props.value, key));
    } else {
      props.onSelect(key);
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const next = moveFocus(active, event.key, {
      weekStartsOn,
      bounds,
      shiftKey: event.shiftKey,
    });
    if (!next) {
      return;
    }
    event.preventDefault();
    setFocusDay(next);
    show(next);
    focusPending.current = true;
  };

  const previous = addMonths(shown, -1);
  const following = addMonths(shown, 1);
  const years = yearChoices(shown, bounds, today);
  const months = monthNames(LOCALE, "short");
  const weekdays = weekdayNames(LOCALE, weekStartsOn, "short");
  const weekdaysLong = weekdayNames(LOCALE, weekStartsOn, "long");

  const showMonthOf = (year: number, monthIndex: number) => {
    const first = makeDay(year, monthIndex, 1);
    if (first) {
      setFocusDay(null);
      show(first);
    }
  };

  return (
    <div
      className={cn(
        "relative flex w-fit flex-col [--cell-size:--spacing(10)] sm:[--cell-size:--spacing(9)]",
        className
      )}
      data-slot="calendar"
    >
      <div className="absolute top-0 z-1 flex w-full justify-between">
        <button
          type="button"
          className={buttonClassNames}
          aria-label={copy.previousMonth}
          disabled={monthOutside(previous, bounds)}
          onClick={() => {
            setFocusDay(null);
            show(previous);
          }}
        >
          <ChevronLeftIcon className="rtl:rotate-180" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={buttonClassNames}
          aria-label={copy.nextMonth}
          disabled={monthOutside(following, bounds)}
          onClick={() => {
            setFocusDay(null);
            show(following);
          }}
        >
          <ChevronRightIcon className="rtl:rotate-180" aria-hidden="true" />
        </button>
      </div>
      <div className="relative z-2 mx-(--cell-size) mb-1 flex h-(--cell-size) items-center justify-center gap-1.5 px-1">
        <h2 id={headingId} className="sr-only" aria-live="polite">
          {MONTH_HEADING.format(shown)}
        </h2>
        <Select
          value={String(shown.getMonth())}
          items={months.map((name, index) => ({
            label: name,
            value: String(index),
          }))}
          onValueChange={(next) => {
            showMonthOf(shown.getFullYear(), Number(next));
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-auto min-w-0"
            aria-label={copy.monthLabel}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-24">
            {months.map((name, index) => (
              <SelectItem
                key={name}
                value={String(index)}
                disabled={monthOutside(
                  makeDay(shown.getFullYear(), index, 1) ?? shown,
                  bounds
                )}
              >
                {name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={String(shown.getFullYear())}
          items={years.map((year) => ({
            label: String(year),
            value: String(year),
          }))}
          onValueChange={(next) => {
            showMonthOf(Number(next), shown.getMonth());
          }}
        >
          <SelectTrigger
            size="sm"
            className="w-auto min-w-0"
            aria-label={copy.yearLabel}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="min-w-24">
            {years.map((year) => (
              <SelectItem key={year} value={String(year)}>
                {year}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {/* The APG date picker dialog draws its day grid as a table with role="grid", the
          one tab stop and the arrow keys above make it interactive. */}
      <table
        ref={gridRef}
        // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- see above
        role="grid"
        aria-labelledby={headingId}
        className="w-full border-collapse"
      >
        <thead>
          <tr className="flex">
            {weekdays.map((name, index) => (
              <th
                key={name}
                scope="col"
                abbr={weekdaysLong[index]}
                className="text-muted-foreground/72 flex size-(--cell-size) items-center justify-center p-0 text-xs font-medium"
              >
                {name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {monthGrid(shown, weekStartsOn).map((week) => (
            <tr key={week[0]?.key} className="flex w-full">
              {week.map((day) => {
                const state = dayState(props.value, day.key);
                const disabled = isDisabled(day.date, bounds);
                const isToday = sameDay(day.date, today);
                const isActive = sameDay(day.date, active);
                // The data attributes hold "true", as react-day-picker writes them: the
                // copied `in-data-selected:` classes match `[data-selected="true"]`.
                return (
                  <td
                    key={day.key}

                    aria-selected={state.selected}
                    className={cn(
                      "size-(--cell-size) py-px text-sm",
                      day.outside && outsideClassNames,
                      isToday && todayClassNames,
                      state.start && "range-start",
                      state.end && "range-end",
                      state.middle && "range-middle"
                    )}
                    data-disabled={disabled ? "true" : undefined}
                    data-outside={day.outside ? "true" : undefined}
                    data-selected={state.selected ? "true" : undefined}
                    data-today={isToday ? "true" : undefined}
                  >
                    <button
                      type="button"
                      className={dayButtonClassNames}
                      data-day={day.key}
                      tabIndex={isActive ? 0 : -1}
                      disabled={disabled}
                      aria-label={LONG_DAY.format(day.date)}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => {
                        pick(day.date);
                      }}
                      onKeyDown={onKeyDown}
                    >
                      {day.date.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
