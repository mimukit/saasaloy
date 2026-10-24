import type { LucideIcon } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Context } from "react";

// Relative, not `@repo/ui/lib/...`: the helpers are a React-free `.ts` file so
// `node --test` can load them, and the test runner resolves no workspace alias.
import { commandsKey, delegateToLatest } from "./command-registration";

// The command contract every screen codes against. A route, a block or a module declares
// what it can do through `useCommands`, and something else decides how a person reaches
// it: a palette row, a key binding, an entry in a shortcut sheet. That something is the
// `command` module, which mounts `CommandRegistryContext` through a shell extension.
//
// With no provider mounted, `useCommands` does nothing. A screen therefore declares its
// commands whether or not the palette is installed, and needs no dependency on it. This
// file holds state and no IO, and it imports nothing beyond React.

/** Where a command sits in the palette. The page group is labelled by its registration. */
export type CommandGroup = "page" | "navigation" | "actions" | "preferences";

/** How a command was started: a palette row, or its key binding. */
export interface CommandContext {
  source: "palette" | "shortcut";
}

/**
 * One thing a person can do. `id` is `<module>.<verb>`, for example `admin.go-to-users`.
 *
 * `shortcut` is a logical key, so it follows the typed character on every layout:
 * `"Mod+K"` (Cmd on macOS, Ctrl elsewhere), `"Mod+B"`, `"?"`, `"J"`, `"Enter"`,
 * `"Escape"`, or a sequence written with spaces, such as `"G U"` for G then U. A key
 * exists only on a command, so the palette and the shortcut sheet can never miss one.
 *
 * `when` hides the command from the palette and disables its binding while it returns
 * `false`. It and `run` are read at call time, so they may close over fresh state.
 *
 * `active` marks the command as the current choice of a set, such as the theme in use.
 * The palette reads it when it renders and shows "Current" in place of the keycap.
 */
export interface Command {
  id: `${string}.${string}`;
  title: string;
  group: CommandGroup;
  keywords?: readonly string[];
  icon?: LucideIcon;
  shortcut?: string;
  when?: () => boolean;
  active?: () => boolean;
  run: (ctx: CommandContext) => void;
}

/**
 * How long a registration lives, and so which bindings may overlap.
 *
 * - `global`: the app's own commands (navigation, theme, sign out, the sidebar). They
 *   live as long as the shell.
 * - `route`: the current page's commands. The palette lists them first, under the
 *   registration's `label`, and they go when the page unmounts.
 * - `data-table`: the keys a mounted `DataTable` declares (J, K, Enter, Escape). They
 *   live while the table is on screen.
 */
export type CommandScope = "global" | "route" | "data-table";

/** One `useCommands` call, as the provider receives it. */
export interface CommandRegistration {
  id: string;
  commands: readonly Command[];
  scope: CommandScope;
  /** Names the page group in the palette, for example "Users". */
  label?: string;
}

/** What a command provider exposes. `register` returns the matching unregister. */
export interface CommandRegistry {
  register: (registration: CommandRegistration) => () => void;
}

export const CommandRegistryContext: Context<CommandRegistry | null> =
  createContext<CommandRegistry | null>(null);

/**
 * Declare commands for as long as the calling component is mounted.
 *
 * It registers in an effect and unregisters on cleanup. It registers again only when the
 * shape of the list changes (an id, a title, a group, a shortcut, the keywords, whether
 * `when` is set) or the scope or label does. A new `run` or `when` closure on each render
 * does not re-register: the registered commands call the latest ones, `active` included. `icon` is read at
 * registration time, so pass a module-level component.
 */
export function useCommands(
  commands: readonly Command[],
  options: { scope: CommandScope; label?: string }
): void {
  const registry = useContext(CommandRegistryContext);
  const registrationId = useId();
  const latest = useRef(commands);
  const { scope, label } = options;

  // The list as of its last shape change. A re-render with the same shape keeps the old
  // entry, so the effect below does not register again.
  const key = commandsKey(commands);
  const [shape, setShape] = useState({ key, commands });
  if (shape.key !== key) {
    setShape({ key, commands });
  }

  useEffect(() => {
    latest.current = commands;
  });

  // The registered `run` and `when` read `latest` at call time, so they always call this
  // component's newest closures.
  useEffect(
    () =>
      registry?.register({
        id: registrationId,
        commands: delegateToLatest(shape.commands, () => latest.current),
        scope,
        label,
      }),
    [registry, registrationId, shape.commands, scope, label]
  );
}

/** Whether a command provider is mounted above the caller. */
export function useCommandProvider(): boolean {
  return useContext(CommandRegistryContext) !== null;
}
