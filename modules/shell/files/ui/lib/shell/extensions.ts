import type { ComponentType, ReactNode } from "react";

// The seam a module uses to add itself to every shell app without editing the shell.
//
// Each app holds its own list, in `src/components/shell-extensions.ts`:
//
//   export const shellExtensions = defineShellExtensions({ extensions: [] });
//
// and passes it to `ShellLayout`. A module ships a factory, such as `commandExtension()`,
// and the app's descriptor appends a bare call to it into the `extensions` array with a
// `plugin-array` patch. Keep the `extensions` property even while the array is empty:
// the patch has nothing to append into otherwise.
//
// This file imports only React's types, so it holds no state and no IO.

/**
 * One module's part of the shell. `Provider` wraps the whole layout; `header` renders in
 * the header's right slot, after the page path. In a list, the first entry is the
 * outermost provider and its header renders first.
 */
export interface ShellExtension {
  /** Unique within the list, for example the module name. */
  id: string;
  Provider: ComponentType<{ children: ReactNode }>;
  header?: ComponentType;
}

/**
 * Freeze an app's extension list. Two entries with one `id` throw here, at module load,
 * rather than mounting one module twice.
 */
export function defineShellExtensions({
  extensions,
}: {
  extensions: ShellExtension[];
}): readonly ShellExtension[] {
  const seen = new Set<string>();
  for (const extension of extensions) {
    if (seen.has(extension.id)) {
      throw new Error(
        `defineShellExtensions: two extensions share the id "${extension.id}".`
      );
    }
    seen.add(extension.id);
  }

  return Object.freeze([...extensions]);
}
