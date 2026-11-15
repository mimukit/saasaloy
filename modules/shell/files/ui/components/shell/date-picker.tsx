// The shell date pickers: a day field (DatePicker), a From/To pair (DateRangePicker) and
// a day-and-time field (DateTimePicker). Each takes and returns the strings the native
// fields hold (`YYYY-MM-DD`, `YYYY-MM-DDTHH:mm`, `""` for empty), so a page can swap a
// native date field for one of these and its URL params and payloads keep their shape.
// The logic is in lib/calendar.ts, lib/date-picker.ts and lib/date-field.ts, which the
// base template ships.
//
// A day field is a text field with a calendar button at its end. A person types a day
// (`5 Oct 2026`, `2026-10-05`, `5/10/2026`) or picks it from the calendar. Typed text
// applies on Enter or blur. Text that does not read as a day stays in the field, and the
// field reports it through `setCustomValidity`, so `validity.valid` follows the rule and a
// form does not submit it. The fields show and read days in `config.app.locale`, and the
// calendar starts its week on that locale's first weekday unless `weekStartsOn` says
// otherwise.

import { CalendarIcon } from "lucide-react";
import * as React from "react";
import { config } from "@repo/config";
import { Button } from "@repo/ui/components/shell/button";
import { Calendar } from "@repo/ui/components/shell/calendar";
import { Input } from "@repo/ui/components/shell/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@repo/ui/components/shell/input-group";
import {
  Popover,
  PopoverPopup,
  PopoverTrigger,
} from "@repo/ui/components/shell/popover";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@repo/ui/components/shell/toggle-group";
import { datePicker as copy } from "@repo/ui/content/date-picker";
import {
  parseDateTime,
  quickRange,
  splitDateTime,
  stepHour,
  stepMinute,
  to12Hour,
  to24Hour,
} from "@repo/ui/lib/calendar";
import type {
  DayRange,
  Period,
  QuickRangeId,
  Weekday,
} from "@repo/ui/lib/calendar";
import {
  dateTimeLimitText,
  dayLimitText,
  fillTime,
  periodKey,
  quickChoiceIds,
  rangeLimits,
  readHour,
  readMinute,
  twoDigits,
} from "@repo/ui/lib/date-picker";
import { gridTabStop, useDayField } from "@repo/ui/lib/date-field";
import type { DayFieldState } from "@repo/ui/lib/date-field";
import { cn } from "@repo/ui/lib/utils";

type FieldSize = "sm" | "default" | "lg";

/** The project's locale: the fields show and read days in it. */
const LOCALE = config.app.locale;

/** The props every picker shares. */
interface PickerCommonProps {
  /** The first allowed value: a day `YYYY-MM-DD` or a time `YYYY-MM-DDTHH:mm`. */
  min?: string;
  /** The last allowed value, in the same shapes as `min`. */
  max?: string;
  required?: boolean;
  disabled?: boolean;
  size?: FieldSize;
  /** Marks the text field invalid for an error the caller found (a server error). */
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  /** The calendar button's accessible name. Defaults to "Open calendar". */
  calendarLabel?: string;
  /** The calendar's first weekday (0 is Sunday). Defaults to the locale's week start. */
  weekStartsOn?: Weekday;
  className?: string;
}

const CALENDAR_BUTTON_SIZE = {
  default: "icon",
  lg: "icon-lg",
  sm: "icon-sm",
} as const;

/** The error line under a field. */
function FieldMessage({ id, message }: { id: string; message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p id={id} className="text-destructive-foreground text-xs">
      {message}
    </p>
  );
}

/** The hidden input that posts the stored value under `name`, for a native form post. */
function HiddenValue({ name, value }: { name?: string; value: string }) {
  return name === undefined ? null : (
    <input type="hidden" name={name} value={value} />
  );
}

