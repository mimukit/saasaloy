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
