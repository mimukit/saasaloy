import {
  detectPlatform,
  getHotkeyManager,
  useHotkeys,
} from "@tanstack/react-hotkeys";
import type {
  RawHotkeyChord,
  UseHotkeyDefinition,
} from "@tanstack/react-hotkeys";
import { useEffect, useMemo, useState } from "react";

import {
  chordKeycaps,
  holdsCommandModifier,
} from "@repo/ui/lib/command/registry";
import type { Chord, Platform } from "@repo/ui/lib/command/registry";

// The key engine. This is the ONLY file that imports `@tanstack/react-hotkeys`: the
// package is pre-1.0, so a swap to another engine (tinykeys, say) rewrites this file and
// nothing else. Everything above it speaks the registry's `Chord`.
//
// - Every binding is a logical key: it follows the typed character, so `?` works on every
//   layout. `Mod` is Cmd on macOS and Ctrl elsewhere.
// - A single key or a sequence never fires inside a text field. A chord that holds Mod,
//   Ctrl or Alt does, which is what lets Mod+K open the palette from a search box.
// - While a dialog or an alert dialog this module does not own is open, an exclusive scope
//   suspends every binding, so Mod+K does nothing over a confirm.
// - While the palette or the shortcut sheet is open, an exclusive scope of its own leaves
//   only the overlay's bindings live (Mod+K and ? toggle the overlays).

/** One key binding as the engine takes it. */
export interface EngineBinding {
  id: string;
  steps: readonly Chord[];
  /**
   * Read at key-press time, so it sees the declaring screen's newest state. While it is
   * false the key passes through untouched: no default prevented, no run. A command's
   * `when` goes here.
   */
  available: () => boolean;
  run: () => void;
}

/** The scope the palette and the shortcut sheet take while one of them is open. */
const OVERLAY_SCOPE = "command-overlay";
/** The scope a dialog the module does not own takes while it is open. It binds nothing. */
const BLOCKED_SCOPE = "command-blocked";

/** The attribute the palette and the sheet put on their popups, so the guard skips them. */
export const OVERLAY_ATTRIBUTE = "data-command-overlay";

const FOREIGN_DIALOG = `[role="dialog"]:not([${OVERLAY_ATTRIBUTE}]), [role="alertdialog"]`;

/** Gap allowed between the steps of a sequence such as G then U, in milliseconds. */
const SEQUENCE_TIMEOUT_MS = 1000;

function rawChord(chord: Chord): RawHotkeyChord {
  return {
    key: chord.key,
    mod: chord.mod,
    ctrl: chord.ctrl,
    alt: chord.alt,
    shift: chord.shift,
  };
}

function definition(
  binding: EngineBinding,
  scope: string,
  enabled = true
): UseHotkeyDefinition {
  const [first] = binding.steps;
  const options = {
    enabled,
    // A text field keeps its own keys; a command chord still reaches the app.
    ignoreInputs: first === undefined ? true : !holdsCommandModifier(first),
    // The registry already refused conflicts; the overlay rebinds Mod+K on purpose.
    conflictBehavior: "allow" as const,
    // The callback prevents the default only when it runs, so an unavailable binding
    // (Enter with no highlighted row, say) leaves the key to the page.
    preventDefault: false,
    stopPropagation: false,
    scope,
    meta: { name: binding.id },
  };
  const callback = (event: KeyboardEvent): void => {
    if (!binding.available()) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    binding.run();
  };
  if (binding.steps.length === 1 && first !== undefined) {
    return { hotkey: rawChord(first), callback, options };
  }
  return {
    hotkey: binding.steps.map(rawChord),
    callback,
    options: { ...options, timeout: SEQUENCE_TIMEOUT_MS },
  };
}

/** Whether a dialog the command module does not own is open in the document. */
function foreignDialogOpen(): boolean {
  return document.querySelector(FOREIGN_DIALOG) !== null;
}

/**
 * Bind `bindings` for as long as the caller is mounted, and `overlay.bindings` while
 * `overlay.open` is true. Callbacks sync on every render, and each binding asks
 * `available` when its key is pressed.
 */
export function useShortcutEngine({
  bindings,
  overlay,
}: {
  bindings: readonly EngineBinding[];
  overlay: { open: boolean; bindings: readonly EngineBinding[] };
}): void {
  const [blocked, setBlocked] = useState(false);

  // Watch for a dialog that is not the palette or the sheet. Base UI mounts a popup when
  // it opens and removes it after it closes, so a child-list observer sees both moves.
  useEffect(() => {
    const check = (): void => {
      setBlocked(foreignDialogOpen());
    };
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
    };
  }, []);

  // An exclusive scope suspends every other scope, `global` included, until released.
  const exclusive = blocked
    ? BLOCKED_SCOPE
    : overlay.open
      ? OVERLAY_SCOPE
      : null;
  useEffect(() => {
    const release =
      exclusive === null
        ? null
        : getHotkeyManager().activateScope(exclusive, { exclusive: true });
    return () => {
      release?.();
    };
  }, [exclusive]);

  useHotkeys([
    ...bindings.map((binding) => definition(binding, "global")),
    ...overlay.bindings.map((binding) =>
      definition(binding, OVERLAY_SCOPE, overlay.open)
    ),
  ]);
}

/** The platform keycaps are drawn for. It is fixed for the page's life. */
export function usePlatform(): Platform {
  return useMemo<Platform>(() => detectPlatform(), []);
}

/** The keycaps of each step of a shortcut, drawn for `platform`. */
export function formatKeycaps(
  steps: readonly Chord[],
  platform: Platform
): string[][] {
  return steps.map((chord) => chordKeycaps(chord, platform));
}
