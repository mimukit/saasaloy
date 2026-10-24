import type {
  Command,
  CommandGroup,
  CommandRegistration,
  CommandScope,
} from "@repo/ui/lib/shell/commands";

// The pure half of the `command` module: what the provider does with the registrations
// every `useCommands` call hands it. It merges them, parses each shortcut, finds the
// conflicts, and shapes the two views a person sees: the palette groups and the shortcut
// sheet sections. It imports no React and no key library, so `node --test` loads it as is;
// the type import above is erased. The engine (./engine.ts) binds what this file returns.

/**
 * The ids and shortcuts of the module's own two commands, which command-root.tsx declares.
 * They sit here, free of React, so the apps' repo tests can run the shipped key map
 * through `findConflicts` with the values the provider binds.
 */
export const COMMAND_KEYS = {
  openPalette: { id: "command.open-palette", shortcut: "Mod+K" },
  showShortcuts: { id: "command.show-shortcuts", shortcut: "?" },
} as const;

/** One step of a shortcut: a key and the modifiers held with it. */
export interface Chord {
  /** The logical key: an upper-case letter, a typed character such as `?`, or a name such as `Enter`. */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere. */
  mod: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

/** The platforms a keycap is drawn for. */
export type Platform = "mac" | "windows" | "linux";

/** A command with the registration that declared it and its parsed shortcut. */
export interface ResolvedCommand {
  command: Command;
  registrationId: string;
  scope: CommandScope;
  label: string | undefined;
  /** The parsed shortcut, or `null` for a palette-only command. */
  steps: readonly Chord[] | null;
}

/** Two commands that cannot both own their binding. */
export interface Conflict {
  /** The binding that was declared first, and keeps the key. */
  first: ResolvedCommand;
  /** The binding that loses the key. */
  second: ResolvedCommand;
  kind: "same-chord" | "sequence-prefix";
}

const MODIFIERS = new Map<string, keyof Omit<Chord, "key">>([
  ["mod", "mod"],
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
]);

// Lower-case spellings of the named keys a shortcut may use, mapped to the KeyboardEvent
// `key` value the engine matches against.
const NAMED_KEYS = new Map<string, string>([
  ["enter", "Enter"],
  ["return", "Enter"],
  ["escape", "Escape"],
  ["esc", "Escape"],
  ["backspace", "Backspace"],
  ["delete", "Delete"],
  ["tab", "Tab"],
  ["space", "Space"],
  ["arrowup", "ArrowUp"],
  ["arrowdown", "ArrowDown"],
  ["arrowleft", "ArrowLeft"],
  ["arrowright", "ArrowRight"],
  ["home", "Home"],
  ["end", "End"],
  ["pageup", "PageUp"],
  ["pagedown", "PageDown"],
]);

function parseChord(step: string, shortcut: string): Chord {
  const chord: Chord = {
    key: "",
    mod: false,
    ctrl: false,
    alt: false,
    shift: false,
  };
  const parts = step.split("+");
  const key = parts.pop() ?? "";
  for (const part of parts) {
    const modifier = MODIFIERS.get(part.toLowerCase());
    if (modifier === undefined) {
      throw new Error(
        `command: unknown modifier "${part}" in shortcut "${shortcut}".`
      );
    }
    chord[modifier] = true;
  }
  if (key === "") {
    throw new Error(`command: shortcut "${shortcut}" has no key.`);
  }
  chord.key =
    key.length === 1
      ? key.toUpperCase()
      : (NAMED_KEYS.get(key.toLowerCase()) ?? key);
  return chord;
}

/**
 * Parse a shortcut string into its steps. Steps are separated by spaces and the parts of
 * one step by `+`: `"Mod+K"` is one step, `"G U"` is G then U, `"?"` is the typed
 * question mark on any layout. Throws on an empty string, an empty step or an unknown
 * modifier.
 */
export function parseShortcut(shortcut: string): Chord[] {
  const steps = shortcut.trim().split(/\s+/);
  if (steps.length === 0 || steps[0] === "") {
    throw new Error("command: a shortcut cannot be empty.");
  }
  return steps.map((step) => parseChord(step, shortcut));
}

/**
 * One string per chord, equal for two chords that can match the same key press. `Ctrl`
 * counts as `Mod`: on Windows and Linux Mod is Control, so `Ctrl+B` and `Mod+B` are one
 * key there, and the conflict check reports them on every platform.
 */
export function chordKey(chord: Chord): string {
  const held = [
    chord.mod || chord.ctrl ? "mod" : "",
    chord.alt ? "alt" : "",
    chord.shift ? "shift" : "",
  ].filter((part) => part !== "");
  return [...held, chord.key.toLowerCase()].join("+");
}

/** Whether a chord holds a command modifier, which lets it fire inside a text field. */
export function holdsCommandModifier(chord: Chord): boolean {
  return chord.mod || chord.ctrl || chord.alt;
}

/** How a fault in the registrations is reported: thrown in development, warned once in production. */
export interface ReportOptions {
  mode: "development" | "production";
  warn: (message: string) => void;
  /** The faults already warned about, by key, carried across calls. */
  warned: Set<string>;
}

function report(options: ReportOptions, key: string, message: string): void {
  if (options.mode === "development") {
    throw new Error(message);
  }
  if (!options.warned.has(key)) {
    options.warned.add(key);
    options.warn(message);
  }
}

/** The message a repeated command id throws or warns with. */
export function repeatedIdMessage(
  id: string,
  first: CommandRegistration,
  second: CommandRegistration
): string {
  return (
    `command: the id "${id}" is declared twice, by the registrations "${first.id}" and ` +
    `"${second.id}". The first keeps it and the second is dropped. Give each command its ` +
    "own id; a screen mounts one DataTable at a time, since every table declares the same keys."
  );
}

/**
 * Flatten the registrations into one list in declaration order, parsing each shortcut.
 * A later command with an id already seen is dropped: one id names one command. With
 * `options`, a repeated id is reported the way a binding conflict is: it throws in
 * `development` and warns once in `production`.
 */
export function mergeRegistrations(
  registrations: readonly CommandRegistration[],
  options?: ReportOptions
): ResolvedCommand[] {
  const seen = new Map<string, CommandRegistration>();
  const resolved: ResolvedCommand[] = [];
  for (const registration of registrations) {
    for (const command of registration.commands) {
      const owner = seen.get(command.id);
      if (owner !== undefined) {
        if (options !== undefined) {
          report(
            options,
            `repeat:${command.id}`,
            repeatedIdMessage(command.id, owner, registration)
          );
        }
        continue;
      }
      seen.set(command.id, registration);
      resolved.push({
        command,
        registrationId: registration.id,
        scope: registration.scope,
        label: registration.label,
        steps:
          command.shortcut === undefined
            ? null
            : parseShortcut(command.shortcut),
      });
    }
  }
  return resolved;
}

/** The chord keys of a binding, one per step. */
function stepKeys(steps: readonly Chord[]): string[] {
  return steps.map(chordKey);
}

function isPrefix(
  shorter: readonly string[],
  longer: readonly string[]
): boolean {
  return (
    shorter.length < longer.length &&
    shorter.every((key, index) => key === longer[index])
  );
}

/**
 * Every pair of bindings that collide: the same chord sequence, or one binding that is a
 * prefix of another's sequence (`G` against `G U`), in overlapping scopes.
 *
 * Scopes overlap whenever both are registered. The provider holds mounted registrations
 * only, and every scope mounts inside the shell at once: `global` for the shell's life, a
 * `route` while its page shows, a `data-table` while its table shows on that page. So
 * every pair it holds is live together, across scopes as well as within one. `when` does
 * not matter here either: a hidden command still owns its declared key.
 */
export function findConflicts(
  resolved: readonly ResolvedCommand[]
): Conflict[] {
  const bound = resolved.flatMap((entry) =>
    entry.steps === null ? [] : [{ entry, keys: stepKeys(entry.steps) }]
  );
  const conflicts: Conflict[] = [];
  for (const [index, first] of bound.entries()) {
    for (const second of bound.slice(index + 1)) {
      if (first.keys.join(" ") === second.keys.join(" ")) {
        conflicts.push({
          first: first.entry,
          second: second.entry,
          kind: "same-chord",
        });
      } else if (
        isPrefix(first.keys, second.keys) ||
        isPrefix(second.keys, first.keys)
      ) {
        conflicts.push({
          first: first.entry,
          second: second.entry,
          kind: "sequence-prefix",
        });
      }
    }
  }
  return conflicts;
}

/** The message a conflict throws or warns with. It names both command ids. */
export function conflictMessage(conflict: Conflict): string {
  const what =
    conflict.kind === "same-chord"
      ? "bind the same shortcut"
      : "bind shortcuts where one is a prefix of the other";
  return (
    `command: "${conflict.first.command.id}" (${conflict.first.command.shortcut ?? ""}) and ` +
    `"${conflict.second.command.id}" (${conflict.second.command.shortcut ?? ""}) ${what}. ` +
    `"${conflict.first.command.id}" keeps it. Pick another key for one of them; see the ` +
    "reserved key table in the saasaloy-command skill."
  );
}

/**
 * The commands whose shortcut the engine binds. In `development` a conflict throws with
 * both command ids. In `production` it warns once per pair, through `warn`, and the
 * first-declared binding keeps the key; the second command stays in the palette with no
 * binding. `warned` carries the pairs already reported across calls.
 */
export function resolveBindings(
  resolved: readonly ResolvedCommand[],
  options: ReportOptions
): ResolvedCommand[] {
  const conflicts = findConflicts(resolved);
  const dropped = new Set<string>();
  for (const conflict of conflicts) {
    if (
      options.mode === "production" &&
      dropped.has(conflict.first.command.id)
    ) {
      continue;
    }
    report(
      options,
      `${conflict.first.command.id}|${conflict.second.command.id}`,
      conflictMessage(conflict)
    );
    dropped.add(conflict.second.command.id);
  }
  return resolved.filter(
    (entry) => entry.steps !== null && !dropped.has(entry.command.id)
  );
}

/**
 * The provider's list with `registration` in it. A registration whose id is already held
 * replaces that entry in its place, so a list that registers again keeps its slot; a new
 * id goes to the end.
 */
export function placeRegistration(
  current: readonly CommandRegistration[],
  registration: CommandRegistration
): readonly CommandRegistration[] {
  return current.some((entry) => entry.id === registration.id)
    ? current.map((entry) =>
        entry.id === registration.id ? registration : entry
      )
    : [...current, registration];
}

/**
 * The provider's list without `registration`. It removes that object only, so the
 * unregister of an entry that a later `register` already replaced does nothing.
 */
export function dropRegistration(
  current: readonly CommandRegistration[],
  registration: CommandRegistration
): readonly CommandRegistration[] {
  return current.filter((entry) => entry !== registration);
}

/** Whether a command is available now: its `when` holds, or it has none. */
export function isAvailable(command: Command): boolean {
  return command.when?.() ?? true;
}

/** One group of rows in the palette. */
export interface PaletteGroup {
  /** Stable across renders: the group, plus the page label for a page group. */
  key: string;
  label: string;
  items: ResolvedCommand[];
}

/** The fixed order of the palette groups. The page group comes first. */
export const GROUP_ORDER: readonly CommandGroup[] = [
  "page",
  "navigation",
  "actions",
  "preferences",
];

const GROUP_LABELS: Record<Exclude<CommandGroup, "page">, string> = {
  navigation: "Navigation",
  actions: "Actions",
  preferences: "Preferences",
};

/** The page group's label when the registration names none. */
export const UNLABELLED_PAGE = "This page";

/**
 * The owners whose rows lead a palette group, in this order, named by the id prefix
 * before the dot. The shell's commands come first (they act on the frame every screen
 * shares), then this module's own, then every other owner in declaration order. So the
 * Actions group reads "Toggle sidebar, Show keyboard shortcuts, Sign out", as the
 * approved mockup does, whichever screen mounted first. The shortcut sheet does not use
 * this rank: it keeps declaration order, which puts "Open the command palette" first.
 */
export const PALETTE_OWNER_ORDER: readonly string[] = ["shell", "command"];

function ownerRank(entry: ResolvedCommand): number {
  const owner = entry.command.id.slice(0, entry.command.id.indexOf("."));
  const rank = PALETTE_OWNER_ORDER.indexOf(owner);
  return rank === -1 ? PALETTE_OWNER_ORDER.length : rank;
}

/**
 * The palette rows, grouped in the fixed order: each page's commands under the page's
 * label, then Navigation, Actions and Preferences. Inside Navigation, Actions and
 * Preferences the rows follow `PALETTE_OWNER_ORDER`. The palette shows the commands of the
 * `global` and `route` scopes whose `when` holds; the `data-table` scope is keys only and
 * appears in the shortcut sheet. `hidden` names command ids the palette never lists, such
 * as the command that opens the palette itself. An empty group is left out.
 */
export function paletteGroups(
  resolved: readonly ResolvedCommand[],
  hidden: ReadonlySet<string> = new Set()
): PaletteGroup[] {
  const visible = resolved.filter(
    (entry) =>
      entry.scope !== "data-table" &&
      !hidden.has(entry.command.id) &&
      isAvailable(entry.command)
  );

  const pages = new Map<string, ResolvedCommand[]>();
  for (const entry of visible) {
    if (entry.command.group !== "page") {
      continue;
    }
    const label = entry.label ?? UNLABELLED_PAGE;
    pages.set(label, [...(pages.get(label) ?? []), entry]);
  }

  const groups: PaletteGroup[] = [...pages].map(([label, items]) => ({
    key: `page:${label}`,
    label,
    items,
  }));
  for (const group of GROUP_ORDER) {
    if (group === "page") {
      continue;
    }
    // `toSorted` is stable, so rows of one owner keep their declaration order.
    const items = visible
      .filter((entry) => entry.command.group === group)
      .toSorted((left, right) => ownerRank(left) - ownerRank(right));
    if (items.length > 0) {
      groups.push({ key: group, label: GROUP_LABELS[group], items });
    }
  }
  return groups;
}

/**
 * The page the palette's empty state names: "Try a page name, such as “users”". It is the
 * second Navigation row, or the first when there is only one, with "Go to " removed and
 * lower-cased. The first row is the app's root page by the NAV_AREAS convention (Overview
 * in admin, Home in the app), and a person who searches is rarely looking for the page
 * they start on, so admin reads "users" and the one-page app reads "home". With no
 * Navigation row it is `undefined`, and the hint drops the example.
 */
export function pageExample(
  groups: readonly PaletteGroup[]
): string | undefined {
  const items = groups.find((group) => group.key === "navigation")?.items ?? [];
  const title = (items[1] ?? items[0])?.command.title;
  return title?.replace(/^Go to /, "").toLowerCase();
}

/** One section of the shortcut sheet. */
export interface ShortcutSection {
  key: string;
  label: string;
  items: (ResolvedCommand & { steps: readonly Chord[] })[];
}

/**
 * The shortcut sheet: every live binding, in General (the app's own keys), one section per
 * page that binds keys, Navigation, and Data table while a table is mounted. `when` does
 * not hide a row here: the sheet lists what each key is for, not whether it acts now.
 */
export function shortcutSections(
  bindings: readonly ResolvedCommand[]
): ShortcutSection[] {
  const bound = bindings.filter(
    (entry): entry is ResolvedCommand & { steps: readonly Chord[] } =>
      entry.steps !== null
  );
  const general = bound.filter(
    (entry) => entry.scope === "global" && entry.command.group !== "navigation"
  );
  const navigation = bound.filter(
    (entry) =>
      entry.scope !== "data-table" && entry.command.group === "navigation"
  );
  const table = bound.filter((entry) => entry.scope === "data-table");

  const pages = new Map<string, ShortcutSection["items"]>();
  for (const entry of bound) {
    if (entry.scope !== "route" || entry.command.group === "navigation") {
      continue;
    }
    const label = entry.label ?? UNLABELLED_PAGE;
    pages.set(label, [...(pages.get(label) ?? []), entry]);
  }

  return [
    { key: "general", label: "General", items: general },
    ...[...pages].map(([label, items]) => ({
      key: `page:${label}`,
      label,
      items,
    })),
    { key: "navigation", label: "Navigation", items: navigation },
    { key: "data-table", label: "Data table", items: table },
  ].filter((section) => section.items.length > 0);
}

const MAC_SYMBOLS = { mod: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" } as const;
const OTHER_LABELS = {
  mod: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  shift: "Shift",
} as const;

const KEY_LABELS = new Map<string, string>([
  ["Enter", "↵"],
  ["Escape", "Esc"],
  ["ArrowUp", "↑"],
  ["ArrowDown", "↓"],
  ["ArrowLeft", "←"],
  ["ArrowRight", "→"],
  ["Space", "Space"],
]);

/**
 * The keycaps of one chord, one string per cap, drawn for `platform`: `Mod+K` is `⌘ K` on
 * macOS and `Ctrl K` elsewhere. Backspace reads `⌫` on macOS.
 */
export function chordKeycaps(chord: Chord, platform: Platform): string[] {
  const labels = platform === "mac" ? MAC_SYMBOLS : OTHER_LABELS;
  const caps: string[] = [];
  if (chord.ctrl) {
    caps.push(labels.ctrl);
  }
  if (chord.alt) {
    caps.push(labels.alt);
  }
  if (chord.shift) {
    caps.push(labels.shift);
  }
  if (chord.mod) {
    caps.push(labels.mod);
  }
  const key =
    chord.key === "Backspace" && platform === "mac"
      ? "⌫"
      : (KEY_LABELS.get(chord.key) ?? chord.key);
  caps.push(key);
  return caps;
}
