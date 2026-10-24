// The J/K rule of ./data-table.tsx, JSX-free so `node --test` can load it.
//
// The highlight is the keyboard's place in the list. It is not the selection: J and K
// move it, and Enter turns it into the selection through the table's `onRowClick`.

/**
 * The row id the highlight moves to when J (`step` 1) or K (`step` -1) is pressed.
 *
 * `ids` are the rows in their displayed order, so the move follows the active sort. The
 * move starts at `highlightedId`, or at `selectedId` when nothing is highlighted, and
 * stops at either end rather than wrapping. With neither id in `ids` (nothing picked
 * yet, or a filter removed the row), J lands on the first row and K on the last. An
 * empty list gives `null`.
 */
export function stepHighlight(
  ids: readonly string[],
  highlightedId: string | null,
  selectedId: string | null,
  step: 1 | -1
): string | null {
  if (ids.length === 0) {
    return null;
  }

  const start = [highlightedId, selectedId]
    .map((id) => (id === null ? -1 : ids.indexOf(id)))
    .find((index) => index !== -1);

  if (start === undefined) {
    return step === 1 ? (ids[0] ?? null) : (ids.at(-1) ?? null);
  }

  const next = Math.min(Math.max(start + step, 0), ids.length - 1);
  return ids[next] ?? null;
}

/**
 * The controls that keep their own keys. A focused one outside the table takes Enter and
 * Escape (and J and K) for itself, so the table's keys stay off it.
 */
export const INTERACTIVE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  "summary",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="tab"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="combobox"]',
  '[role="slider"]',
  '[role="textbox"]',
].join(", ");

/** The part of a DOM element the focus rule reads, so a test can pass a plain object. */
export interface FocusTarget {
  closest: (selector: string) => unknown;
}

/**
 * Whether the table's keys (J, K, Enter, Escape) may act while `focused` has the focus.
 *
 * They act with nothing focused (the page body), with the focus anywhere inside the
 * table's own container, its row buttons and sort headers included, or with the focus on
 * an element outside the table that is not a control. A focused button, link, field or
 * ARIA widget outside the table keeps the key: Enter on the "Admins" chip presses the
 * chip, not the highlighted row. `container` is the table's root element, or `null`
 * before it mounts.
 */
export function tableKeysLive<T extends FocusTarget>(
  focused: T | null,
  container: { contains: (node: T) => boolean } | null
): boolean {
  if (focused === null) {
    return true;
  }
  if (container?.contains(focused) === true) {
    return true;
  }
  return focused.closest(INTERACTIVE_SELECTOR) === null;
}
