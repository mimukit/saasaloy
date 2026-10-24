---
version: alpha
name: "Admin"
description: "The admin app's design system: a dense, panelled backoffice on a measured neutral ramp, with alpha hairlines and a coss-style primitive set."
omitted:
  - section: spacing
    reason: "Tailwind's default scale is used unchanged; the page gutter is the one named step, in Layout"
colors:
  background: "oklch(0.96 0.008 73.74)"
  foreground: "oklch(0.197 0.005 67.53)"
  card: "oklch(1 0 0)"
  card-foreground: "oklch(0.197 0.005 67.53)"
  popover: "oklch(1 0 0)"
  primary: "oklch(0.258 0.007 67.5)"
  primary-foreground: "oklch(0.96 0.008 73.74)"
  secondary: "oklch(0.933 0.011 76.6)"
  muted-foreground: "oklch(0.517 0.016 74.29)"
  accent: "oklch(0.933 0.011 76.6)"
  destructive: "oklch(0.501 0.178 28.7)"
  destructive-foreground: "oklch(0.505 0.213 27.518)"
  border: "oklch(0 0 0 / 8%)"
  input: "oklch(0 0 0 / 11%)"
  ring: "oklch(0.708 0 0)"
  sidebar: "oklch(0.96 0.008 73.74)"
  status-open: "oklch(0.915 0.024 256.11)"
  status-open-foreground: "oklch(0.347 0.067 253.68)"
  status-ok: "oklch(0.696 0.17 162.48)"
  status-ok-foreground: "oklch(0.508 0.118 165.612)"
  status-warn: "oklch(0.769 0.188 70.08)"
  status-warn-foreground: "oklch(0.555 0.163 48.998)"
  status-bad: "oklch(0.501 0.178 28.7)"
  status-bad-foreground: "oklch(0.505 0.213 27.518)"
  accent-sort: "oklch(0.579 0.158 41.66)"
  success: "oklch(0.696 0.17 162.48)"
  success-foreground: "oklch(0.508 0.118 165.612)"
  warning: "oklch(0.769 0.188 70.08)"
  warning-foreground: "oklch(0.555 0.163 48.998)"
  info: "oklch(0.623 0.214 259.815)"
  info-foreground: "oklch(0.488 0.243 264.376)"
  dark-background: "oklch(0.134 0 0)"
  dark-foreground: "oklch(0.985 0 0)"
  dark-card: "oklch(0.199 0.011 260.66)"
  dark-card-foreground: "oklch(0.985 0 0)"
  dark-popover: "oklch(0.242 0.013 258.37)"
  dark-primary: "oklch(0.985 0 0)"
  dark-primary-foreground: "oklch(0.199 0.011 260.66)"
  dark-muted-foreground: "oklch(0.828 0.003 48.71)"
  dark-accent: "oklch(0.242 0.013 258.37)"
  dark-destructive: "oklch(0.704 0.191 22.216)"
  dark-destructive-foreground: "oklch(0.704 0.191 22.216)"
  dark-border: "oklch(1 0 0 / 8%)"
  dark-input: "oklch(1 0 0 / 10%)"
  dark-ring: "oklch(0.556 0 0)"
  dark-sidebar: "oklch(0.134 0 0)"
  dark-status-open: "oklch(0.395 0.069 257.5)"
  dark-status-open-foreground: "oklch(0.985 0 0)"
  dark-status-ok: "oklch(0.696 0.17 162.48)"
  dark-status-ok-foreground: "oklch(0.765 0.177 163.223)"
  dark-status-warn: "oklch(0.769 0.188 70.08)"
  dark-status-warn-foreground: "oklch(0.828 0.189 84.429)"
  dark-status-bad: "oklch(0.704 0.191 22.216)"
  dark-status-bad-foreground: "oklch(0.704 0.191 22.216)"
  dark-accent-sort: "oklch(0.729 0.152 39.51)"
  dark-success-foreground: "oklch(0.765 0.177 163.223)"
  dark-warning-foreground: "oklch(0.828 0.189 84.429)"
  dark-info-foreground: "oklch(0.707 0.165 254.624)"
typography:
  stat:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1.875rem
    fontWeight: 600
    lineHeight: 2.25rem
    letterSpacing: -0.025em
  page-title:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 1rem
    fontWeight: 600
    lineHeight: 1.5rem
    letterSpacing: -0.015em
  body-sm:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 400
    lineHeight: 1.25rem
  label-sm:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.875rem
    fontWeight: 500
    lineHeight: 1.25rem
  caption:
    fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif"
    fontSize: 0.75rem
    fontWeight: 500
    lineHeight: 1rem
rounded:
  sm: 0.5rem
  md: 0.625rem
  lg: 0.75rem
  xl: 1rem
  2xl: 1rem
