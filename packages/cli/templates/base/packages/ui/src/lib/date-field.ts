// The typed day field both picker sets share: the base picker
// (../components/date-picker.tsx) and the shell pickers (components/shell/date-picker.tsx,
// when the shell module is installed). It holds the text, the bad-text flag and the
// error, and applies the text on Enter or blur. It renders nothing, so each set wraps it
// in its own primitives. It is a React hook, so unlike ./calendar.ts and ./date-picker.ts
// it is not pure.

import * as React from "react";
import { datePicker as copy } from "@repo/ui/content/date-picker";
import { formatShown } from "@repo/ui/lib/calendar";
import { exampleDay, readTypedDay } from "@repo/ui/lib/date-picker";
import { interpolate } from "@repo/ui/lib/interpolate";

/** The selector for the calendar's one tab stop, which takes the focus when it opens. */
const GRID_TAB_STOP = '[role="grid"] button[tabindex="0"]';

/** The tab stop inside an open popup, or `true` to let the popover pick. */
export function gridTabStop(
  popup: React.RefObject<HTMLDivElement | null>
): HTMLElement | true {
  return popup.current?.querySelector<HTMLElement>(GRID_TAB_STOP) ?? true;
}

/**
 * The state of one typed day field: its text, its bad-text flag, the error it shows, its
 * hint and the handlers that apply the text. The text follows `value` whenever `value`
 * changes.
 */
export function useDayField({
  value,
  locale,
  onCommit,
  limitText,
  intercept,
}: {
  value: string;
  /** The BCP 47 tag the text is shown and read in: the pickers pass `config.app.locale`. */
  locale: string;
  onCommit: (day: string) => void;
  limitText: string | null;
  /** Reads the text first; the day it applied (a pasted date-and-time), or null. */
  intercept?: (text: string) => string | null;
}) {
  const [text, setText] = React.useState(() => formatShown(value, locale));
  const [seen, setSeen] = React.useState(value);
  const [bad, setBad] = React.useState(false);
  if (value !== seen) {
    setSeen(value);
    setText(formatShown(value, locale));
    setBad(false);
  }

  const ref = React.useRef<HTMLInputElement>(null);
  const example = exampleDay(locale);
  const message = bad
    ? interpolate(copy.errors.invalid, { example })
    : limitText;
  React.useEffect(() => {
    ref.current?.setCustomValidity(message ?? "");
  }, [message]);

  const dirty = text.trim() !== formatShown(value, locale);
  const commit = () => {
    const read = readTypedDay(text, value, locale);
    if (read.kind === "unchanged") {
      setBad(false);
      return;
    }
    if (read.kind === "empty") {
      setBad(false);
      onCommit("");
      return;
    }
    const handled = intercept?.(text.trim()) ?? null;
    if (handled !== null) {
      setBad(false);
      setText(formatShown(handled, locale));
      return;
    }
    if (read.kind === "bad") {
      setBad(true);
      return;
    }
    setBad(false);
    setText(formatShown(read.day, locale));
    onCommit(read.day);
  };

  return {
    message,
    inputProps: {
      ref,
      value: text,
      placeholder: interpolate(copy.placeholder, { example }),
      autoComplete: "off",
      spellCheck: false,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        setText(event.target.value);
      },
      onBlur: commit,
      onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
        // Enter applies typed text. With nothing new typed it goes through, so Enter
        // still submits the form the field sits in.
        if (event.key === "Enter" && dirty) {
          event.preventDefault();
          commit();
        }
      },
    },
  };
}

/** What `useDayField` returns. */
export type DayFieldState = ReturnType<typeof useDayField>;
