// The theme state machine — light / dark / system. Framework-free on purpose: no React,
// no Astro, no imports at all.
//
// `light` is the starting state: a visitor who never pressed the toggle sees the light
// palette, whatever the OS prefers. The toggle itself has two states. A press flips the
// PAINTED palette, light to dark or dark to light, and stores that choice. It never steps
// to `system`; a host that wants the OS palette may call `setTheme("system")`, which lasts
// for the current page only, because an absent key reads back as `light`.
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
 * A press always stores `light` or `dark`, so THEME_STORAGE_KEY usually carries the fact
 * on its own. This key covers the rest: a choice made under the old three-state toggle,
 * where `system` was spelled as an absent key, and a host that sets `system` itself. A
 * host that wants a default other than the OS preference (the admin app starts on dark)
 * reads both keys through `hasChosenTheme`.
 *
 * `installThemeToggle` writes it on every press. Nothing clears it.
 */
export const THEME_CHOICE_KEY = "theme-chosen";

/** Attribute on `<html>` carrying the *chosen* state — also the JS-present marker. */
export const THEME_ATTRIBUTE = "data-theme";

/** Attribute marking a toggle trigger. The delegated click listener matches on it. */
export const THEME_TOGGLE_ATTRIBUTE = "data-theme-toggle";

/**
 * Attribute on `<html>` while a toggle press animates. globals.css scopes the circular
 * reveal to it, so any other view transition a page starts keeps the browser's default.
 */
export const THEME_REVEAL_ATTRIBUTE = "data-theme-reveal";

export type Theme = "light" | "dark" | "system";

/** What `system` collapses to once the OS preference is read. */
export type ResolvedTheme = "light" | "dark";

// The accessible name for each PAINTED palette, naming both where you are and where the
// next press takes you — the icon carries the palette visually, and a button's accessible
// name has to carry the action. It keys on the palette, not the choice, because `system`
// paints one of the two and the press flips whichever one is showing. THEME_INIT_SCRIPT
// and `relabelThemeToggles` keep every toggle current; both read this map.
export const THEME_LABELS: Record<ResolvedTheme, string> = {
  dark: "Theme: dark. Switch to light.",
  light: "Theme: light. Switch to dark.",
};

/**
 * The toggle's static name, before any script has run. The palette is unknown at render
 * time, so it names the action only. The button stays hidden until the script marks the
 * page, and the script replaces this name on DOMContentLoaded.
 */
export const THEME_TOGGLE_LABEL = "Switch between light and dark theme";

const OS_DARK_QUERY = "(prefers-color-scheme: dark)";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Whether a raw string is one of the three themes.
 *
 * `data-theme` is author-writable and `localStorage` holds whatever was last put there, so
 * every value this module reads back out of the page arrives as `string | null`. Narrowing
 * it here rather than asserting `as Theme` at each site is what keeps an unrecognised value
 * on the fallback path instead of into `THEME_LABELS[...]`, where it reads `undefined`.
 */