components:
  canvas:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
  canvas-dark:
    backgroundColor: "{colors.dark-background}"
    textColor: "{colors.dark-foreground}"
  content-panel:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.lg}"
  content-panel-dark:
    backgroundColor: "{colors.dark-card}"
    textColor: "{colors.dark-card-foreground}"
  sidebar:
    backgroundColor: "{colors.sidebar}"
    textColor: "{colors.foreground}"
  sidebar-dark:
    backgroundColor: "{colors.dark-sidebar}"
    textColor: "{colors.dark-foreground}"
  nav-row-active:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.sm}"
    height: 2rem
  nav-row-active-dark:
    backgroundColor: "{colors.dark-accent}"
    textColor: "{colors.dark-foreground}"
  page-title:
    textColor: "{colors.foreground}"
    typography: "{typography.page-title}"
  stat-value:
    textColor: "{colors.foreground}"
    typography: "{typography.stat}"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.lg}"
    height: 2rem
  button-primary-dark:
    backgroundColor: "{colors.dark-primary}"
    textColor: "{colors.dark-primary-foreground}"
  button-outline:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
    height: 2rem
  input:
    textColor: "{colors.foreground}"
    typography: "{typography.body-sm}"
    rounded: "{rounded.lg}"
    height: 1.875rem
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.card-foreground}"
    rounded: "{rounded.2xl}"
  popup:
    backgroundColor: "{colors.popover}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.lg}"
  popup-dark:
    backgroundColor: "{colors.dark-popover}"
    textColor: "{colors.dark-foreground}"
  status-pill-open:
    backgroundColor: "{colors.status-open}"
    textColor: "{colors.status-open-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  status-pill-open-dark:
    backgroundColor: "{colors.dark-status-open}"
    textColor: "{colors.dark-status-open-foreground}"
  status-pill-ok:
    textColor: "{colors.status-ok-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  status-pill-ok-dark:
    textColor: "{colors.dark-status-ok-foreground}"
  status-pill-warn:
    textColor: "{colors.status-warn-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  status-pill-warn-dark:
    textColor: "{colors.dark-status-warn-foreground}"
  status-pill-bad:
    textColor: "{colors.status-bad-foreground}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  status-pill-bad-dark:
    textColor: "{colors.dark-status-bad-foreground}"
  sort-indicator:
    textColor: "{colors.accent-sort}"
  sort-indicator-dark:
    textColor: "{colors.dark-accent-sort}"
  badge-success:
    textColor: "{colors.success-foreground}"
    typography: "{typography.caption}"
  badge-success-dark:
    textColor: "{colors.dark-success-foreground}"
  badge-warning:
    textColor: "{colors.warning-foreground}"
    typography: "{typography.caption}"
  badge-warning-dark:
    textColor: "{colors.dark-warning-foreground}"
  badge-info:
    textColor: "{colors.info-foreground}"
  badge-info-dark:
    textColor: "{colors.dark-info-foreground}"
  destructive-text:
    textColor: "{colors.destructive-foreground}"
  destructive-text-dark:
    textColor: "{colors.dark-destructive-foreground}"
  hairline:
    backgroundColor: "{colors.border}"
  hairline-dark:
    backgroundColor: "{colors.dark-border}"
  input-border:
    backgroundColor: "{colors.input}"
  input-border-dark:
    backgroundColor: "{colors.dark-input}"
  focus-ring:
    backgroundColor: "{colors.ring}"
  focus-ring-dark:
    backgroundColor: "{colors.dark-ring}"
  muted-text:
    textColor: "{colors.muted-foreground}"
  muted-text-dark:
    textColor: "{colors.dark-muted-foreground}"
  destructive-fill:
    backgroundColor: "{colors.destructive}"
  destructive-fill-dark:
    backgroundColor: "{colors.dark-destructive}"
  success-fill:
    backgroundColor: "{colors.success}"
  warning-fill:
    backgroundColor: "{colors.warning}"
  info-fill:
    backgroundColor: "{colors.info}"
  secondary-fill:
    backgroundColor: "{colors.secondary}"
---

# Admin Design System

## Overview

The admin app is a backoffice: dense lists, a detail panel beside them, and short forms in dialogs. It starts in dark mode, and light mode is first-class. The surfaces and the type are calm on purpose, so a status colour, the sort indicator and a destructive action are the only things that stand out.

## Apps

This file covers the admin app, which `saasaloy add admin` installs. Its tokens live in `packages/ui/src/styles/admin.css`, which imports the shared `globals.css` and declares its own `:root` and `.dark` values, its `@theme inline` mapping and its radius scale. The web app has its own `apps/web/DESIGN.md` and `web.css`, and a change in one never reaches the other. A theme preset only ever targets `web.css`; nothing writes to `admin.css` but a person.

## Colors

