import { defineShellExtensions } from "@repo/ui/lib/shell/extensions";

// The modules this app adds to its shell. app-shell.tsx hands the list to ShellLayout,
// which wraps the layout in each entry's Provider (the first entry outermost) and renders
// each entry's header after the page path. With the list empty, the shell renders exactly
// as it would with no list at all.
//
// A module adds itself here, not by hand: its descriptor carries a `plugin-array` patch
// that appends a bare factory call, such as `commandExtension()`, into `extensions`, with
// the import above it. Keep the `extensions` property even while the array is empty; the
// patch has nothing to append into otherwise.
export const shellExtensions = defineShellExtensions({ extensions: [] });
