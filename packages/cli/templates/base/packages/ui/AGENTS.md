# `@repo/ui` — the design layer

This file holds the rules for `packages/ui`: the theme, the primitives, the blocks, the containers and the copy. The root `AGENTS.md` holds the rules for the whole repository, and they apply here too. Read this file before you add or change UI in any app.

## What lives here

`packages/ui` owns the design layer: the Tailwind 4 theme in `src/styles/`, the `cn()` helper and the client-state stores in `src/lib/`, the vendored [shadcn](https://ui.shadcn.com) primitives in `src/components/`, the **blocks** in `src/blocks/`, the shells and layouts in `src/containers/`, and the copy in `src/content/`.

Those layer folders are the whole top level of `src/`: `assets` (images, SVGs and icons, added when the first one arrives), `blocks`, `components`, `containers`, `content`, `lib` and `styles`. Do not add an app folder such as `src/admin/` or `src/web/` beside them. When one app needs its own files inside a layer, give that layer a child folder (`blocks/admin/`, `components/shared/`).

## The theme

The theme is one shared file, one brand file, and one stylesheet per app:

- **`src/styles/globals.css`** is the shared layer: the Tailwind imports, the `@source` globs and the base layer. It holds no token values, and no app imports it directly.
- **`src/styles/brand.css`** is the product's theme: the `dark` custom variant, the `:root` and `.dark` token values, the `@theme inline` colour mapping and the radius scale. It imports `globals.css`, so an app stylesheet that imports `brand.css` gets the whole theme. `components.json` points here, so a shadcn preset lands here.
- **`src/styles/web.css`** is the web app's stylesheet. It imports `brand.css` and adds the landing page's layout, type and motion utilities, which a preset leaves alone. `apps/web` pulls it in once, through the shared layout that imports `@repo/ui/styles/web.css`.
- **`src/styles/admin.css`** is the admin app's theme, written by `saasaloy add admin`. It imports `globals.css` and carries its own tokens in the same shape as `brand.css`.

Each theme file repeats the `dark` variant and the `@theme inline` mapping on purpose. shadcn merges a preset in place only when the target file itself holds them, and it does not look through an `@import`. Move either one into `globals.css` or `web.css` and a preset appends a duplicate to `brand.css` instead.

**Each app has its own `DESIGN.md`, in its own folder.** `apps/web/DESIGN.md` records the tokens in `brand.css`, the landing vocabulary in `web.css` and the rules behind them, and fingerprints `brand.css`. An app that carries its own theme file gets its own `apps/<app>/DESIGN.md`, which fingerprints that file. There is no `DESIGN.md` at the repository root. Read the document for the app you are changing before you add or change UI.

With the admin app installed, `apps/admin/DESIGN.md` records the admin tokens in `packages/ui/src/styles/admin.css` and fingerprints that file. A preset never targets `admin.css`; the admin theme changes by hand.

## Imports and the folder layout

Primitives, blocks and containers are reached by subpath — none is re-exported from the package root, so importing one never drags in the rest. The root export is project-wide constants only (`siteName`, which re-exports `config.app.name`):

```ts
import { siteName } from "@repo/ui";
import { Button } from "@repo/ui/components/button";
import { PricingTable } from "@repo/ui/blocks/pricing-table";
import { landing, ui } from "@repo/ui/content/landing";
import { cn } from "@repo/ui/lib/utils";
```

**The signed-in apps share their own primitive set.** `saasaloy add shell` writes it into `src/components/shell/`, with its blocks in `src/blocks/shell/`, its shell and layouts in `src/containers/shell/`, and its tokens and motion in `src/styles/shell.css`. `admin` and `app` install `shell` for you. Their code imports only that set, and a lint rule makes a base primitive under `apps/admin/**` or `apps/app/**` an error, because both sets have a `button` and the wrong one renders with no complaint:

```ts
import { Button } from "@repo/ui/components/shell/button";
import { DataTable } from "@repo/ui/blocks/shell/data-table";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";
```

The `saasaloy-shell` skill lists the whole set and how a page composes it.

**Seven top-level folders, and no app folder at the root of `src/`.** A folder may hold `shell/`, `admin/`, `web/` or `shared/` children where one module owns the files, for example `src/blocks/shell/` or `src/containers/shell/`, which `saasaloy add shell` writes. A project without that module carries none of them.

1. **`src/assets/`** holds images, SVGs and icons. The base ships no asset, so the folder does not exist until the first one lands, together with an `assets.d.ts` that types its imports.
2. **`src/components/`** holds the vendored shadcn primitives, official and custom. No stores, no copy.
3. **`src/blocks/`** holds compositions of primitives plus copy from the content module. Local state is allowed (an open accordion, a ticking clock). Importing a shared store is forbidden: a block takes its data as props and reports changes through callbacks, so every app can drive the same block from its own data source.
4. **`src/containers/`** holds the shells and layouts that hold blocks and components on a page: an app shell, a page layout, a page frame. A container takes its data, its links and its callbacks as props. It imports no router and no session, so the app that owns them passes them in.
5. **`src/content/`** holds copy, in one place for later translation.
6. **`src/lib/`** holds utilities and the client-state stores.
7. **`src/styles/`** holds the CSS files with the token variables.

**One rule covers the whole package: no IO in `@repo/ui`.** No fetch, no persistence, no auth, no router, in any layer. Client-state stores (nanostores) live in `src/lib/`; the app that owns the data hydrates the store and passes what a block needs as props. When a store-shaped need shows up in a block, move the binding up into the app instead of importing the store in place.

## Primitives and presets

**Adding a primitive the base doesn't vendor.** `shadcn` is already an exact-pinned dependency of `@repo/ui`, so reach it with `--filter … exec` — that runs in the package directory, where `components.json` lives:

```sh
pnpm --filter @repo/ui exec shadcn add dialog
```

- **Not `pnpm -C packages/ui dlx …`.** `-C` scopes pnpm's own workspace resolution; it does *not* change the directory `dlx` spawns the command in. shadcn then looks for `components.json` wherever your shell happens to be and dies at `Verifying framework`. If you must use `dlx`, pass shadcn's own flag: `--cwd packages/ui`.
- Never `npx` (see "Never Do" in the root `AGENTS.md`).
- The CLI writes into `src/components/`. Anything it appends to `package.json` arrives as a range — **re-pin it to an exact version**.
- **Add the primitive to a `@source` list, or it renders unstyled.** `globals.css` names the components it scans one file at a time, because Tailwind scans content rather than imports and a blanket glob charges every app for every primitive. A primitive the landing page or `src/blocks/` renders gets an `@source "../components/<name>.tsx";` line in `globals.css`; a primitive only one app renders gets its `@source` line in that app's own theme file, the way `src/styles/admin.css` takes the whole directory. Nothing errors when you skip this — the classes just never reach the CSS.
- `style` is `base-nova` (Base UI) and is fixed at init — the CLI cannot change it later.
- `rsc` is `false`, so the CLI strips the `"use client"` directive for you. It means nothing in Astro, and the vendored primitives don't carry it.

Primitives are source you own. Edit them in place rather than wrapping them.

**No UI kit or component library as a dependency.** When a design comes from a kit (Tailark, coss ui, a licensed dashboard kit), copy or rebuild the component into `src/components/` or `src/blocks/` as source this project owns. Do not install the kit's package, and keep no link to its repository for later updates. A copied component changes by hand, like any other file here. The shadcn CLI above is the one sanctioned way to fetch a primitive, because it writes source and leaves no runtime dependency behind.

**Swapping the whole theme for a preset.** The token set in `packages/ui/src/styles/brand.css` is shadcn's `neutral` with `cssVariables: true`, and any shadcn **`registry:style`** item is a drop-in replacement for it. The same `--filter … exec` form applies — there is no separate theme command:

```sh
pnpm --filter @repo/ui exec shadcn add https://tweakcn.com/r/themes/modern-minimal.json
```

The CLI merges the preset's `:root`, `.dark` and `@theme inline` blocks **into** the existing ones in `brand.css` and keeps its `@custom-variant dark`, so the hand-written parts in `globals.css` — the `@source` rules and the `@layer base` rules — stay put, the landing utilities in `web.css` stay put, and `components.json` is not touched. The preset reaches the web app only; the admin theme in `admin.css` keeps its own values. It usually *extends* `@theme inline` with mappings the base does not carry (fonts, tracking, shadows); that is expected.

Two places to get an item from:

1. **[`https://ui.shadcn.com/create`](https://ui.shadcn.com/create)** — first-party. Describe or dial in a theme and it hands you a URL.
2. **[`https://tweakcn.com`](https://tweakcn.com)** — a much larger preset library, serving items at `https://tweakcn.com/r/themes/<name>.json`.

Neither is special: the mechanism is the `registry:style` shape, so any URL that serves one works.

**This edits a file the project owns.** `brand.css` is an owned base file: `saasaloy update` never overwrites it, and a later template change to it reaches you only through the merge plan. A swapped theme is yours to maintain, including re-applying anything you had customised in `brand.css` that the preset overwrote. Diff the file after running the command rather than assuming.

A preset swap invalidates `apps/web/DESIGN.md`, which records the token values the old theme had. The `saasaloy-design` skill's `theme` flow runs the command above for you and re-derives the contract from the merged result, so prefer it over running the command by hand. Pick one or the other — running both applies the preset twice.

Theme switching is unaffected by any of this. It keys off the `.dark` class, which every preset keeps. The web toggle has two states, light and dark: `system` is only the starting state for a visitor who never pressed it, and no press steps back to `system`. Do not give the web toggle a third state or a light/dark/system menu. The signed-in apps are different: the `shell` account menu has a Light / Dark / System submenu, and it keeps it.

## Blocks

**Blocks — the page-level compositions.** `src/blocks/` holds the thirteen marketing blocks the landing page is built from: `navbar`, `hero`, `logo-cloud`, `pain-points`, `how-it-works`, `feature-grid`, `showcase`, `audience`, `testimonials`, `pricing-table`, `faq`, `cta` and `footer`. They need the landing utilities at the end of `web.css`, from the comment that opens "The landing page's layout" to the `stylelint-enable` line.

**The section recipe.** `index.astro` composes the page from explicit imports, one line per section. To remove a section, delete its line and its import, delete its file in `src/blocks/`, and blank its navbar and footer labels in `landing.ts`. To reorder, move the lines. Every block uses the same container (`section-container`, `-narrow`, `-wide`) and spacing (`section-y`) utilities from `src/styles/web.css`, so any order keeps one rhythm. A block sets no width, no section padding and no keyframes of its own; motion comes from the named utilities there (`blur-in`, `beam-in`, `reveal`, `marquee`, `shine-text`, `nav-float`, `hover-lift`), and every one stops under reduced motion.

**The logo recipe.** `landing.logos.items[]` is `{ id, name, mark }`. `mark` is a key in `LOGO_MARKS` at the top of `blocks/logo-cloud.tsx`. Paste a customer's SVG there under a kebab-case key with `fill="currentColor"`, then name the key in content. An unknown key renders `name` as a text wordmark.

**The production bar.** The page holds to a rubric: no axe violation at WCAG 2.1 AA in either theme, no sideways scroll from 360px up, nothing animating under reduced motion, a skip link to `<main>` on every page, link-preview metadata on `/`, and exactly two islands (`Navbar`, `PricingTable`). Keep each true when you change a block: a new section with state is a third island and needs a reason.

The rules below are not stylistic — each one prevents a real failure:

- **One block, one file, one component export (plus its prop types).** `pricing-table.tsx` exports `PricingTable` alongside `PricingTier` and `PricingTableProps`, and nothing else — no second component, no default export, no `blocks/index.ts` barrel. Astro gives every `client:*` component its own React root, so a compound primitive (accordion, dialog, dropdown) split across an `.astro` file throws "must be used within" at runtime. Keep the whole composition inside the block.
- **Props-driven, with every default read from the content module.** Every prop is still optional and still carries a default — but the *words* come from `packages/ui/src/content/landing.ts`, not from the block. `hero.tsx` has `title = landing.hero.title`; `pricing-table.tsx` holds no tier data at all. Keep the props for the cases a page really varies (a second landing page can override any of them); change the copy by editing the content module. See below.
- **Never pass a component or a function as a prop from `.astro`.** Astro serializes island props, so icons live *inside* the block. Swap one by editing the block.
- **Semantic kebab-case filenames** (`feature-grid.tsx`), never shadcn's registry-style `{category}-{NN}` numbering — that disambiguates variants in a public registry, and this project has neither.
- **Static by default.** A block with no state renders to HTML and ships zero JS. Add a client directive only to the block that actually needs the browser, and pick the cheapest one: `client:idle` above the fold, `client:visible` below it. A blanket `client:load` on the page hydrates everything and throws away the reason this is a static site — see `apps/web/src/pages/index.astro` for the worked example.
- **`theme-toggle` is the exception that proves the rule.** It sits in `src/blocks/` beside the marketing blocks but is chrome, not copy: `navbar.tsx` renders it inside the bar, and it needs **no** client directive of its own despite being interactive. It has no `onClick` and no state — the pre-paint inline script the shared layout emits (`THEME_INIT_SCRIPT`, from `packages/ui/src/lib/theme.ts`) drives every `[data-theme-toggle]` on the page through one delegated listener, and CSS picks the icon off `<html data-theme>`. Move it, restyle it via its `className`, or delete the one line in `navbar.tsx` to drop it. Do **not** "fix" it by adding `client:*` or an `onClick`, and do not paste a second copy of the boot script into a page: any document that renders the block must inline that one constant in its `<head>`, or the control stays hidden.
- **`error-state` is the only error screen, and every app renders it.** An app that adds a route surface answers a miss with `ErrorState` — `apps/web` through `src/pages/404.astro`, the admin SPA through the root route's `notFoundComponent` and its error boundary, and `apps/api` through `base.notFound(...)`, which answers the same `{ error: { code, message } }` envelope as every other failure. Do **not** write a second error screen in an app: one block means one restyle when the theme moves, and a bespoke copy drifts out of the token vocabulary the day nobody is looking. Change the words in `packages/ui/src/content/errors.ts`, the markup in `packages/ui/src/blocks/error-state.tsx`.
- **A `prerender = false` page inherits `500.astro`.** `apps/web` registers `@astrojs/cloudflare` while staying on `output: "static"`, so `src/pages/500.astro` is built ahead of time and carries no detail from the failed request. The day a page opts into on-demand rendering, a throw inside it lands on that page for free — nothing to add. Two things move on that day and only that day: `wrangler.jsonc` gains a `main` pointing at the server entry the adapter now writes, and `dist/server` stops being empty. Setting `main` before then breaks the build, which is why the comment in `wrangler.jsonc` says to wait.
- **A block never reaches the network; the app injects the behaviour.** A block that needs to send something takes a function prop (`onSubmit`) and calls it. It does not import an api package, an http client, or `import.meta.env`. Two reasons, both concrete. `packages/ui` has a `typecheck` script and consumes workspaces as source, so one `import type { AppType } from "@repo/api/client"` here makes `tsc` compile the entire Worker source tree under this package's tsconfig. And a block that hardcodes an endpoint is a block you cannot reuse on a second page. The counterpart lives in the app: a small React file under `apps/web/src/components/` builds the client and passes the function down. Astro serializes island props, so the page renders **that** file, never the block directly.
- **A link that leaves the site opens a new tab.** Spread `externalLinkProps(href)` from `@repo/ui/lib/external-link` onto the anchor and render `newTabHint(href)` inside it. The href decides: an absolute URL gets `target="_blank"`, `rel="noopener noreferrer"` and a screen-reader hint, and a path or a same-page anchor stays in the tab. Do not write `target="_blank"` by hand.
- **A value that waits on a request shows a skeleton.** Render the `Skeleton` primitive at the size the value will take until the response arrives, never a blank gap or a spinner. Add it with `pnpm --filter @repo/ui exec shadcn add skeleton` the first time a block needs it.
- **A block never imports a store either.** Local state is fine; shared state is not. The app-side island reads the store and passes the values and the handlers down, the same pattern it uses for `onSubmit`.
- **A module's UI arrives here too, and you wire it up by hand.** `saasaloy add <module>` writes a UI-bearing module's block into `src/blocks/` exactly like the base blocks, adds the app-side island that feeds it, and then stops: nothing globs a folder, and no command edits `index.astro`. The command prints a pointer to the module's skill, and that skill's **Wire-up** section carries the import line, the component to render, the client directive, and a suggested spot on the page. Put it where you want it. `saasaloy remove` deletes the files it wrote and leaves your import alone, so take that line out yourself.

Blocks, like primitives, are source you own — they are meant to be edited, not wrapped.

## Containers

**Containers — the shells and the layouts.** `src/containers/` holds the compositions that place blocks and components on a page: an app shell, a page layout, a page frame. The base ships none; `saasaloy add shell` writes the signed-in apps' into `src/containers/shell/`.

- **A container places, a block renders.** It decides where the panels, the header and the detail view go, and it adds no copy a block could hold.
- **No router, no session.** A container takes the nav data, the current area, a link component and the account as props. The app reads its router and its session and passes them in, so a container never depends on one app's routes.
- **Still no IO.** A container does not fetch, persist, or authenticate.
- **Same file rules as blocks:** one container per file, semantic kebab-case filename, no barrel.

## Copy

**The content module — where the words live.** `packages/ui/src/content/landing.ts` holds every user-visible string on the landing page, in two namespaces:

- **`landing.*`** — marketing copy. What the product is, who it is for, what it costs. This is the whole surface a copy rewrite touches. The brand itself is not here: it is `config.app.name` in `packages/config/src/project.ts`, is not translated, and is set once by `saasaloy-setup`. The currency symbol and the tier ids and names are read from `@repo/config` for the same reason — they are ids and numbers, and `packages/subscription` charges against the same ids.
- **`ui.*`** — chrome and accessibility labels (`Monthly`, `Most popular`, `Close menu`, `Billing period`). Nothing here says anything about the product, so a copy pass never rewrites it. It does get translated, key for key, when `landing.*` is written in some language other than English — no translation layer ships in the base, so that pass is the only one these strings get.

Blocks import it **directly** — `import { landing, ui } from "@repo/ui/content/landing"` — never as props from `index.astro`. Astro serializes island props, so passing content into `<PricingTable client:visible />` would write every string into the HTML payload *and* still ship the defaults inside the island's bundle. Direct import keeps the static blocks at zero JavaScript.

Five rules keep that file mechanically translatable — a translation layer reads a keyed record and nothing else. Follow them when you add a block or a key:

1. **Max three levels below a namespace** (`landing.features.title`). Compiler-based i18n libraries emit one flat identifier per message and cannot see deeper nesting.
2. **Position is never the key.** Lists are arrays whose items carry a stable `id`, so reordering the feature grid cannot silently reattach the wrong translation. One list is exempt — a tier's `features` bullets stay a plain `string[]`, because nothing reads them individually (a feature id and an FAQ id both anchor an item that outlives its wording) and a tier's bullets are rewritten with that tier. The content file states the trade-off in full.
3. **Single-brace `{token}` placeholders, never a template literal.** Copy is data; a template literal is a function, which no extraction tool can read. Render with `interpolate()` from `@repo/ui/lib/interpolate`.
4. **No runtime concatenation.** `/month` plus `", billed annually"` is two whole messages (`ui.pricing.perMonth`, `ui.pricing.perMonthAnnual`) — word order does not survive the seam in every language.
5. **Only user-visible strings move.** Section `id`s and the same-page anchors pointing at them are structure and stay in the block. A few things break the rule, all because a thing rewritten *with* the copy belongs *near* the copy: the whole `tiers` array (prices and `ctaHref`s included); every `icon`, held as a registry *name* like `"zap"` and resolved to a component by `packages/ui/src/lib/icons.ts`, and every logo `mark`, resolved by `blocks/logo-cloud.tsx`; every outbound link (`*Href`), which leaves the page and so cannot break a section link; and the code the page quotes (terminal commands, module names, file paths). A translation layer reads `id`, `icon`, `mark`, every `*Href` and the quoted code as non-message data. A pair of backticks inside a message renders as `<code>` through `inlineCode()` from `@repo/ui/lib/inline-code`.

**No copy that goes stale.** Do not write a version number, a release date or a count into a message. Say something general and link to where the current value lives: the hero pill says "See what's new" and links to the changelog, so it stays true across every release.

Two consequences worth knowing. Blanking a navbar or footer link's label in content drops that link, which is how a removed section loses its nav entry without editing a block. And the theme toggle's labels deliberately stay in `packages/ui/src/lib/theme.ts`: that file is inlined verbatim into a pre-paint `<script>` and is import-free on purpose.

**The default copy is Saasaloy's own.** A fresh project's page describes Saasaloy, and `config.app.name` defaults to `"Saasaloy"`, so the brand and the words agree until you replace both. `saasaloy-setup` writes the product brief and sets the name, and `saasaloy-landing-copy` rewrites `landing.ts` from the brief. Use them rather than editing thirteen blocks by hand, and if you do edit by hand, keep the strings in the content module so the next pass finds them.
