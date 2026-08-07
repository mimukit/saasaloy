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
  light: "Theme: light. Switch to dark.",
  dark: "Theme: dark. Switch to system.",
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
  if (theme === "light" || theme === "dark") return theme;
  return window.matchMedia(OS_DARK_QUERY).matches ? "dark" : "light";
}

/** Persist a choice and apply it: storage, `data-theme`, and the `.dark` class. */
export function setTheme(theme: Theme): void {
  try {
    if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
    else localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Unwritable storage costs persistence, not the current page.
  }

  const root = document.documentElement;
  root.setAttribute(THEME_ATTRIBUTE, theme);
  root.classList.toggle("dark", resolveTheme(theme) === "dark");

  for (const trigger of root.querySelectorAll(`[${THEME_TOGGLE_ATTRIBUTE}]`)) {
    trigger.setAttribute("aria-label", THEME_LABELS[theme]);
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
    relabel(root.getAttribute(ATTRIBUTE) || read());
  });
})();`;
