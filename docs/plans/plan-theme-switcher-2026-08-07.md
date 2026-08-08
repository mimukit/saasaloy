# Plan — theme switcher and shadcn theme presets

Grilled: 2026-08-07
Tracked: [#64](https://github.com/mimukit/saasaloy/issues/64)

## Context

Dark mode in the base follows the OS and nothing else. `Layout.astro` runs a pre-paint
inline script that adds `.dark` when `prefers-color-scheme` asks for it — no toggle, no
persistence. That was a deliberate non-goal of epic [#40](https://github.com/mimukit/saasaloy/issues/40)
("a theme-switcher UI; dark mode follows the OS"), deferred rather than rejected, and
[ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md) locked in the
design layer that makes picking it up cheap.

Two capabilities are in scope, and the grill established they are very unequal in size:

1. **Light/dark/system switching** — a visitor-facing control with persistence, layered
   over the existing OS default. This is the real build.
2. **Project theming** — the owner swapping the project's token set for a
   shadcn-generated one. **Proven during the grill to already work end to end.** The
   remaining work is documentation plus a regression guard.

**Success** = a scaffolded project ships a working, persistent, flash-free
light/dark/system toggle that costs **zero** JavaScript on the landing page, is reusable
unchanged by the future `admin` SPA, and whose token set an owner can swap wholesale with
one documented command.

> **Start from `origin/main`.** As of 2026-08-07 a local `main` may sit ~42 commits behind;
> [#54](https://github.com/mimukit/saasaloy/issues/54) has landed, so `scripts/` is
> TypeScript. The template surface this plan touches (`globals.css`, `Layout.astro`,
> `index.astro`, `navbar.tsx`, `components.json`, `packages/ui/package.json`) is
> **unchanged** by those commits — verified — so everything below holds.

### The second consumer, and why it drives the design

`admin` ([#13](https://github.com/mimukit/saasaloy/issues/13), still `ready`, unbuilt) is
planned as a **React + Vite SPA**. It needs the same toggle. That rules out putting the
behaviour in `Layout.astro`, because a Vite SPA has no Astro shell to inherit it from.
Anything reusable has to live in `packages/ui`.

`packages/ui` is consumed JIT from source (`workspace:*`, no build step), so one `.tsx`
file genuinely serves both hosts with the same import specifier:

```astro
--- apps/web/src/pages/index.astro (Astro) ---
import { ThemeToggle } from "@repo/ui/blocks/theme-toggle";
---
<ThemeToggle />
```

```tsx
// apps/admin/src/App.tsx (React Vite) — when #13 lands
import { ThemeToggle } from "@repo/ui/blocks/theme-toggle";
<ThemeToggle />;
```

**Admin is not in this scope.** It shapes *where the code lives*; wiring it up is #13.

### The one thing that cannot be shared by import

A toggle can only *change* the theme. Something has to *set* it before the first paint,
and React cannot — `useEffect` runs after mount, which is after paint.

That resolver also cannot be a normal import, in **either** host: `<script type="module">`
is deferred by specification and always runs after HTML parsing.

```html
<!-- deferred → runs after first paint → guaranteed flash -->
<script type="module">
  import { initTheme } from "@repo/ui/lib/theme";
</script>
```

Astro bundles a bare `<script>` into exactly such a module unless marked `is:inline`;
Vite's `index.html` entry is likewise `<script type="module" src="…">`. So each host
document needs its own synchronous inline `<script>` in `<head>`.

Astro has a first-class primitive for this (`set:html`). **Vite does not** — its
`index.html` is a static file whose only build-time substitution is `%VITE_*%` from
`.env`, which cannot reach a TypeScript constant. That gap, and nothing else, is why
admin needs a ~12-line `transformIndexHtml` plugin.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Scope** | **One issue.** The toggle is a real build; the preset half is documentation plus a guard. They share the same `globals.css` surface and the same QA pass. |
| **Where the control lives** | **`packages/ui/src/blocks/theme-toggle.tsx`**, a standalone block at `@repo/ui/blocks/theme-toggle`. The owner places or removes it; `admin` imports the same file. |
| **Where the logic lives** | **`packages/ui/src/lib/theme.ts`** at `@repo/ui/lib/theme`. Framework-free. |
| **`lib/theme.ts` must be Node-importable** | Both hosts import it **at build time** — Astro frontmatter and `vite.config.ts` both run in Node. No `window`, `document` or `localStorage` access at module scope. This is now a rule, not a preference. |
| **Pre-paint sync across hosts** | **`lib/theme.ts` exports the script as a string constant.** `Layout.astro` emits `<script is:inline set:html={THEME_INIT_SCRIPT} />`; admin injects the same constant via `transformIndexHtml` at `head-prepend`. Neither copy can drift, because neither is a copy. |
| **Toggle states** | **Three: `light` / `dark` / `system`.** #64's criterion says the choice wins "until reset" — two-state has no reset, and a visitor who picks once could never return to following the OS. |
| **Toggle behaviour** | **Stateless.** No React state, no `client:*` directive, **zero JavaScript shipped** for it on the landing page. `THEME_INIT_SCRIPT` installs a delegated click listener; CSS picks the icon off `<html data-theme>`. ADR 0022 records the JS budget as a *maintained* property, and this is the first control that is purely chrome. |
| **No-JS behaviour** | **`data-theme` doubles as the JS-present marker.** The script sets it; without JS the attribute is absent and the control is hidden by CSS. No extra marker class, no reveal-on-mount, no layout shift. |
| **Visibility CSS home** | **Self-contained in the block**, via Tailwind arbitrary variants (`hidden [html[data-theme]_&]:inline-flex`), not a rule in `globals.css` — so the block travels to admin carrying its own rules. |
| **Default placement** | **Header row of `index.astro`**, sibling to `<Navbar />`. `navbar.tsx` — the file the landing-blocks polish work owns — is never touched. A fresh `init` ships it placed, so the QA pass has a target. |
| **Preset mechanism** | **Document the existing shadcn CLI path.** Proven, not assumed — see the grill evidence below. No CLI code. |
| **Preset sources** | **Document the mechanism; name both sources.** Any `registry:style` URL works. **shadcn's own `ui.shadcn.com/create` is the documented default**; tweakcn is named as the richer alternative. Neither is load-bearing, so the docs survive either disappearing. |
| **Preset timing** | **Post-scaffold.** `init` stays a pure template copy — no prompt, no bundled preset set. |
| **Preset regression guard** | **`scripts/verify-preset.ts`**, opt-in via `pnpm verify:preset`. **Not** wired into `deps:verify` — the repo's standard green gate must not depend on a third party's uptime. Referenced from CONTRIBUTING as a drill for `shadcn` bumps. |
| **Admin's boot** | **Vite plugin** importing `THEME_INIT_SCRIPT`. Recorded now, written at #13: a doc comment on the constant **plus** an acceptance criterion appended to #13. |
| **ADRs** | **None.** Both facts are recorded in this plan and the template's `AGENTS.md`. The stateless-control pattern is how this one control is built, not a precedent worth a record; preset theming being unmanaged follows directly from ADR 0022's one-time-gift clause. |
| **Persistence** | `localStorage`. `light`/`dark` stored; `system` clears the key. |

## Approach

### What this reuses

- **`packages/ui`'s existing subpath exports** — `"./lib/*"` and `"./blocks/*"` already
  cover both new files. **No `package.json` change.**
- **The `.dark` class and `@custom-variant dark`** — the token system already keys off it.
- **`color-scheme` paired with `.dark`** — `globals.css` already sets it per-class
  precisely because the theme is class-driven, not media-driven. No change needed; the
  existing comment already anticipates a manual override.
- **`shadcn@4.16.1` as a live dependency** — kept un-ejected by ADR 0022 so later
  `shadcn add` stays coherent. The preset path is that decision's payoff.
- **`components.json`'s `cssVariables: true`** — exactly what a `registry:style` expects.
- **`scripts/` as TypeScript with `tsconfig.scripts.json`** ([#54](https://github.com/mimukit/saasaloy/issues/54), landed) — `verify-preset.ts` inherits the typecheck gate for free.
- **`pnpm deps:verify`** — the only gate that exercises template code.
- **`@astrojs/react@6.0.2`** — already in the base.

### Phase 1 — `packages/ui/src/lib/theme.ts`

```ts
export const THEME_STORAGE_KEY = "theme";
export type Theme = "light" | "dark" | "system";

export function getStoredTheme(): Theme;        // "system" when unset
export function setTheme(theme: Theme): void;   // storage + data-theme + .dark
export function resolveTheme(theme: Theme): "light" | "dark";

// Inlined verbatim into each host document's <head>. Also installs the delegated
// click listener and the matchMedia listener — see Phase 3.
export const THEME_INIT_SCRIPT: string;
```

- **No `window`/`document`/`localStorage` at module scope** — this file is imported in
  Node by both hosts at build time. Browser access lives inside function bodies and
  inside the script string.
- `THEME_INIT_SCRIPT` is a **plain string**, not a stringified function — a minifier or
  renamer would otherwise change its meaning.
- Storage access wrapped in `try/catch`. A throwing `localStorage` (Safari private mode,
  blocked storage) must degrade to the OS preference, never to an unstyled page.

What the script does, in order: read storage → set `data-theme` on `<html>` → resolve and
toggle `.dark` → register a delegated `click` listener on `document` (matching
`closest("[data-theme-toggle]")`, cycling `light → dark → system → light` and updating
`aria-label`) → register a `matchMedia` change listener that re-resolves only while
`data-theme === "system"`.

`document` exists while `<head>` is parsing, so registering a delegated listener there is
valid — the button need not exist yet.

### Phase 2 — `Layout.astro` reads the script from `@repo/ui`

```astro
---
import { THEME_INIT_SCRIPT } from "@repo/ui/lib/theme";
---
<script is:inline set:html={THEME_INIT_SCRIPT} />
```

Frontmatter runs at build time, so the string is baked into the emitted HTML — no module,
no defer, no runtime cost. Update the existing comment block, which currently says "no
localStorage, no toggle … a theme switcher would add the persistence layer here."

**Verify against the built output** that Astro neither wraps, defers, nor escapes the
injected string. This is the phase's real risk and it is invisible to `typecheck` — check
`.dev/playground/apps/web/dist/**/*.html`.

### Phase 3 — `packages/ui/src/blocks/theme-toggle.tsx`

One file, one exported component plus its prop types, per the template's block rules.
**No state, no hooks, no client directive.**

- Renders `<button type="button" data-theme-toggle>` carrying all three icons.
- Hidden unless `<html>` has `data-theme` — which only the script sets, so no-JS leaves
  no dead control and JS-enabled visitors get no layout shift (the attribute is set
  pre-paint, before the button is parsed).
- Icon selection and visibility are Tailwind arbitrary variants in this file, so the
  block travels to admin self-contained.
- A static `aria-label` in the markup for the no-script case; the script keeps it current
  as the state cycles.

The one accepted cost: the component depends on `THEME_INIT_SCRIPT` being installed in the
host document, and there is no `onClick` for a reviewer to find. A comment in the file
must say so plainly, naming both hosts' injection points.

### Phase 4 — Place it on the landing page

Add `<ThemeToggle />` to the header row of `apps/web/src/pages/index.astro`, sibling to
`<Navbar />`. **Do not edit `navbar.tsx`** — that file belongs to the landing-blocks
polish work.

Update `index.astro`'s client-directive comment block, which enumerates which blocks
hydrate and why. The toggle belongs there precisely as the block that ships *no* JS.

### Phase 5 — Document the preset recipe

Already proven (below). Write it into `packages/cli/templates/base/AGENTS.md` beside the
existing "Adding a primitive the base doesn't vendor" section, which already establishes
the `pnpm --filter @repo/ui exec shadcn` form and its `dlx`/`npx` traps.

```sh
pnpm --filter @repo/ui exec shadcn add <url-to-a-registry:style-item>
```

Sources, in the order the docs should present them:

1. **`https://ui.shadcn.com/create`** — first-party, the documented default.
2. **`https://tweakcn.com`** — a much larger preset library; serves items at
   `https://tweakcn.com/r/themes/<name>.json`.

Include one line stating that this **edits a base file, and base files have no update
path** ([ADR 0022](../adr/adr-0022-design-layer-ships-in-the-base-2026-08-06.md)) — a
swapped theme is the owner's to maintain. Scaffolded projects' agents read this file and
will not read our ADRs.

### Phase 6 — `scripts/verify-preset.ts`

`scripts/` is TypeScript as of #54, so this is a `.ts` file covered by
`tsconfig.scripts.json` with no wiring. Add `"verify:preset"` to the root `package.json`,
**not** to `deps:verify`.

It is today's probe, scripted: `play:init` → install → `shadcn add <preset>` → assert the
`@source` globs, `@custom-variant`, and `@layer base` rules survived and that no block was
duplicated → `build` → `verify-css` → assert a preset token reached the built CSS.

Reference it from CONTRIBUTING's dependency-update section as the drill to run when
`shadcn` moves.

### Phase 7 — Verify

- `pnpm deps:verify` green — the standing gate for every template change.
- `pnpm verify:preset` green.
- A manual pass over all seven blocks × light/dark/system × default theme and one swapped
  preset. `build` cannot assert this; it is a **qakit** deliverable.
- Confirm the no-JS case by disabling JavaScript: the control must be absent, not dead.

### Phase 8 — Record the admin constraint

- Doc comment on `THEME_INIT_SCRIPT` naming `transformIndexHtml` / `head-prepend` and why
  a module import cannot work.
- Append an acceptance criterion to [#13](https://github.com/mimukit/saasaloy/issues/13):
  admin's `index.html` must receive `THEME_INIT_SCRIPT` via a Vite plugin at
  `head-prepend`, never as a module import or a hand-pasted copy.

## Resolved during the grill (2026-08-07)

**The preset path was proven, not reasoned about.** Run against a fresh
`.dev/playground` with `shadcn@4.16.1`:

```console
$ pnpm --dir .dev/playground/packages/ui exec shadcn add \
    https://tweakcn.com/r/themes/modern-minimal.json --yes
✔ Checking registry.
✔ Updating src/styles/globals.css          # the ONLY file touched
```

| Check | Result |
|-------|--------|
| `components.json` | **untouched** — ADR 0022's fixed `style` is safe |
| `@source` globs (all three) | preserved |
| `@custom-variant dark` | preserved |
| `@layer base` rules | preserved; preset's `letter-spacing` appended into the same block |
| `:root` / `.dark` / `@theme inline` | merged in place — **no duplicate blocks** |
| `@theme inline` | **extended** with 21 mappings (`font-*`, `tracking-*`, `shadow-*`, `--color-destructive-foreground`) |
| `pnpm build` | exit 0 |
| `verify-css` | sentinel found |
| `--primary` in built CSS | `oklch(0.205 0 0)` → `oklch(62.31% .188 259.815)` |

This killed a question the draft treated as open: whether the base's hand-maintained
`@theme inline` needed pre-widening so presets land fully. **It does not** — shadcn
extends that block itself.

Other decisions settled: three-state over two (the "until reset" criterion has no meaning
otherwise); stateless over a React island (zero JS, and `data-theme` doubles as the no-JS
marker, which removes the reveal-on-mount layout shift that was the option's main cost);
placement in `index.astro` rather than `navbar.tsx` (sidesteps the polish collision named
in #64); shadcn's own generator as the documented default with tweakcn named alongside
(the mechanism is the `registry:style` shape, not the host); an opt-in `verify:preset`
rather than poisoning `deps:verify` with a third-party fetch; and no ADR for either fact.

## Non-goals

- **Wiring `admin`.** It shapes where the code lives; building it is [#13](https://github.com/mimukit/saasaloy/issues/13).
- **A runtime preset switcher for visitors** — contradicts the near-zero-JS property.
- **A `saasaloy theme` CLI command** — the shadcn CLI already does this.
- **A theme choice prompt in `init`** — `init` stays a pure copy.
- **A full theme editor in the scaffolded project.**
- **Per-component theming, or multiple simultaneous themes.**
- **An update path for base files** — unchanged from ADR 0022.