Three neutral tones carry every surface: the canvas (`background`), the raised content panel (`card`), and the hover and selected tone (`accent`). On dark the ramp has a faint blue cast, measured from the reference screenshots; on light it is a warm cream canvas with white panels. Menus, dialogs and toasts take the `popover` tone, which is the hover tone on dark, so a popup stands off the panel beneath it.

Hairlines and input borders are alpha, not a fixed grey: `border` is black at 8 % on light and white at 8 % on dark, and `input` is a step stronger. One alpha rule reads the same on the canvas, on a panel and on a popup.

Status colours come in pairs. The plain token (`success`, `warning`, `info`, `destructive`) tints a fill at low opacity, and the `-foreground` token is the darker text on that tint. The status pill reads pairs of its own: `status-open` is the muted blue of the admin role pill and other live states, and `status-ok`, `status-warn` and `status-bad` are a settled state, one waiting on someone, and a failure. Those three copy the `success`, `warning` and `destructive` values and tint the same way, 8 % on light and 16 % on dark. They exist because a theme preset rewrites the shadcn roles, `destructive-foreground` included, and no preset sets a `status-*` key, so a status keeps its colour under any preset. A value that is a state takes a status pill, and a tag such as a plan name or a flag type takes a badge. `accent-sort` is the orange of the active sort column, and nothing else uses it.

Use the semantic utilities, such as `bg-card`, `text-muted-foreground` and `border-border`. Do not copy an `oklch()` value into a component.

## Typography

The app loads Inter as `Inter Variable`, with the single-storey `l` and `g` and tabular figures switched on for the whole body. Page titles are `text-base` semibold. Body text and table cells are `text-sm`. Labels, badges and captions are `text-xs` medium. The overview's stat values are `text-3xl` semibold with tight tracking. There is no display size; the admin app has no marketing copy.

## Layout

The shell is an inset sidebar on the canvas and one content panel beside it with an 8 px gutter. The sidebar holds the brand row, the organization picker's slot, the nav groups and the account menu; it collapses to a 56 px icon strip, and below `md` it opens as a sheet. The content panel has a sticky header with the sidebar toggle and the page path. The account menu holds a "Theme" submenu above "Sign out".

Every page renders inside the page frame, which sets `--page-gutter`: 16 px below `md` and 24 px from `md` up. The page header, the page body, toolbar rows and the table's first and last columns all pad with that variable, so they line up and move together. A selected record docks as a column at the right of the content panel from `md` up and opens as a bottom sheet below it.

## Elevation & Depth

Depth comes from the tonal ramp and the hairlines. Each primitive also draws a 1 px highlight edge with a `before:` shadow, white at 6 % above the surface on dark and black at 4 % below it on light. Popups add a soft drop shadow. There is no shadow scale beyond these.

## Shapes

The base radius is `0.75rem`. Controls and the content panel use `lg`. Cards and dialogs use `2xl`. Badges and status pills use `sm`, a soft rectangle rather than a pill. Avatars are round.

## Components

The shell primitives in `packages/ui/src/components/shell/` are the only controls admin code uses, and a lint rule enforces it. Buttons are 32 px tall from `sm` up and 36 px below it; inputs are 30 px and 34 px. Every control shows a 2 px focus ring in the `ring` tone. A primary button carries a faint inner highlight.

Lists use the data table: a muted header row, 44 px rows, the hover tone on hover and the accent tone on the selected row, and the orange sort indicator on the active column. An empty list shows the empty state, a loading page shows the page skeleton, and a failure shows the shell error state with the shared error copy. A create flow opens in a dialog, a destructive confirm uses the alert dialog, and every save reports its result in a toast.

## Do's and Don'ts

- Read this file and `packages/ui/src/styles/admin.css` before you change the admin UI.
- Import controls from `@repo/ui/components/shell/*`, and never from the base `@repo/ui/components/*`.
- Pad with `--page-gutter` through PageHeader and PageBody; never write a page's own outer padding.
- Keep light and dark token pairs together when you change a role.
- Use `accent-sort` for the active sort column only, and a status pair only for a status.
- Do not add a colour, radius, shadow or type size that `admin.css` does not define.

## Motion

Controls use short colour and shadow transitions. Popups fade and scale in from their trigger, and sheets slide from their edge. The skeleton shimmers with `animate-skeleton`, and a toast bumps on success and shakes on error. Motion stays in prose because the alpha schema has no motion group.

## Dark Mode

The `.dark` class selects the dark token set. The admin app applies dark before React mounts unless the visitor has chosen a theme, and the "Theme" submenu in the account menu picks Light, Dark or System, with a circle reveal from the picked item. Every component uses the semantic tokens, so both themes stay in step.

_Seeded by the saasaloy admin module · tokens sha256:de8fecf6b226 of packages/ui/src/styles/admin.css_
