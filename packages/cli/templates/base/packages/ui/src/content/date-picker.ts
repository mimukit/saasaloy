// Every word the date pickers show: the base set (../components/calendar.tsx and
// ../components/date-picker.tsx) and the shell set (components/shell/calendar.tsx and
// components/shell/date-picker.tsx, when the shell module is installed). The pickers serve
// every screen, so nothing here names one. The shape rules of ./landing.ts apply:
// `{token}` placeholders, rendered with `interpolate()`.

export const datePicker = {
  // The calendar heading and its buttons.
  previousMonth: "Previous month",
  nextMonth: "Next month",
  monthLabel: "Month",
  yearLabel: "Year",
  // The icon button at the end of a date field.
  openCalendar: "Open calendar",
  // A hint inside an empty date field. `{example}` is 5 Oct 2026 as the field shows it in
  // `config.app.locale`: "5 Oct 2026" in en-GB, "Oct 5, 2026" in en.
  placeholder: "{example}",
  // The range picker.
  from: "From",
  to: "To",
  clear: "Clear",
  quickChoicesLabel: "Quick choices",
  quickChoices: {
    today: "Today",
    last7: "Last 7 days",
    last30: "Last 30 days",
    thisMonth: "This month",
  },
  // The time fields of a date-and-time picker.
  hour: "Hour",
  minute: "Minute",
  period: "AM or PM",
  am: "AM",
  pm: "PM",
  // `{time}` is a time as the fields show it: 5:30 PM.
  dayAndTime: "{day}, {time}",
  errors: {
    invalid: "Enter a date like {example}",
    early: "Pick a date on or after {day}",
    late: "Pick a date on or before {day}",
    timeEarly: "Pick a time on or after {when}",
    timeLate: "Pick a time on or before {when}",
  },
};
