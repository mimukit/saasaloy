# Plan: dynamic themes from tweakcn presets

Tracked: [#196](https://github.com/mimukit/saasaloy/issues/196)

Builds on: issue #64 (theme switcher, built), which listed "a runtime preset switcher for visitors" and "a `saasaloy theme` CLI command" as non-goals. This plan picks both up.

Related: [`0069-plan-admin-shell-polish-2026-10-18.md`](0069-plan-admin-shell-polish-2026-10-18.md) (#192, #193), which gave each app its own theme file in `packages/ui/src/styles/`.

## Context

A scaffolded project can swap its whole token set today: `pnpm --filter @repo/ui exec shadcn add https://tweakcn.com/r/themes/<name>.json` merges a tweakcn `registry:style` item into `packages/ui/src/styles/web.css`, and `pnpm verify:preset` drills that path. That swap is static. It replaces the base values, it reaches the web app only, it edits a base-owned file with no update path (ADR 0022), and a visitor cannot pick a different look.

The owner wants themes that change at runtime. A project installs several [tweakcn](https://tweakcn.com) presets with a CLI command, the owner picks a default per app, and a visitor can switch to another preset in the browser without a rebuild. The switch sits beside the existing light / dark / system toggle and works in both `apps/web` and `apps/admin`. A preset's fonts load automatically.

tweakcn serves 36 named presets from `https://tweakcn.com/r/registry.json` (`modern-minimal`, `t3-chat`, `claude`, `vercel`, `supabase`, `catppuccin`, and so on), each at `https://tweakcn.com/r/themes/<name>.json`. Each item is a `registry:style` with `cssVars.theme` (fonts, radius, tracking), `cssVars.light` and `cssVars.dark` (the 32 shadcn colour tokens plus `font-*`, `radius`, `shadow-*`, `tracking-normal`, `spacing`, `letter-spacing`), and a `css` block that sets `body { letter-spacing: var(--tracking-normal) }`.

Success: `saasaloy theme add claude` in a fresh project, then `pnpm dev`, shows a preset picker in both apps. Picking "Claude" repaints the page with Claude's colours, radius, shadows and fonts, with no flash on reload, and light / dark / system still works on top of it.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| What "dynamic" means | A runtime preset switcher over a bundled set, plus a CLI command that manages the set. Per-tenant themes stored in the database are out of scope. |
| Who picks | The owner sets a default preset per app. A visitor can override it, and the choice persists in `localStorage` like the dark-mode choice. |
| Which apps | Both `apps/web` and `apps/admin`, through one mechanism in `packages/ui/src/lib/theme.ts`. Each app keeps its own base theme file, and that file's values are the preset named `default`. |
| How a preset reaches the page | Every installed preset compiles into the app's CSS bundle as a scoped block: `:root[data-preset="<name>"] { … }` and `:root[data-preset="<name>"].dark { … }`. The pre-paint script sets `data-preset` on `<html>` beside `data-theme`. No stylesheet loads on demand, because a late stylesheet paints the wrong theme first. |
| Specificity | `:root[data-preset]` (0,2,0) beats the base `:root` and `.dark` (0,1,0), and the preset's dark block (0,3,0) beats its light block. The CLI rejects a preset without both `light` and `dark`, so a preset light block never leaks into dark mode. |
| Base theme files | `web.css` and `admin.css` gain the full token set a tweakcn preset sets (fonts, shadows, tracking, spacing) and the matching `@theme inline` mappings, once, in Phase 1. After that, `saasaloy theme` never edits either file. |
| Where presets live | `packages/ui/src/styles/presets/<name>.css`, one per preset, and a generated `presets/index.css` that imports them. `web.css` and `admin.css` each import `./presets/index.css` once. |
| The record | `saasaloy.json` holds a `themes` block: the installed names, each one's source URL, and the default per app (ADR 0039: config owns checked-in values). The CLI regenerates `presets/index.css` and `packages/ui/src/lib/presets.gen.ts` (names, titles, per-app default) from it. A human never edits the two generated files. |
| CLI surface | `saasaloy theme add <name\|url>…`, `theme remove <name>`, `theme list` (installed, and the tweakcn catalogue with `--available`), `theme default <name> --app <web\|admin>`. A bare name resolves to `https://tweakcn.com/r/themes/<name>.json`. A URL takes any `registry:style` item, so shadcn's own `ui.shadcn.com/create` output and a saved tweakcn editor theme both work. |
| Untrusted input | A preset is third-party data written into a stylesheet. The CLI accepts only known token keys and rejects any value that holds `;`, `{`, `}`, `<`, `@`, `url(` or `/*`. A rejected preset writes nothing. |
| The picker | A new block `packages/ui/src/blocks/theme-preset-picker.tsx`: a native `<select data-theme-preset>` built from `presets.gen.ts`. `THEME_INIT_SCRIPT` handles its `change` event through one delegated listener, and `installThemeToggle` does the same for the admin SPA, so the landing page still ships zero JavaScript for theming. With no JavaScript, the control is hidden, like the toggle. With only `default` installed, the block renders nothing. |
| Fonts | Self-hosted through Fontsource. `theme add` maps each font family to `@fontsource-variable/<id>` (or `@fontsource/<id>` when no variable cut exists) through the Fontsource API, adds it exact-pinned to `packages/ui`, and the preset file imports it. A browser downloads a font file only when a preset that uses it is painted, so loading is automatic and on demand. A generic or system family (`ui-sans-serif`, `Georgia`, `monospace`) gets no package. |
| Storage | A new key `theme-preset`, separate from `theme`. An unknown stored value (a removed preset) falls back to the app's default. `web` and `admin` run on separate origins, so each keeps its own choice. |

## Approach

The work reuses the theme state machine in `packages/ui/src/lib/theme.ts` (`THEME_INIT_SCRIPT`, `setTheme`, `installThemeToggle`, `relabelThemeToggles`) and extends it with a second axis, the preset, beside light / dark / system. It reuses the `data-theme` pattern: an attribute on `<html>`, set pre-paint, that CSS keys off. The CLI side reuses the command registry in `packages/cli/src/commands/`, the network fetch in `packages/cli/src/lib/registry.ts` with its offline and remote test split (`registry.test.ts`, `registry.remote.test.ts`), the `saasaloy.json` reader in `saasaloy-config.ts`, and the `package.json` writer in `pkg-json.ts`. The admin app already self-hosts Inter with `@fontsource-variable/inter` in `modules/admin/files/src/main.tsx`, which sets the font precedent.

Rejected alternatives, one line each:

- **Load each preset's stylesheet on demand.** Smaller bundle, but the pre-paint script cannot block on a network fetch, so a stored preset paints the default first.
- **Write presets with `shadcn add` and keep the static swap.** shadcn merges into `:root` and replaces the base values, so it cannot hold two presets at once.
- **Google Fonts `<link>` per preset.** No install step, but every visitor makes a third-party request, which needs a CSP entry and a privacy note. Fontsource keeps the files in the bundle.

### Phase 1: complete the base token set (#196)

- Add to `web.css` and `admin.css` a base value for every non-colour token a tweakcn preset sets: `--font-sans`, `--font-serif`, `--font-mono`, `--shadow-color`, `--shadow-opacity`, `--shadow-blur`, `--shadow-spread`, `--shadow-offset-x`, `--shadow-offset-y`, `--shadow-2xs` through `--shadow-2xl`, `--tracking-normal`, `--spacing`, `--letter-spacing`. Pick values that reproduce today's rendering (admin keeps Inter; web keeps the current stack).
- Extend each file's `@theme inline` with the font, shadow and tracking mappings, and add `body { letter-spacing: var(--tracking-normal) }` to the base layer.
- Add `@import "./presets/index.css";` to both files, and ship an empty generated `presets/index.css` and a `presets.gen.ts` that lists only `default`.
- Refresh the `apps/web/DESIGN.md` fingerprint and the admin `DESIGN.md`. Add the move to `saasaloy update`'s merge plan for an existing project, with the manual steps in the base `AGENTS.md`.

Done when: a fresh `.dev` project builds, a screenshot diff of the landing page and the admin shell in light and dark shows no visual change, `pnpm verify:preset` and `pnpm deps:verify` are green, and `scripts/verify-preset.ts` still counts one `:root`, `.dark`, `@theme inline` and `@custom-variant dark` per theme file.

### Phase 2: the runtime preset axis (#196)

- In `theme.ts`, add `PRESET_STORAGE_KEY`, `PRESET_ATTRIBUTE` (`data-preset`), `PRESET_PICKER_ATTRIBUTE`, `getStoredPreset(available, fallback)`, `setPreset(name)`, and an `isPreset` guard. Keep the file Node-importable, with no `window` at module scope.
- Extend `THEME_INIT_SCRIPT` into a factory, `themeInitScript({ presets, defaultPreset })`, that bakes the installed names and the app's default into the string. It sets `data-preset` pre-paint, validates the stored value against the baked list, and installs a delegated `change` listener on `[data-theme-preset]`. Keep the ES5 syntax rule.
- Extend `installThemeToggle` with the same `change` listener, and give the admin entry an `applyStartingPreset()` beside `applyStartingTheme()`.
- Add the `theme-preset-picker` block, with its labels in `packages/ui/src/content/` so `verify:content` stays green. Place it next to the toggle in the web navbar host and in the admin shell header.
- Unit-test the state machine: stored, unknown, removed and unwritable-storage cases, and the light / dark cross product.

Done when: in a project with two hand-written preset files, picking a preset repaints both apps, a reload keeps the choice with no flash of the default, a removed preset falls back to the default, the landing page ships no new `client:*` directive, and the `theme.ts` tests pass under `pnpm test`.

### Phase 3: `saasaloy theme` command (#196)

- Add `packages/cli/src/commands/theme.ts` with `add`, `remove`, `list` and `default`, registered in `commands/index.ts` and described in `descriptions.ts`.
- `add` fetches the registry item, checks `type: "registry:style"` and both `light` and `dark`, filters to the known token keys, rejects unsafe values, writes `presets/<name>.css`, records the entry in `saasaloy.json`, and regenerates `presets/index.css` and `presets.gen.ts`. It refuses a name that exists unless `--force` is passed, and refuses the name `default`.
- `remove` deletes the file and the record and regenerates. It clears an app default that pointed at the removed preset back to `default`, and says so.
- `list --available` reads `https://tweakcn.com/r/registry.json`.
- Test offline against a fixture registry item. Put the live tweakcn fetch in a `*.remote.test.ts`, off the standing gate, as `registry.remote.test.ts` does.

Done when: in `.dev`, `saasaloy theme add claude vercel` writes two preset files and a `themes` block, `saasaloy theme default claude --app web` makes a cleared-storage visit paint Claude, `saasaloy theme remove vercel` leaves a clean build, a fixture with `"primary": "red;} body{display:none"` fails with no file written, and `pnpm test` is green.

### Phase 4: automatic fonts (#196)

- In `theme add`, parse `font-sans`, `font-serif` and `font-mono` from `cssVars.theme`, take the first family of each stack, and resolve it to a Fontsource package through `https://api.fontsource.org/v1/fonts/<id>`, preferring the variable cut.
- Add each package exact-pinned to `packages/ui/package.json`, write its `@import` at the top of the preset file, and run the project's install once. `theme remove` drops a font package no other preset or base file uses.
- Skip generic and system families, and warn (do not fail) when a family has no Fontsource package.

Done when: `saasaloy theme add modern-minimal` adds `@fontsource-variable/inter`, `@fontsource-variable/jetbrains-mono` and a Source Serif 4 package to `packages/ui`, the built CSS holds their `@font-face` rules, the network panel shows the font files load only after the preset is picked, and `saasaloy theme remove modern-minimal` removes the packages again.

### Phase 5: docs, skill and drill (#196)

- Replace the "Swapping the whole theme for a preset" section of the base `AGENTS.md` with the `saasaloy theme` workflow, and keep the `shadcn add` recipe as the way to change the base values themselves.
- Update the base design skill, `docs/wiki/how-to/make-it-yours.md`, `docs/wiki/reference.md` (the new command) and the `CONTEXT.md` glossary (`preset`, `default preset`).
- Add `pnpm verify:themes`, a network drill like `verify:preset` and outside `deps:verify`, that runs `theme add` against live tweakcn in `.dev/playground` and builds both apps.

Done when: `pnpm verify:themes` is green, `pnpm lint` is green, and the wiki command reference lists every `saasaloy theme` subcommand with a working example.

## Open questions

- Bundle size: each preset adds about 3 KB of CSS to every page, before compression. Do we cap the installed count, or only warn above a threshold such as 10?
- Does Tailwind 4's `@import` resolve a Fontsource package from a preset file inside `packages/ui` when the app (`apps/web`, `apps/admin`) builds it? This needs a spike before Phase 4. If it fails, the font imports move to each app's entry.
- Phase 1 changes two base-owned files in every existing project. Is a merge-plan entry plus manual steps enough, or does it need its own `saasaloy update` migration?
- Should a project be able to install a preset for one app only (for example, the admin keeps only its measured palette), or is one shared set for both apps right?
- Some tweakcn presets set `--spacing` and `--letter-spacing`. Changing `--spacing` reflows every layout. Do we apply it, or strip it as a colour-and-type-only preset?
- What does the picker show in each option: the title only, or a colour swatch too? A swatch needs CSS per option, and a native `<select>` cannot style options in every browser.
- Does `saasaloy theme` belong in the base CLI, or in a `themes` module that a project adds? It touches only `packages/ui`, which every project has.

## Non-goals

- Per-tenant or per-user themes stored in the database, or set from the admin app at request time.
- A theme editor inside the scaffolded project. tweakcn is the editor.
- Loading a preset from a URL at runtime in the browser. Every preset is installed at build time.
- Per-component or nested themes on one page.
- Preset support for app types other than `web` and `admin`.
- Changing how `shadcn add` swaps the base values. That path stays as it is.