/** A day field with its calendar button and popover, shared by DatePicker and DateTimePicker. */
function DayField({
  id,
  day,
  onDay,
  field,
  errorId,
  min,
  max,
  required,
  disabled,
  size,
  ariaInvalid,
  ariaLabel,
  ariaDescribedBy,
  calendarLabel,
  weekStartsOn,
  className,
}: {
  id?: string;
  day: string;
  onDay: (day: string) => void;
  field: DayFieldState;
  errorId: string;
  min: string;
  max: string;
  required?: boolean;
  disabled?: boolean;
  size: FieldSize;
  ariaInvalid?: React.AriaAttributes["aria-invalid"];
  ariaLabel?: string;
  ariaDescribedBy?: string;
  calendarLabel: string;
  weekStartsOn?: Weekday;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const describedBy =
    [ariaDescribedBy, field.message === null ? undefined : errorId]
      .filter(Boolean)
      .join(" ") || undefined;

  return (
    <InputGroup className={className}>
      <InputGroupInput
        {...field.inputProps}
        id={id}
        size={size}
        required={required}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-describedby={describedBy}
        aria-invalid={field.message === null ? ariaInvalid : true}
      />
      <InputGroupAddon align="inline-end">
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            disabled={disabled}
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={calendarLabel}
              />
            }
          >
            <CalendarIcon aria-hidden="true" />
          </PopoverTrigger>
          <PopoverPopup
            ref={popupRef}
            align="end"
            initialFocus={() => gridTabStop(popupRef)}
          >
            <Calendar
              value={day}
              weekStartsOn={weekStartsOn}
              min={min}
              max={max}
              onSelect={(picked) => {
                onDay(picked);
                setOpen(false);
              }}
            />
          </PopoverPopup>
        </Popover>
      </InputGroupAddon>
    </InputGroup>
  );
}

