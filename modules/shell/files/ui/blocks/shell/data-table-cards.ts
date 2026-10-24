// The card slot rule for DataTable below `md`, kept free of JSX and React so a plain
// `node --test` run can load it. DataTable imports it; nothing else needs to.
//
// A card has three places for a column: the title row's left side, the title row's right
// side, and the label and value lines under it. A column picks one with its `card` hint,
// or leaves the choice to the rule below.

/** Where a column goes in a card. `hidden` keeps it out of the card entirely. */
export type CardSlot = "title" | "trailing" | "line" | "hidden";

/** The part of a column the rule reads. DataTableColumn satisfies it. */
export interface CardSlotColumn {
  id: string;
  card?: CardSlot;
}

export interface CardSlots<TColumn> {
  title: TColumn[];
  trailing: TColumn[];
  lines: TColumn[];
}

/**
 * Sort `columns` into the card's slots, each slot in column order.
 *
 * An explicit hint always wins. With no column hinted `title`, the first column becomes
 * the title, so a page that sets no hints still gets a heading on every card. Every other
 * unhinted column is a line. `hidden` columns appear in no slot.
 */
export function cardSlots<TColumn extends CardSlotColumn>(
  columns: readonly TColumn[]
): CardSlots<TColumn> {
  const hasTitle = columns.some((column) => column.card === "title");
  const slots: CardSlots<TColumn> = { title: [], trailing: [], lines: [] };

  for (const [index, column] of columns.entries()) {
    const slot = column.card ?? (!hasTitle && index === 0 ? "title" : "line");

    if (slot === "title") {
      slots.title.push(column);
    } else if (slot === "trailing") {
      slots.trailing.push(column);
    } else if (slot === "line") {
      slots.lines.push(column);
    }
  }

  return slots;
}
