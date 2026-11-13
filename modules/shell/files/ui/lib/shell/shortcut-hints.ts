import type { PendingShortcut } from "./commands";

// The sidebar's half of the key hints, free of React so a test can call it; the type
// import above is erased. shell-sidebar.tsx reads what it returns.

/** The hints split between the sidebar rows and the foot of the rows. */
export interface SidebarHints {
  /** The hint for each row shortcut the sequence in progress reaches, by shortcut. */
  rows: ReadonlyMap<string, PendingShortcut>;
  /** The hints no row shows, such as "Go to New order", listed beside the footer. */
  offSidebar: readonly PendingShortcut[];
}

/** Split `pending` into the hints a row shows and the ones no row has. */
export function sidebarHints(
  rowShortcuts: readonly (string | undefined)[],
  pending: readonly PendingShortcut[]
): SidebarHints {
  const onSidebar = new Set(rowShortcuts);
  const rows = new Map<string, PendingShortcut>();
  const offSidebar: PendingShortcut[] = [];
  for (const entry of pending) {
    if (onSidebar.has(entry.shortcut)) {
      rows.set(entry.shortcut, entry);
    } else {
      offSidebar.push(entry);
    }
  }
  return { rows, offSidebar };
}
