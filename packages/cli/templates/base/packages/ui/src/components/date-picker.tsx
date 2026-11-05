// The base date range picker. It takes and returns `YYYY-MM-DD` strings (`""` for an
// empty end): two labelled text fields, one calendar button that opens a range calendar
// for both, optional quick choices, and Clear. It renders the base primitives in the web
// theme. The shell module's components/shell/date-picker.tsx holds the same
// `DateRangePicker` for the signed-in apps, plus a single-day and a date-and-time picker
// that the base set does not ship.
//
// A person types a day (`5 Oct 2026`, `2026-10-05`, `5/10/2026`) or picks it from the
// calendar. The fields show and read days in `config.app.locale`, and the calendar starts
// its week on that locale's first weekday unless `weekStartsOn` says otherwise. Typed text applies on Enter or blur. Text that does not read as a day stays
// in the field, and the field reports it through `setCustomValidity`.

import { CalendarIcon } from "lucide-react";
import * as React from "react";
import { config } from "@repo/config";
import { Button } from "@repo/ui/components/button";
import { Calendar } from "@repo/ui/components/calendar";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@repo/ui/components/popover";
import { datePicker as copy } from "@repo/ui/content/date-picker";
import { quickRange } from "@repo/ui/lib/calendar";
import type { DayRange, QuickRangeId, Weekday } from "@repo/ui/lib/calendar";
import { gridTabStop, useDayField } from "@repo/ui/lib/date-field";
import {
  dayLimitText,
  quickChoiceIds,
  rangeLimits,
} from "@repo/ui/lib/date-picker";
import { cn } from "@repo/ui/lib/utils";

type FieldSize = "sm" | "default" | "lg";

/** The project's locale: the fields show and read days in it. */
const LOCALE = config.app.locale;

/** The text field's height for each size. The base `Input` has no size of its own. */
const FIELD_SIZE = {
  default: "h-8",
  lg: "h-10",
  sm: "h-7",
} as const;

/** The calendar button's size, square and as tall as the field. */
const CALENDAR_BUTTON_SIZE = {
  default: "size-8",
  lg: "size-10",
  sm: "size-7",
} as const;

/** The error line under a field. */
function FieldMessage({ id, message }: { id: string; message: string | null }) {
  if (message === null) {
    return null;
  }
  return (
    <p id={id} className="text-destructive text-xs">
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
    <div className={cn("flex min-w-0 flex-col gap-1.5", fieldClassName)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      <Input
        {...field.inputProps}
        id={id}
        className={FIELD_SIZE[size]}
        required={required}
        disabled={disabled}
        aria-describedby={field.message === null ? undefined : errorId}
        aria-invalid={field.message === null ? ariaInvalid : true}
      />
      <FieldMessage id={errorId} message={field.message} />
    </div>
  );
}

export interface DateRangePickerProps {
  /** The base id: the From field gets `<id>-from` and the To field `<id>-to`. */
  id?: string;
  /** The range as `YYYY-MM-DD` days; either end may be `""`. */
  value: DayRange;
  /**
   * Called with both ends after a grid pick, a quick choice, Clear, or a typed end on
   * Enter or blur. A first grid pick reports `{ from, to: "" }`.
   */
  onChange: (range: DayRange) => void;
  /** The first allowed day: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` (its day counts). */
  min?: string;
  /** The last allowed day, in the same shapes as `min`. */
  max?: string;
  required?: boolean;
  disabled?: boolean;
  /** The height of the fields and the calendar button. Defaults to "default". */
  size?: FieldSize;
  /** Marks both text fields invalid for an error the caller found. */
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
  /** The calendar button's accessible name. Defaults to "Open calendar". */
  calendarLabel?: string;
  className?: string;
  /** The From label. Defaults to "From". */
  fromLabel?: string;
  /** The To label. Defaults to "To". */
  toLabel?: string;
  /** Extra classes for both labels. */
  labelClassName?: string;
  /** Extra classes for each end's column, such as a width or `flex-1`. */
  fieldClassName?: string;
  /** Posts each end in a hidden input under these names. */
  fromName?: string;
  toName?: string;
  /** The quick choices beside the calendar: `true` for all four, or a list of them. */
  quickChoices?: boolean | readonly QuickRangeId[];
  /** Shows the Clear button while either end is set. Defaults to true. */
  clearable?: boolean;
  /** The calendar's first weekday (0 is Sunday). Defaults to the locale's week start. */
  weekStartsOn?: Weekday;
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
  weekStartsOn,
  calendarLabel = copy.openCalendar,
  className,
  "aria-invalid": ariaInvalid,
}: DateRangePickerProps): React.ReactElement {
  const autoId = React.useId();
  const base = id ?? autoId;
  const [open, setOpen] = React.useState(false);
  // The range while the calendar is open, so the second pick lands on the first even
  // when a caller ignores a half range.
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
      <div className="flex flex-col gap-1.5">
        <span aria-hidden="true" className="h-3.5" />
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
                  size="icon"
                  className={CALENDAR_BUTTON_SIZE[size]}
                  aria-label={calendarLabel}
                />
              }
            >
              <CalendarIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverContent
              ref={popupRef}
              align="end"
              className="w-auto p-2"
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
            </PopoverContent>
          </Popover>
          {clearable && (value.from !== "" || value.to !== "") ? (
            <Button
              variant="ghost"
              size={size === "sm" ? "sm" : "default"}
              className={size === "lg" ? "h-10" : undefined}
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
