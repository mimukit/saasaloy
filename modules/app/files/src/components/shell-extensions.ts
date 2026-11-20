import { defineShellExtensions } from "@repo/ui/lib/shell/extensions";
import { appShellExtensions } from "./shell-extensions.generated";

// The modules this app adds to its shell. app-shell.tsx hands the list to ShellLayout,
// which wraps the layout in each entry's Provider (the first entry outermost) and renders
// each entry's header after the page path. With the list empty, the shell renders exactly
// as it would with no list at all.
//
// A module adds itself here, not by hand: its descriptor adds a `app.shellExtensions`
// row that names a bare factory call, such as `commandExtension()`, and the CLI writes it
// into `./shell-extensions.generated.ts`. An extension of your own goes after the spread.
export const shellExtensions = defineShellExtensions({
  extensions: [...appShellExtensions],
});
