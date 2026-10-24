// The ids and default shortcuts of the commands the shell declares itself: the sidebar
// toggle in `SidebarProvider` and the four row keys in `DataTable`. They live in this
// React-free file so the apps' repo tests can run the shipped key map through the
// `command` module's conflict check (`findConflicts`) with the same values the components
// bind. Change a key here, not in sidebar.tsx or data-table.tsx.

/** The `global` command `SidebarProvider` declares. */
export const SIDEBAR_KEYS = {
  toggle: { id: "shell.toggle-sidebar", shortcut: "Mod+B" },
} as const;

/** The `data-table` commands every mounted `DataTable` declares. */
export const TABLE_KEYS = {
  nextRow: { id: "shell.table-next-row", shortcut: "J" },
  previousRow: { id: "shell.table-previous-row", shortcut: "K" },
  openRow: { id: "shell.table-open-row", shortcut: "Enter" },
  clearHighlight: { id: "shell.table-clear-highlight", shortcut: "Escape" },
} as const;
