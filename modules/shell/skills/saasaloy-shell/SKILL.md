---
name: saasaloy-shell
description: Runbook for the shell capability — the frame, the coss primitive set, the page blocks, the command contract, the shell extension seam and shell.css under @repo/ui/*/shell that every signed-in SPA (admin, app) renders. Use when adding a nav entry or an area, declaring a screen's commands or keyboard shortcuts with useCommands, adding a shell extension, using the shell in a new app, wiring ShellLayout (areas, link, account, signOut, counts, subtitle, trail), composing a page from PageHeader, PageLayout, PageBody, DataTable, DetailPanel, FilterChips, EmptyState, ErrorState or StatusPill, picking a primitive, setting the status, sort-accent or motion tokens an app stylesheet overrides, fixing an unstyled primitive or a transparent status pill, upgrading a project that installed admin before the shell moved out of it, or removing the module.
---

# shell — the frame every signed-in app renders

`shell` writes one UI kit into `@repo/ui`: the app frame (layout, sidebar, nav, account menu, theme submenu), the page frame and layouts, the page blocks, about 40 primitives adapted from coss ui on Base UI, three helpers, the brand mark, and one stylesheet layer. `admin` and `app` both depend on it, so a project gets it through either one, or alone with `saasaloy add shell`.

It holds **no auth logic and no router**. Each app reads its own session and router and passes them in as props: `admin` guards on the role, `app` on the session. It depends on no module, imports no app stylesheet, and reads semantic tokens only, so it renders in the admin theme and in the web brand theme alike.

| Folder in `packages/ui/src/` | What it holds |
|---|---|
| `components/shell/` | the primitives and `NOTICE.md` (the MIT notice the copy needs) |
| `blocks/shell/` | `PageHeader`, `DataTable`, `DetailPanel`, `FilterChips`, `AttributeList`, `EmptyState`, `ErrorState`, `PageSkeleton`, `BrandMark`, `ThemeMenuItem` |
| `containers/shell/` | `ShellLayout`, `ShellSidebar`, `ShellNav` types, `PageFrame`, `PageLayout`, `PageBody` |
| `lib/shell/` | `withLiveCounts`, `useMediaQuery`, the segmented-control variants, the command contract (`commands.ts`) and the extension seam (`extensions.ts`) |
| `assets/shell/` | `brand-mark.svg` (replace it with your own single-colour mark) and `assets.d.ts` |
| `styles/shell.css` | the `@source` line for the primitives, the status and sort tokens with defaults, the skeleton and toast motion |

It also adds `@tanstack/react-table` to `packages/ui/package.json`, for `DataTable` alone.

## Use the shell in a new app

A new signed-in app is a Vite SPA like `apps/admin` or `apps/app`. Four steps put it in the frame:

1. **Make one stylesheet** at `packages/ui/src/styles/<app>.css` and import it once from the app's `src/main.tsx`. It imports a theme, then `shell.css`, then sets any value it changes:

   ```css
   @import "./brand.css"; /* the web brand tokens, or "./globals.css" plus a token block of its own */
   @import "./shell.css";

   :root {
     --sidebar: oklch(0.97 0 0);
   }
   ```

2. **Add the app to the lint rule.** Add `apps/<app>/**` to the twin-primitive rule's `files` in `oxlint.config.mjs`, so a base primitive there is an error.

3. **Write an `AppShell`** in the app's `src/components/app-shell.tsx` that reads the router and the session and renders `ShellLayout`. `apps/admin/src/components/app-shell.tsx` is the worked example:

   ```tsx
   <ShellLayout
     areas={NAV_AREAS}
     area={areaFor(pathname)}
     currentPath={pathname}
     link={ShellNavLink}
     account={{ name, email: session.user.email, initials: initialsOf(name) }}
     signOut={signOut}
     subtitle={null}
   >
     {children}
   </ShellLayout>
   ```

   | Prop | What it takes |
   |---|---|
   | `areas`, `area` | the app's `NAV_AREAS` and the area of the current path |
   | `currentPath` | the router's pathname; the sidebar marks the active row with it |
   | `link` | a component that renders the router's `Link` and sets `aria-current` |
   | `account` | `name`, `email` and `initials` for the account menu |
   | `signOut` | `{ signOut, pending, error }`; a success navigates to the app's sign-in route |
   | `counts?` | live nav counts keyed by a row's `to` (see `saasaloy-admin`) |
   | `subtitle?` | the line under the product name; `"Admin"` by default, `null` hides it |
   | `trail?` | `readonly { label: string; to?: string }[]`, the page path after the area when it goes deeper than the nav label, for example Projects / New project. A step with `to` renders through `link`; the last step is the current page |
   | `organizationPicker?` | the #141 organization picker slot |
   | `extensions?` | the app's `shellExtensions` list; see [Shell extensions](#shell-extensions) |

4. **Wrap the routes** in `PageFrame` in the root route, and set the router's `defaultPendingComponent` to `PageSkeleton` and `defaultErrorComponent` to a route error that renders `ErrorState`. Mount the toast provider from `components/shell/toast` once.

The guard stays in the app's root `beforeLoad`. The shell renders whatever the app hands it and never checks a session.

## Add a nav entry

The nav data lives in the app, in `src/components/nav.ts`, as `NAV_AREAS` with `as const`. The shell reads it through the structural types in `containers/shell/shell-nav.tsx`, where `to` is a plain string, because `@repo/ui` imports no router.

- **A row** is one `{ to, label, icon, count? }` in a group's `items`. A module adds it with a `nav-entry` patch on `apps/<app>/src/components/nav.ts`.
- **A group** is one `{ label, items }` in an area's `groups`.
- **An area** is one entry in `NAV_AREAS`. The header's page path starts with its label.

Keep the `as const`: it holds every `to` at a literal type the router checks, so a row for a missing route fails `pnpm typecheck`. `saasaloy-admin` has the full nav and live-count recipe.

## The primitive set and the page blocks

This module writes the whole UI kit of the signed-in apps into `packages/ui/src/`, and their code uses nothing else:

- **`components/shell/`** holds the primitives: 41 components adapted from coss ui on Base UI, plus `StatusPill`. Alert, alert dialog, autocomplete, avatar, badge, breadcrumb, button, card, checkbox, collapsible, combobox, command, dialog, empty, field, fieldset, form, group, input, input group, kbd, label, menu, meter, popover, radio group, scroll area, select, separator, sheet, sidebar, skeleton, spinner, switch, table, tabs, textarea, toast, toggle, toggle group and tooltip. The names are coss's: `*Popup` and `*Panel` for the parts shadcn calls `*Content`, `Menu*` for the dropdown menu, and a `render` prop instead of `asChild`. A few shadcn aliases (`DialogContent`, `DropdownMenu*`, `TabsTrigger`) are exported too. `NOTICE.md` in the folder carries the MIT notice the copy needs; keep it there.
- **`blocks/shell/`** holds the page blocks below, plus `BrandMark`, `ThemeMenuItem` and `ErrorState`. `ThemeMenuItem` (in `theme-toggle.tsx`) and `ErrorState` are the shell twins of the base blocks; the theme control is a row in the sidebar's account menu, not a header button.
- **`containers/shell/`** holds `ShellLayout`, `ShellSidebar`, `PageFrame`, `PageLayout` and `PageBody`.
- **`lib/shell/`** holds two helpers the primitives use, and **`assets/`** holds the brand mark.

A lint rule in `oxlint.config.mjs` fails any import of a base `@repo/ui/components/*`, `@repo/ui/blocks/error-state` or `@repo/ui/blocks/theme-toggle` under `apps/admin/**`, `apps/app/**` and the `shell/` folders of `@repo/ui`. Both sets have a `button`, and without the rule an editor's autocomplete picks the wrong one with no error.

The copy is frozen. Nothing syncs from coss: a fix or a new component is a hand edit in `components/shell/`, from coss's MIT registry folder only and never from its AGPL `packages/ui`.

The page blocks take plain props and callbacks. None imports `@repo/api`, `hono/client`, an app's `lib/api` or `import.meta.env`.

| Block | Import | Props | Notes |
|---|---|---|---|
| `PageHeader` | `blocks/shell/page-header` | `title`, `count?`, `description?`, `actions?` | The page's only `h1`. `count` stays out of the heading text; `0` renders, `undefined` does not. `actions` holds the page-level buttons, such as Refresh or New. |
| `PageBody` | `containers/shell/page-body` | `children` | The padded, scrolling body under the header, for cards, forms and editors. A list page that hands its height to `DataTable` does not need it. |
| `PageLayout` | `containers/shell/page-layout` | `children`, `detail?`, `detailLabel?`, `onDetailClose?` | Puts a list beside its detail. `detail` docks as a column at `md` and up and opens as a bottom sheet below it; the same node either way. Passing `undefined` closes both. |
| `DataTable` | `blocks/shell/data-table` | `columns`, `rows`, `rowId`, `caption`, `onRowClick?`, `selectedId?`, `emptyState?` | See below. |
| `DetailPanel` | `blocks/shell/detail-panel` | `title`, `onClose`, `description?`, `media?`, `status?`, `banner?`, `attributes?`, `groups?`, `tabs?`, `actions?`, `footer?`, `onOpenInNew?` | A header with the record's avatar, name and second line, optional tabs, then the attributes, collapsible groups and the record's actions. `status` renders after the title in the header, for one `StatusPill` or two; when the header shows the status, drop the status attribute row. `banner` renders under the header and above the tabs and does not scroll; pass an `Alert` from `components/shell/alert`. `footer` is pinned under the scrolling body behind a hairline, for the record's main decision such as Confirm and Reject. `actions` stays inside the scrolling body, for in-body controls such as a role select. A panel with none of the three renders as before. It draws no border; `PageLayout` supplies the edge. |
| `FilterChips` | `blocks/shell/filter-chips` | `chips`, `selectedId`, `onSelect`, `label` | Each chip is a real `button` with `aria-pressed`. Filtering is the route's. |
| `AttributeList` | `blocks/shell/attribute-list` | `items` | A `dl` of label and value. An empty value renders as an em dash. |
| `EmptyState` | `blocks/shell/empty-state` | `title`, `description?`, `icon?`, `action?` | The filler for `DataTable`'s `emptyState`. Write different words for an empty list and a list filtered down to nothing. |
| `ErrorState` | `blocks/shell/error-state` | `code`, `title?`, `description?`, `detail?`, `primaryAction?`, `secondaryAction?` | The error screen, with the words from `content/errors.ts`. |
| `StatusPill` | `components/shell/status-pill` | `label`, `tone?`, `icon?` | Five tones: `neutral` (the default), `open` (the solid fill of a live state), `ok` (settled, such as paid or verified), `warn` (waiting on someone, such as pending or open) and `bad` (a failure, such as site closed). Use it for a value that is a state; a tag such as a plan name, a flag type or a count stays a `Badge`. The route maps a value onto a tone. |

`DataTable` is the only file that imports `@tanstack/react-table`, and that is the point: a caller describes its screen with `columns` and `rows` and never sees a `ColumnDef` or a sorting state. A column is:

```tsx
{ id, header, value, cell?, sortable?, align?, card? }
```

`value(row)` is both the sort key and the cell content when `cell` is absent, so the two cannot fall out of step. `cell(row)` renders anything richer. `rowId(row)` keys the rows, matches `selectedId`, and is what `onRowClick` should store, because an index breaks the moment a sort reorders the table. Sorting is client side and two-state, and the active header is the one place `--accent-sort` appears. Empty cells render `—`, a boolean renders `Yes`/`No`, and a `Date` renders through `toLocaleDateString()`.

Below `md` the same rows render as a `<ul>` of cards, so a list has no sideways scroll at 360 px. The table and the card list never mount together: `DataTable` reads the width through `useMediaQuery("md")` from `lib/shell/use-media-query`, the same call `PageLayout` makes. A card is a title row over a `<dl>` of label and value lines, each label the column's `header`. The column's `card` hint picks its place: `title` heads the card, `trailing` sits at the right of the title row (an amount, a status, a role), `line` is a label and value line, and `hidden` leaves the column out. With no column hinted `title`, the first column is the title, and every other unhinted column is a line, so a page with no hints still gets usable cards. The cards keep the order the table's sort state gives and show no sort control. With `onRowClick`, each card is one `<button>` with `aria-current` on the selected one and the table's focus ring; the selected card takes the same accent fill as the selected row. The empty state and the caption carry over. The slot rule is `cardSlots(columns)` in `blocks/shell/data-table-cards.ts`, JSX-free so `pnpm test:modules` covers it in this repo. Set `card: "trailing"` on the one column a reader scans for, and `card: "hidden"` on a column that only makes sense beside the others in a table.

Inside a page, build every control from the primitive set: `Field` with `FieldLabel` and `Input`, `Select` or `Checkbox` in a form; `Switch` for an on/off setting; `Dialog` for a create flow; `AlertDialog` before a revoke, a delete or a cancel; and `toastManager.add({ type, title, description })` from `components/shell/toast` for the result of every mutation. Each app mounts the toast provider once in its `__root.tsx`.

## Declare a screen's commands

A screen declares what it can do with `useCommands` from `@repo/ui/lib/shell/commands`. The shell holds the contract and no engine. The `command` module mounts the provider that turns each declared command into a palette row, a key binding and a line in the `?` shortcut sheet. With no provider mounted, `useCommands` does nothing, so a screen declares its commands whether or not `command` is installed and needs no dependency on it.

```tsx
import { useCommands } from "@repo/ui/lib/shell/commands";

useCommands(
  [
    {
      id: "admin.show-admins",
      title: "Show admins",
      group: "page",
      keywords: ["role", "filter"],
      run: () => {
        setRoleFilter("admin");
      },
    },
  ],
  { scope: "route", label: "Users" }
);
```

A command is `{ id, title, group, keywords?, icon?, shortcut?, when?, run(ctx) }`:

- `id` is `<module>.<verb>`, for example `admin.go-to-users`. It is unique across the app.
- `group` is `page`, `navigation`, `actions` or `preferences`. The palette shows the page group first, under the registration's `label`.
- `shortcut` is a logical key, so it follows the typed character on every layout: `Mod+K` (Cmd on macOS, Ctrl elsewhere), `?`, `J`, `Enter`, `Escape`, or a sequence written with spaces, such as `G U`. A key exists only on a command, so the palette and the sheet can never miss one.
- `when` hides the command and disables its key while it returns `false`. `run` receives `{ source: "palette" | "shortcut" }`.

`useCommands` registers in an effect and unregisters when the component unmounts. A new `run` or `when` closure on each render does not register again; the registered command calls the latest one. A change to an id, a title, a group, a shortcut, the keywords or the scope does register again. `icon` is read at registration time, so pass a module-level icon component.

The `scope` says how long a registration lives and which keys may overlap:

| Scope | What it holds | Lives while |
|---|---|---|
| `global` | the app's own commands: navigation, theme, sign out, the sidebar | the shell is mounted |
| `route` | the current page's commands, listed first in the palette under `label` | the page is mounted |
| `data-table` | the table keys `DataTable` declares | a `DataTable` is mounted |

The shell declares two sets itself. `SidebarProvider` declares `shell.toggle-sidebar` on `Mod+B` in `global`; it keeps its raw Cmd/Ctrl+B listener only while `useCommandProvider()` is `false`, so the key works with or without `command` and never toggles twice. `DataTable` declares `J` (next row), `K` (previous row), `Enter` (open the highlighted row, the same call a row click makes) and `Escape` (drop the highlight) in `data-table`. The highlight takes the rows' hover tone, so it never reads as the selection. Closing the detail panel stays with the route, which owns the selection.

Before you bind a key, read the reserved key table in the `saasaloy-command` skill. `C`, `E`, `Mod+Backspace`, `/` and `G` then a letter carry one meaning each across every app. Use a reserved key only for its meaning, or pick an unreserved key. Two bindings that clash in overlapping scopes throw in dev.

## Shell extensions

A module adds itself to every shell app through `defineShellExtensions` from `@repo/ui/lib/shell/extensions`, not by editing the shell. Each app holds its list in `src/components/shell-extensions.ts` and passes it to `ShellLayout` as `extensions`:

```ts
export const shellExtensions = defineShellExtensions({ extensions: [] });
```

An extension is `{ id, Provider, header? }`. `Provider` wraps the whole layout, the first entry outermost. `header` renders at the right of the header, after the page path. A module ships a factory such as `commandExtension()`, and the app's descriptor appends a bare call to it with a `plugin-array` patch, gated on the module being installed. Keep the `extensions` property even while the array is empty, or the patch has nothing to append into. Two entries with one `id` throw at load. With an empty list, `ShellLayout` renders exactly what it rendered before the prop existed.

## Tokens and motion

`shell.css` declares and maps every token the shell reads beyond the shadcn set a theme file defines:

- `--success`, `--warning` and `--info`, each with a `-foreground` text tone, and `--destructive-foreground`. A pair is a fill tone and the darker text on an 8 % tint of it, never a contrast colour for a solid fill.
- `--status-ok`, `--status-warn`, `--status-bad` and `--status-open`, each with a `-foreground`: `StatusPill`'s tones. The first three copy the pairs by default. They are names of their own so a theme preset, which sets `--destructive` with another meaning, never repaints a status.
- `--accent-sort`: `DataTable`'s active sort header, one indicator at a time.
- `--animate-skeleton` and the four `--animate-toast-*` animations, with their keyframes.

The defaults are the neutral values of the approved `app` mockup: Tailwind's emerald, amber and blue at the steps the base theme uses for its red, and neutral greys for `status-open` and `accent-sort`. They sit in `:where(:root)` and `:where(.dark)`, at zero specificity, so a theme file's values and an app's own `:root` and `.dark` blocks always win. `admin.css` replaces each one with its measured backoffice value.

Two rules follow:

- **Override a token in `:root` and in `.dark` together.** An override in `:root` alone also wins under `.dark`, because the default it beats has zero specificity.
- **A shell file reads only a token the base theme or `shell.css` defines.** `scripts/shell-tokens.test.ts` in the Saasaloy repo checks it, so the shell renders in any app with no admin token file.

## Wire-up

After `saasaloy add shell`:

1. Run `pnpm install`, for `@tanstack/react-table`.
2. Import `shell.css` from each app stylesheet, after the theme, as [Use the shell in a new app](#use-the-shell-in-a-new-app) shows. `admin` and `app` ship that import already.
3. Run `pnpm typecheck` and `pnpm lint`.

## Upgrade a project that installed admin before shell

Before `shell`, the `admin` module wrote this kit under `@repo/ui/*/admin`. Move a project across in one pass:

1. Commit or stash your work, so the update's merge plan is the only change in the tree.
2. Update every installed module in one run: `saasaloy update`. The new `admin` depends on `shell`, so the plan installs `shell`, removes each unchanged file under `components/admin/`, `blocks/admin/`, `containers/admin/` and `lib/admin/`, and writes the new imports into `admin` and every module with an admin screen (`teams`, `billing`, `payment`, `feature-flags`, `multitenant`, `file-uploads`, `api-keys-organization`).
3. Resolve the merge plan. A shell file you edited under the old path stays there, and the update lists it. Move your edit into the file at the new path, delete the old file, then run `saasaloy update --resolved <path>` for a file the plan marks as a conflict. A replaced logo is the common case: copy your `packages/ui/src/assets/brand-mark.svg` over `packages/ui/src/assets/shell/brand-mark.svg`, then delete the old one.
4. Change the imports in your own files. The pattern skips `blocks/admin/feature-flags`, the one admin-only block, which the update already points at the right place:

   ```sh
   grep -rlE '@repo/ui/(components|blocks|containers|lib)/admin/' apps packages/ui/src \
     | xargs perl -pi -e 's#\@repo/ui/(components|blocks|containers|lib)/admin/(?!feature-flags)#\@repo/ui/$1/shell/#g'
   ```

5. Copy the new `oxlint.config.mjs` twin-primitive rule from the base template, or change its globs and its `!@repo/ui/components/admin/*` line to `shell` by hand.
6. Run `pnpm install`, then `pnpm check`. A project made before `pnpm check` runs `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` instead.

## Removal

`saasaloy remove shell` refuses while `admin` or `app` is installed, because both depend on it. Remove them first. Then the remove deletes every file this module wrote; an app stylesheet that still imports `shell.css` fails its build, so delete that import too.

## Failure modes

- **Every primitive renders unstyled, with no error.** The app stylesheet does not import `shell.css`, so Tailwind never scans `components/shell/`.
- **A status pill or an alert has no fill.** A token is missing: the stylesheet imports `shell.css` before its theme instead of after, or a shell file reads a token no file defines. Run the token check.
- **Dark mode shows a light status colour.** An app overrides that token in `:root` and not in `.dark`.
- **A button looks like the landing page's.** A base primitive slipped in. `pnpm lint` names the import.
- **`failed to resolve import @tanstack/react-table`** after an update. pnpm linked the package without its React peers; run `pnpm install --fix-lockfile` once.

## Conventions to honor

- **No auth, no router, no IO in the shell.** A container takes its data, links and callbacks as props.
- **Semantic tokens only.** A shell file names no app's token file and no value.
- **One primitive set.** Signed-in app code imports `@repo/ui/components/shell/*`, never a base primitive.
- **`@tanstack/react-table` is imported by `data-table.tsx` and by nothing else.**
- **A shortcut lives on a command.** Declare it through `useCommands`, never with a raw `keydown` listener. The sidebar's fallback listener is the one exception, and it stands down while a command provider is mounted.
- **The copy is frozen.** A fix is a hand edit, from coss's MIT registry folder only.