export function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/** The stored choice, or `light` when unset, unreadable or not a valid theme. */
export function getStoredTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    return stored === "dark" ? "dark" : "light";
  } catch {
    // A throwing localStorage (Safari private mode, blocked storage) must degrade to
    // the default palette, never to an unstyled page.
    return "light";
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
 * Give every `[data-theme-toggle]` in the document the accessible name of the palette it
 * shows. `setTheme` calls this, so a host only needs it directly for the one case `setTheme`
 * cannot cover: a toggle that MOUNTS AFTER the theme was applied.
 *
 * That is the ordinary case in a React host. `theme-toggle.tsx` renders the static
 * THEME_TOGGLE_LABEL, and the theme is applied in the entry module, before React has
 * mounted anything. Without this call the button never says which palette is showing
 * until the first press.
 *
 * The Astro host gets the same repair from THEME_INIT_SCRIPT's `DOMContentLoaded` handler.
 *
 * `data-theme` is author-writable, so an unrecognised value falls back to the stored
 * choice rather than setting `aria-label="undefined"`.
 */
export function relabelThemeToggles(theme?: Theme): void {
  const root = document.documentElement;
  const painted = theme ?? root.getAttribute(THEME_ATTRIBUTE);
  const named = isTheme(painted) ? painted : getStoredTheme();

  const label = THEME_LABELS[resolveTheme(named)];

  for (const trigger of root.querySelectorAll(`[${THEME_TOGGLE_ATTRIBUTE}]`)) {
    trigger.setAttribute("aria-label", label);
  }
}

// The toggle's click handler, installed by `installThemeToggle` below. It lives at module
// scope because it reads nothing from that function, and one identity per page means a
// second install adds no second listener.
function onClick(event: MouseEvent): void {
  const { target } = event;
  if (!(target instanceof Element)) {
    return;
  }
  const trigger = target.closest(`[${THEME_TOGGLE_ATTRIBUTE}]`);
  if (!trigger) {
    return;
  }

  // Flip what is painted, so the first press always changes what the visitor sees.
  const next: ResolvedTheme = document.documentElement.classList.contains(
    "dark"
  )
    ? "light"
    : "dark";

  revealTheme(trigger, () => {
    setTheme(next);
  });

  // After `setTheme`, and unconditionally, so a press is on record even where
  // THEME_STORAGE_KEY could not be written.
  try {
    localStorage.setItem(THEME_CHOICE_KEY, "1");
  } catch {
    // Unwritable storage costs persistence, not the current page.
  }
}

/**
 * Run `apply` inside a view transition, so the new theme spreads from `trigger` as a
 * growing circle. The animation itself is CSS, in globals.css. JavaScript only starts the
 * transition and says where the circle starts and how far it must grow, because CSS
 * cannot start a view transition or measure the button.
 *
 * It applies the change at once, with no animation, where the browser has no view
 * transitions or the visitor asks for reduced motion. THEME_INIT_SCRIPT repeats this in
 * ES5 for the Astro host; keep the two in step.
 */
export function revealTheme(trigger: Element, apply: () => void): void {
  if (
    !("startViewTransition" in document) ||
    window.matchMedia(REDUCED_MOTION_QUERY).matches
  ) {
    apply();
    return;
  }

  const root = document.documentElement;
  const box = trigger.getBoundingClientRect();
  const x = box.left + box.width / 2;
  const y = box.top + box.height / 2;
  // The distance to the farthest corner, so the circle covers the whole viewport.
  const radius = Math.hypot(
    Math.max(x, window.innerWidth - x),
    Math.max(y, window.innerHeight - y)
  );

  root.style.setProperty("--theme-reveal-x", `${x}px`);
  root.style.setProperty("--theme-reveal-y", `${y}px`);
  root.style.setProperty("--theme-reveal-r", `${radius}px`);
  root.setAttribute(THEME_REVEAL_ATTRIBUTE, "");

  const endReveal = () => {
    root.removeAttribute(THEME_REVEAL_ATTRIBUTE);
  };
  // `finished` settles after the animation, or at once when the browser skips it.
  void document.startViewTransition(apply).finished.finally(endReveal);
}

// The OS half of the same job, and the reason this is not click-only. THEME_INIT_SCRIPT
// registers its own matchMedia listener; a host that calls `installThemeToggle` instead
// does not have that script, so without this listener a visitor on `system` keeps the
// palette resolved at load until the next reload.
//
// It repaints only while the state is `system`, which only a host's `setTheme("system")`
// sets. It reads `data-theme`, not storage, because storage never answers `system`. A
// visitor on light or dark, chosen or default, keeps that palette when the OS changes.
function onOsChange(): void {
  if (document.documentElement.getAttribute(THEME_ATTRIBUTE) === "system") {
    setTheme("system");
  }
}

/**
 * Install the toggle's click behaviour on `document`, and answer with a function that
 * removes it again.
 *
 * A host that inlines THEME_INIT_SCRIPT already has this and must NOT call it — the two
 * listeners would both fire and each press would flip the palette twice, back to where
 * it started. It exists for the
 * host that cannot inline the script: a Vite SPA's `index.html` substitutes only `%VITE_*%`
 * values, so it has no way to reach a TypeScript constant. Such an app calls this once from
 * its entry module instead of pasting a second copy of the toggle rule.
 *
 * It flips what is PAINTED, not what is stored, for the reason the shared script gives:
 * where storage is unwritable the write is a no-op, so reading storage would answer the
 * same value forever and every press would land on the same theme.
 */
export function installThemeToggle(): () => void {
  const media = window.matchMedia(OS_DARK_QUERY);

  document.addEventListener("click", onClick);
  media.addEventListener("change", onOsChange);

  return () => {
    document.removeEventListener("click", onClick);
    media.removeEventListener("change", onOsChange);
  };
}

/**
 * Whether the visitor has ever used a toggle in this origin.
 *
 * This site never needs it: `getStoredTheme()` answers the default, `light`, for an unset
 * key. A host with a different default (the admin app starts on dark) does: without it, a
 * deliberate choice and a first visit can be the same absent key, and the default would
 * overwrite the choice on every load.
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
// matchMedia listener that re-resolves only while the state is `system`. A press flips
// light and dark; a visitor with no stored choice starts on light.
//
// Written as ES5-era syntax with no optional chaining: it ships unminified and
// untranspiled to every visitor, including the ones the rest of the bundle drops.
export const THEME_INIT_SCRIPT = `(function () {
  var STORAGE_KEY = ${JSON.stringify(THEME_STORAGE_KEY)};
  var ATTRIBUTE = ${JSON.stringify(THEME_ATTRIBUTE)};
  var TRIGGER = "[" + ${JSON.stringify(THEME_TOGGLE_ATTRIBUTE)} + "]";
  var REVEAL = ${JSON.stringify(THEME_REVEAL_ATTRIBUTE)};
  var LABELS = ${JSON.stringify(THEME_LABELS)};
  var root = document.documentElement;
  var media = window.matchMedia(${JSON.stringify(OS_DARK_QUERY)});
  var still = window.matchMedia(${JSON.stringify(REDUCED_MOTION_QUERY)});

  // An absent or unknown value is the default, light. The OS preference is never read
  // here, so a dark OS does not paint a first visit dark.
  function read() {
    try {
      return localStorage.getItem(STORAGE_KEY) === "dark" ? "dark" : "light";
    } catch (error) {
      return "light";
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

  // Name every toggle after the palette that is painted now, which is what a press flips.
  function relabel() {
    var label = LABELS[root.classList.contains("dark") ? "dark" : "light"];
    var triggers = root.querySelectorAll(TRIGGER);
    for (var i = 0; i < triggers.length; i++) {
      triggers[i].setAttribute("aria-label", label);
    }
  }

  // The same circular reveal as revealTheme() in lib/theme.ts: a view transition whose
  // animation lives in globals.css. No view transitions, or reduced motion: apply at once.
  function reveal(trigger, apply) {
    if (!document.startViewTransition || still.matches) return apply();
    var box = trigger.getBoundingClientRect();
    var x = box.left + box.width / 2;
    var y = box.top + box.height / 2;
    var r = Math.sqrt(Math.pow(Math.max(x, innerWidth - x), 2) + Math.pow(Math.max(y, innerHeight - y), 2));
    root.style.setProperty("--theme-reveal-x", x + "px");
    root.style.setProperty("--theme-reveal-y", y + "px");
    root.style.setProperty("--theme-reveal-r", r + "px");
    root.setAttribute(REVEAL, "");
    function done() { root.removeAttribute(REVEAL); }
    document.startViewTransition(apply).finished.then(done, done);
  }

  paint(read());

  document.addEventListener("click", function (event) {
    var node = event.target;
    var trigger = node && typeof node.closest === "function" && node.closest(TRIGGER);
    if (!trigger) return;
    // Two states only: flip the palette that is painted, never step back to "system".
    // Reading the class, not storage, keeps this working where storage is unwritable:
    // write() is then a no-op and read() would answer "light" forever.
    var next = root.classList.contains("dark") ? "light" : "dark";
    reveal(trigger, function () {
      write(next);
      paint(next);
      relabel();
    });
  });

  media.addEventListener("change", function () {
    if (root.getAttribute(ATTRIBUTE) !== "system") return;
    paint("system");
    relabel();
  });

  document.addEventListener("DOMContentLoaded", relabel);
})();`;