export interface DatePickerProps extends PickerCommonProps {
  /** The text field's id, so a `<Label htmlFor>` or a `FieldLabel` names it. */
  id?: string;
  /** Posts the stored value (`YYYY-MM-DD`) in a hidden input under this name. */
  name?: string;
  /** The day as `YYYY-MM-DD`, or `""`. */
  value: string;
  /** Called with `YYYY-MM-DD` or `""` after a pick, Enter, or blur. */
  onChange: (value: string) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** One day: a text field and a calendar button. The popover closes on a pick. */
export function DatePicker({
  id,
  name,
  value,
  onChange,
  min = "",
  max = "",
  required,
  disabled,
  size = "default",
  calendarLabel = copy.openCalendar,
  weekStartsOn,
  className,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: DatePickerProps): React.ReactElement {
  const errorId = React.useId();
  const field = useDayField({
    value,
    locale: LOCALE,
    onCommit: onChange,
    limitText: dayLimitText(value, { min, max }, LOCALE),
  });

  return (
    <div
      className={cn("flex w-full flex-col gap-1", className)}
      data-slot="date-picker"
    >
      <DayField
        id={id}
        day={value}
        onDay={onChange}
        field={field}
        errorId={errorId}
        min={min}
        max={max}
        required={required}
        disabled={disabled}
        size={size}
        ariaInvalid={ariaInvalid}
        ariaLabel={ariaLabel}
        ariaDescribedBy={ariaDescribedBy}
        calendarLabel={calendarLabel}
        weekStartsOn={weekStartsOn}
      />
      <FieldMessage id={errorId} message={field.message} />
      <HiddenValue name={name} value={value} />
    </div>
  );
}

/** One end of a range: its label, its text field and its error line. */
function RangeEnd({
  id,
  label,
  labelClassName,
  value,
  onCommit,
  limitText,
  required,
  disabled,
  size,
  ariaInvalid,
  fieldClassName,
}: {
  id: string;
  label: string;
  labelClassName?: string;
  value: string;
  onCommit: (day: string) => void;
  limitText: string | null;
  required?: boolean;
  disabled?: boolean;
  size: FieldSize;
  ariaInvalid?: React.AriaAttributes["aria-invalid"];
  fieldClassName?: string;
}) {
  const errorId = `${id}-error`;
  const field = useDayField({ value, locale: LOCALE, onCommit, limitText });
  return (
    <div className={cn("flex min-w-0 flex-col gap-1", fieldClassName)}>
      <label
        htmlFor={id}
        className={cn(
          "text-foreground text-base/4.5 font-medium sm:text-sm/4",
          labelClassName
        )}
      >
        {label}
      </label>
      <Input
        {...field.inputProps}
        nativeInput
        id={id}
        size={size}
        required={required}
        disabled={disabled}
        aria-describedby={field.message === null ? undefined : errorId}
        aria-invalid={field.message === null ? ariaInvalid : true}
      />
      <FieldMessage id={errorId} message={field.message} />
    </div>
  );
}

export interface DateRangePickerProps extends PickerCommonProps {
  /** The base id: the From field gets `<id>-from` and the To field `<id>-to`. */
  id?: string;
  /** The range as `YYYY-MM-DD` days; either end may be `""`. */
  value: DayRange;
  /**
   * Called with both ends after a grid pick, a quick choice, Clear, or a typed end on
   * Enter or blur. A first grid pick reports `{ from, to: "" }`.
   */
  onChange: (range: DayRange) => void;
  /** The From label. Defaults to "From". */
  fromLabel?: string;
  /** The To label. Defaults to "To". */
  toLabel?: string;
  /** Extra classes for both labels, such as `text-xs text-muted-foreground`. */
  labelClassName?: string;
  /** Extra classes for each end's column, such as a width (`w-38`). */
  fieldClassName?: string;
  /** Posts each end in a hidden input under these names. */
  fromName?: string;
  toName?: string;
  /** The quick choices beside the calendar: `true` for all four, or a list of them. */
  quickChoices?: boolean | readonly QuickRangeId[];
  /** Shows the Clear button while either end is set. Defaults to true. */
  clearable?: boolean;
}

/**
 * A From/To pair: two labelled text fields, one calendar button that opens a range
 * calendar for both, optional quick choices, and Clear. Every change reports both ends.
 */
export function DateRangePicker({
  id,
  value,
  onChange,
  min = "",
  max = "",
  required,
  disabled,
  size = "default",
  fromLabel = copy.from,
  toLabel = copy.to,
  labelClassName,
  fieldClassName,
  fromName,
  toName,
  quickChoices = false,
  clearable = true,
  calendarLabel = copy.openCalendar,
  weekStartsOn,
  className,
  "aria-invalid": ariaInvalid,
}: DateRangePickerProps): React.ReactElement {
  const autoId = React.useId();
  const base = id ?? autoId;
  const [open, setOpen] = React.useState(false);
  // The range while the calendar is open. A caller that ignores a half range (a filter
  // that keeps both ends set) still sees the second pick land on the first.
  const [draft, setDraft] = React.useState<DayRange>(value);
  const popupRef = React.useRef<HTMLDivElement>(null);
  const limits = rangeLimits(value, { min, max });
  const choices = quickChoiceIds(quickChoices);

  const apply = (next: DayRange) => {
    setDraft(next);
    onChange(next);
  };

  return (
    <div
      className={cn("flex flex-wrap items-start gap-2", className)}
      data-slot="date-range-picker"
    >
      <RangeEnd
        id={`${base}-from`}
        label={fromLabel}
        labelClassName={labelClassName}
        value={value.from}
        onCommit={(from) => {
          onChange({ from, to: value.to });
        }}
        limitText={dayLimitText(value.from, limits.from, LOCALE)}
        required={required}
        disabled={disabled}
        size={size}
        ariaInvalid={ariaInvalid}
        fieldClassName={fieldClassName}
      />
      <RangeEnd
        id={`${base}-to`}
        label={toLabel}
        labelClassName={labelClassName}
        value={value.to}
        onCommit={(to) => {
          onChange({ from: value.from, to });
        }}
        limitText={dayLimitText(value.to, limits.to, LOCALE)}
        required={required}
        disabled={disabled}
        size={size}
        ariaInvalid={ariaInvalid}
        fieldClassName={fieldClassName}
      />
      {/* The buttons sit on the fields' row: a spacer the height of a label lines them up. */}
      <div className="flex flex-col gap-1">
        <span aria-hidden="true" className="h-4.5 sm:h-4" />
        <div className="flex items-center gap-1">
          <Popover
            open={open}
            onOpenChange={(next) => {
              if (next) {
                setDraft(value);
              }
              setOpen(next);
            }}
          >
            <PopoverTrigger
              disabled={disabled}
              render={
                <Button
                  variant="outline"
                  size={CALENDAR_BUTTON_SIZE[size]}
                  aria-label={calendarLabel}
                />
              }
            >
              <CalendarIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverPopup
              ref={popupRef}
              align="end"
              initialFocus={() => gridTabStop(popupRef)}
            >
              <div className="flex flex-col gap-2 sm:flex-row">
                {choices.length > 0 ? (
                  <div
                    role="group"
                    aria-label={copy.quickChoicesLabel}
                    className="flex flex-row flex-wrap gap-1 border-b pb-2 sm:flex-col sm:border-e sm:border-b-0 sm:pe-2 sm:pb-0"
                  >
                    {choices.map((choice) => (
                      <Button
                        key={choice}
                        variant="ghost"
                        size="sm"
                        className="justify-start"
                        onClick={() => {
                          apply(quickRange(choice, new Date()));
                          setOpen(false);
                        }}
                      >
                        {copy.quickChoices[choice]}
                      </Button>
                    ))}
                  </div>
                ) : null}
                <Calendar
                  mode="range"
                  value={draft}
                  weekStartsOn={weekStartsOn}
                  min={min}
                  max={max}
                  onSelect={(next) => {
                    apply(next);
                    if (next.from !== "" && next.to !== "") {
                      setOpen(false);
                    }
                  }}
                />
              </div>
            </PopoverPopup>
          </Popover>
          {clearable && (value.from !== "" || value.to !== "") ? (
            <Button
              variant="ghost"
              size={size === "sm" ? "sm" : "default"}
              disabled={disabled}
              onClick={() => {
                apply({ from: "", to: "" });
              }}
            >
              {copy.clear}
            </Button>
          ) : null}
        </div>
      </div>
      <HiddenValue name={fromName} value={value.from} />
      <HiddenValue name={toName} value={value.to} />
    </div>
  );
}

export interface DateTimePickerProps extends PickerCommonProps {
  /** The date text field's id, so a `<Label htmlFor>` or a `FieldLabel` names it. */
  id?: string;
  /** Posts the stored value (`YYYY-MM-DDTHH:mm`) in a hidden input under this name. */
  name?: string;
  /** The time as `YYYY-MM-DDTHH:mm` in local time, or `""`. */
  value: string;
  /** Called with `YYYY-MM-DDTHH:mm` or `""` whenever the day, hour, minute or period changes. */
  onChange: (value: string) => void;
  "aria-label"?: string;
  "aria-describedby"?: string;
}

/** The time fields' texts for a stored value. */
function timeTexts(value: string): {
  hour: string;
  minute: string;
  period: Period | null;
} {
  const time = to12Hour(splitDateTime(value).time);
  return time
    ? {
        hour: twoDigits(time.hour),
        minute: twoDigits(time.minute),
        period: time.period,
      }
    : { hour: "", minute: "", period: null };
}

/** The 24-hour time the fields hold, or `""` while the hour is not a real hour. */
function timeOf(hourText: string, minuteText: string, period: Period): string {
  const hour = readHour(hourText);
  if (hour === null) {
    return "";
  }
  return to24Hour({ hour, minute: readMinute(minuteText) ?? 0, period });
}

/**
 * A day and a time: the day field and its calendar button, then the hour, the minute and
 * AM/PM inline. The value stays 24-hour `YYYY-MM-DDTHH:mm`. A day picked with no time set
 * takes midnight, or the limit's time when the day holds `min` or `max`. A value outside
 * `min` or `max` (to the minute) is reported on the day field, which names the time.
 */
export function DateTimePicker({
  id,
  name,
  value,
  onChange,
  min = "",
  max = "",
  required,
  disabled,
  size = "default",
  calendarLabel = copy.openCalendar,
  weekStartsOn,
  className,
  "aria-invalid": ariaInvalid,
  "aria-label": ariaLabel,
  "aria-describedby": ariaDescribedBy,
}: DateTimePickerProps): React.ReactElement {
  const errorId = React.useId();
  const { day } = splitDateTime(value);
  const limits = { min, max };

  const [texts, setTexts] = React.useState(() => timeTexts(value));
  const [period, setPeriod] = React.useState<Period>(
    () => timeTexts(value).period ?? "AM"
  );
  const [seen, setSeen] = React.useState(value);
  const [emitted, setEmitted] = React.useState<string | null>(null);
  if (value !== seen) {
    setSeen(value);
    // A value this field sent keeps the texts as typed; any other value resets them.
    if (value !== emitted) {
      const next = timeTexts(value);
      setTexts(next);
      setPeriod(next.period ?? period);
    }
  }

  const emit = (nextDay: string, time: string) => {
    let next = "";
    if (nextDay !== "") {
      next = time === "" ? fillTime(nextDay, limits) : `${nextDay}T${time}`;
    }
    if (time === "" && next !== "") {
      const filled = timeTexts(next);
      setTexts(filled);
      setPeriod(filled.period ?? period);
    }
    setEmitted(next);
    if (next !== value) {
      onChange(next);
    }
  };

  const field = useDayField({
    value: day,
    locale: LOCALE,
    onCommit: (nextDay) => {
      emit(nextDay, timeOf(texts.hour, texts.minute, period));
    },
    limitText: dateTimeLimitText(value, limits, LOCALE),
    intercept: (text) => {
      // A pasted `2026-10-05T09:30` sets the day and the time at once.
      const parsed = parseDateTime(text);
      if (!parsed) {
        return null;
      }
      const { day: pastedDay, time } = splitDateTime(text);
      const next = timeTexts(text);
      setTexts(next);
      setPeriod(next.period ?? period);
      emit(pastedDay, time.slice(0, 5));
      return pastedDay;
    },
  });

  const setTime = (
    nextTexts: { hour: string; minute: string },
    nextPeriod: Period
  ) => {
    setTexts({ ...nextTexts, period: nextPeriod });
    setPeriod(nextPeriod);
    const time = timeOf(nextTexts.hour, nextTexts.minute, nextPeriod);
    if (day !== "" && time !== "") {
      emit(day, time);
    }
  };

  const timeKeys =
    (part: "hour" | "minute") =>
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      const set = periodKey(event.key);
      if (set !== null && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setTime(texts, set);
        return;
      }
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 1 : -1;
      if (part === "hour") {
        const hour = stepHour(readHour(texts.hour) ?? 12, delta);
        setTime({ ...texts, hour: twoDigits(hour) }, period);
      } else {
        const minute = stepMinute(readMinute(texts.minute) ?? 0, delta);
        setTime(
          {
            hour: texts.hour === "" ? "12" : texts.hour,
            minute: twoDigits(minute),
          },
          period
        );
      }
    };

  const timeBlur = (part: "hour" | "minute") => () => {
    const read = part === "hour" ? readHour : readMinute;
    const number = read(texts[part]);
    const stored = timeTexts(value)[part];
    setTexts({
      ...texts,
      [part]: number === null ? stored : twoDigits(number),
    });
  };

  const timeClassName = cn(
    "w-11 [&_input]:text-center [&_input]:tabular-nums",
    size === "sm" && "w-10"
  );

  return (
    <div
      className={cn("flex w-full flex-col gap-1", className)}
      data-slot="date-time-picker"
    >
      <div className="flex w-full flex-wrap items-center gap-2">
        <DayField
          id={id}
          day={day}
          onDay={(nextDay) => {
            emit(nextDay, timeOf(texts.hour, texts.minute, period));
          }}
          field={field}
          errorId={errorId}
          min={min}
          max={max}
          required={required}
          disabled={disabled}
          size={size}
          ariaInvalid={ariaInvalid}
          ariaLabel={ariaLabel}
          ariaDescribedBy={ariaDescribedBy}
          calendarLabel={calendarLabel}
          weekStartsOn={weekStartsOn}
          className="w-auto min-w-40 flex-1"
        />
        <div className="flex items-center gap-1">
          <Input
            nativeInput
            size={size}
            className={timeClassName}
            inputMode="numeric"
            maxLength={2}
            autoComplete="off"
            placeholder="--"
            aria-label={copy.hour}
            required={required}
            disabled={disabled}
            value={texts.hour}
            onChange={(event) => {
              setTime(
                {
                  ...texts,
                  hour: event.target.value.replaceAll(/\D/g, "").slice(0, 2),
                },
                period
              );
            }}
            onKeyDown={timeKeys("hour")}
            onBlur={timeBlur("hour")}
          />
          <span aria-hidden="true" className="text-muted-foreground">
            :
          </span>
          <Input
            nativeInput
            size={size}
            className={timeClassName}
            inputMode="numeric"
            maxLength={2}
            autoComplete="off"
            placeholder="--"
            aria-label={copy.minute}
            required={required}
            disabled={disabled}
            value={texts.minute}
            onChange={(event) => {
              setTime(
                {
                  ...texts,
                  minute: event.target.value.replaceAll(/\D/g, "").slice(0, 2),
                },
                period
              );
            }}
            onKeyDown={timeKeys("minute")}
            onBlur={timeBlur("minute")}
          />
          <ToggleGroup
            variant="outline"
            size={size}
            aria-label={copy.period}
            disabled={disabled}
            value={[period]}
            onValueChange={(next) => {
              const picked: unknown = next[0];
              if (picked === "AM" || picked === "PM") {
                setTime(texts, picked);
              }
            }}
          >
            <ToggleGroupItem value="AM">{copy.am}</ToggleGroupItem>
            <ToggleGroupItem value="PM">{copy.pm}</ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
      <FieldMessage id={errorId} message={field.message} />
      <HiddenValue name={name} value={value} />
    </div>
  );
}
