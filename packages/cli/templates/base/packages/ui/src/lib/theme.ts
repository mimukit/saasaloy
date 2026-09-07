// The theme state machine — light / dark / system — shared by every host that renders
// @repo/ui. Framework-free on purpose: no React, no Astro, no imports at all.
//
// THIS FILE IS IMPORTED IN NODE. Both hosts pull it in at *build* time (Astro
// frontmatter, and a Vite config for a React SPA), so there must be no `window`,
// `document` or `localStorage` access at module scope. Every browser API below lives
// inside a function body or inside the THEME_INIT_SCRIPT string. Breaking that rule
// breaks the build, not the page, and the error is a long way from the cause.

/** localStorage key holding the visitor's explicit choice. `system` clears it. */
export const THEME_STORAGE_KEY = "theme";

/**
 * localStorage key marking that the visitor has used a toggle at least once.
 *
 * THEME_STORAGE_KEY alone cannot carry that fact, because `system` is spelled as an
 * absent key — so a first visit and a deliberate `system` read the same. A host that
 * wants a default other than the OS preference (the admin app starts on dark) needs to
 * tell those two apart, and this key is the only difference between them.
 *
 * `installThemeToggle` writes it on every press. Nothing clears it.
 */
export const THEME_CHOICE_KEY = "theme-chosen";

/** Attribute on `<html>` carrying the *chosen* state — also the JS-present marker. */
export const THEME_ATTRIBUTE = "data-theme";

/** Attribute marking a toggle trigger. The delegated click listener matches on it. */
export const THEME_TOGGLE_ATTRIBUTE = "data-theme-toggle";

export type Theme = "light" | "dark" | "system";

/** What `system` collapses to once the OS preference is read. */
export type ResolvedTheme = "light" | "dark";

/** Cycle order for the toggle: light → dark → system → light. */
export const THEME_ORDER: readonly Theme[] = ["light", "dark", "system"];

// The accessible name for each state, naming both where you are and where the next
// press takes you — the icon carries the state visually, and a button's accessible name
// has to carry the action. THEME_INIT_SCRIPT keeps this current as the state cycles, so
// the block's static aria-label and this map must not drift; both read it from here.
export const THEME_LABELS: Record<Theme, string> = {
  dark: "Theme: dark. Switch to system.",
  light: "Theme: light. Switch to dark.",
  system: "Theme: system. Switch to light.",
};

const OS_DARK_QUERY = "(prefers-color-scheme: dark)";

/** The stored choice, or `system` when unset, unreadable or not a valid theme. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : "system";
  } catch {
    // A throwing localStorage (Safari private mode, blocked storage) must degrade to
    // following the OS, never to an unstyled page.
    return "system";
  }
}

/** Collapse a choice to the palette to paint. `system` asks the OS. */
export function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "light" || theme === "dark") {
    return theme;
  }
  return window.matchMedia(OS_DARK_QUERY).matches ? "dark" : "light";
}

/** Persist a choice and apply it: storage, `data-theme`, and the `.dark` class. */
export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } else {
      localStorage.setItem(THEME_STORAGE_KEY, theme);
    }
  } catch {
    // Unwritable storage costs persistence, not the current page.
  }

  const root = document.documentElement;
  root.setAttribute(THEME_ATTRIBUTE, theme);
  root.classList.toggle("dark", resolveTheme(theme) === "dark");

  relabelThemeToggles(theme);
}

/**
 * Give every `[data-theme-toggle]` in the document the accessible name of the state it is
 * in. `setTheme` calls this, so a host only needs it directly for the one case `setTheme`
 * cannot cover: a toggle that MOUNTS AFTER the theme was applied.
 *
 * That is the ordinary case in a React host. `theme-toggle.tsx` renders a static
 * `aria-label` for `system` — the truthful value for a first-time visitor — and the theme
 * is applied in the entry module, before React has mounted anything. Without this call the
 * button announces "Theme: system" over a painted dark page until the first press.
 *
 * The Astro host gets the same repair from THEME_INIT_SCRIPT's `DOMContentLoaded` handler.
 *
 * `data-theme` is author-writable, so an unrecognised value falls back to the stored
 * choice rather than setting `aria-label="undefined"`.
 */
export function relabelThemeToggles(theme?: Theme): void {
  const root = document.documentElement;
  const painted = theme ?? root.getAttribute(THEME_ATTRIBUTE);
  const named =
    painted !== null && THEME_ORDER.includes(painted as Theme)
      ? (painted as Theme)
      : getStoredTheme();

  for (const trigger of root.querySelectorAll(`[${THEME_TOGGLE_ATTRIBUTE}]`)) {
    trigger.setAttribute("aria-label", THEME_LABELS[named]);
  }
}

/**
 * Install the toggle's click behaviour on `document`, and answer with a function that
 * removes it again.
 *
 * A host that inlines THEME_INIT_SCRIPT already has this and must NOT call it — the two
 * listeners would both fire and the cycle would advance twice per press. It exists for the
 * host that cannot inline the script: a Vite SPA's `index.html` substitutes only `%VITE_*%`
 * values, so it has no way to reach a TypeScript constant. Such an app calls this once from
 * its entry module instead of pasting a second copy of the cycle rule.
 *
 * It cycles from what is PAINTED, not from what is stored, for the reason the shared script
 * gives: where storage is unwritable the write is a no-op, so reading storage would answer
 * the same value forever and every press would land on the same theme.
 */
export function installThemeToggle(): () => void {
  function onClick(event: MouseEvent): void {
    const { target } = event;
    if (!(target instanceof Element)) {
      return;
    }
    if (!target.closest(`[${THEME_TOGGLE_ATTRIBUTE}]`)) {
      return;
    }

    const painted = document.documentElement.getAttribute(THEME_ATTRIBUTE);
    // An unrecognised `data-theme` gives index -1 and starts the cycle at the head of
    // THEME_ORDER.
    const index = painted === null ? -1 : THEME_ORDER.indexOf(painted as Theme);
    const next = THEME_ORDER[(index + 1) % THEME_ORDER.length] ?? "light";

    setTheme(next);

    // After `setTheme`, and unconditionally: a `system` press CLEARS THEME_STORAGE_KEY, so
    // this key is the only record that the visitor pressed anything at all.
    try {
      localStorage.setItem(THEME_CHOICE_KEY, "1");
    } catch {
      // Unwritable storage costs persistence, not the current page.
    }
  }

  document.addEventListener("click", onClick);

  return () => {
    document.removeEventListener("click", onClick);
  };
}

/**
 * Whether the visitor has ever used a toggle in this origin.
 *
 * A host whose default is the OS preference never needs this — `getStoredTheme()` already
 * answers `system` for an unset key. A host with a different default (the admin app starts
 * on dark) does: without it, a deliberate `system` choice and a first visit are the same
 * absent key, and the default would overwrite the choice on every load.
 */
export function hasChosenTheme(): boolean {
  try {
    return (
      localStorage.getItem(THEME_CHOICE_KEY) !== null ||
      localStorage.getItem(THEME_STORAGE_KEY) !== null
    );
  } catch {
    // Unreadable storage keeps nothing, so nothing was ever chosen.
    return false;
  }
}

// The pre-paint resolver, and the only thing that ever *changes* the theme at runtime.
//
// It is a string rather than a function because it has to be inlined into each host
// document verbatim:
//
//   - Astro   `<script is:inline set:html={THEME_INIT_SCRIPT} />` in the <head>
//              (see apps/web/src/layouts/Layout.astro).
//   - Vite     a `transformIndexHtml` plugin injecting it at `head-prepend`. Vite's
//              index.html only substitutes `%VITE_*%` env values, so it cannot reach a
//              TypeScript constant any other way.
//
// A module import cannot do this job in *either* host: `<script type="module">` is
// deferred by specification and always runs after first paint, which is exactly the
// flash this script exists to prevent. And it is a plain string, not a stringified
// function, because a minifier or renamer would otherwise be free to change its meaning
// on the way into the bundle.
//
// It also installs the toggle's behaviour, which is why the block that renders the
// button needs no JavaScript of its own: a delegated click listener on `document`
// (registered while <head> parses — `document` exists, the button need not) plus a
// matchMedia listener that re-resolves only while the state is `system`.
//
// Written as ES5-era syntax with no optional chaining: it ships unminified and
// untranspiled to every visitor, including the ones the rest of the bundle drops.
export const THEME_INIT_SCRIPT = `(function () {
  var STORAGE_KEY = ${JSON.stringify(THEME_STORAGE_KEY)};
  var ATTRIBUTE = ${JSON.stringify(THEME_ATTRIBUTE)};
  var TRIGGER = "[" + ${JSON.stringify(THEME_TOGGLE_ATTRIBUTE)} + "]";
  var ORDER = ${JSON.stringify(THEME_ORDER)};
  var LABELS = ${JSON.stringify(THEME_LABELS)};
  var root = document.documentElement;
  var media = window.matchMedia(${JSON.stringify(OS_DARK_QUERY)});

  function read() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      return stored === "light" || stored === "dark" ? stored : "system";
    } catch (error) {
      return "system";
    }
  }

  function write(theme) {
    try {
      if (theme === "system") localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, theme);
    } catch (error) {}
  }

  function paint(theme) {
    root.setAttribute(ATTRIBUTE, theme);
    root.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
  }

  function relabel(theme) {
    var triggers = root.querySelectorAll(TRIGGER);
    for (var i = 0; i < triggers.length; i++) {
      triggers[i].setAttribute("aria-label", LABELS[theme]);
    }
  }

  paint(read());

  document.addEventListener("click", function (event) {
    var node = event.target;
    if (!node || typeof node.closest !== "function" || !node.closest(TRIGGER)) return;
    // Cycle from what is painted, not from what is stored. Where storage is unwritable
    // the write() above is a no-op, so read() would answer "system" forever and every
    // press would land on light. The attribute is set by paint() on every transition and
    // is the one state that survives a dead localStorage.
    var current = root.getAttribute(ATTRIBUTE) || read();
    var next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
    write(next);
    paint(next);
    relabel(next);
  });

  media.addEventListener("change", function () {
    if (root.getAttribute(ATTRIBUTE) === "system") paint("system");
  });

  document.addEventListener("DOMContentLoaded", function () {
    // The attribute is author-writable, so anything could be sitting there. LABELS has no
    // entry for a value outside ORDER, and aria-label="undefined" is worse than a stale one.
    var painted = root.getAttribute(ATTRIBUTE);
    relabel(ORDER.indexOf(painted) < 0 ? read() : painted);
  });
})();`;
