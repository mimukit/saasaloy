---
title: The brand mark becomes a light and dark pair, and the shell gains date pickers and page blocks
when:
  installed:
    - shell
---

## What update does

The one-colour mask `packages/ui/src/assets/shell/brand-mark.svg` is replaced by a pair: `brand-mark-light.svg` for the light theme and `brand-mark-dark.svg` for the dark one. `BrandMark` (`blocks/shell/brand-mark.tsx`) renders both as `<img>` and lets the `dark:` classes pick one, so a full-colour logo now works. It takes `variant?: "icon" | "full"`, default `icon`. `full` adds `config.app.name` as text beside the mark. `saasaloy update` writes the two new files, rewrites `brand-mark.tsx` if you never edited it, and removes `brand-mark.svg` only if you never edited it.

The admin and app `vite.config.ts` now set the tab title from `config.app.name` (`<name> Admin` in the admin, `<name>` in the app) and add a favicon link to `brand-mark-light.svg`.

The update also writes these new shell files:

- `components/shell/calendar.tsx` and `components/shell/date-picker.tsx`: `DatePicker`, `DateRangePicker` and `DateTimePicker`, on the base `lib/calendar.ts`, `lib/date-picker.ts` and `lib/date-field.ts`.
- `components/shell/overflow-tooltip.tsx` and `components/shell/password-input.tsx`.
- `blocks/shell/attention-menu.tsx`, with `lib/shell/attention.ts`.
- `lib/shell/group-rows.ts` and `lib/shell/updated-at.ts`.

Each prop below is new and optional, so a caller that does not pass it renders as before:

- `DataTable`: `grow`, `pin: "end"` on a column, `groupBy` and `initialSort`.
- `PageHeader`: `total`, `badges`, `status`, `updated` and `countLabel`. The title block now has a 12rem basis and the actions row wraps, so a page with header actions keeps its `h1` on a phone. A `description` now wraps where it used to truncate.
- `ShellLayout`: `attention`, a node rendered last in the header.
- `PageBody`: `aside`, a sticky side column at `lg` and up.

## What the merge plan gets

- `packages/ui/src/assets/shell/brand-mark.svg`, if you replaced it with your own mark. The update leaves it in place and the plan lists it. Nothing renders it any more, so until you do the steps below the sidebar and the sign-in card show the Saasaloy mark.
- `packages/ui/src/blocks/shell/brand-mark.tsx`, if you edited it.
- `apps/admin/vite.config.ts`, `apps/admin/index.html`, `apps/app/vite.config.ts` and `apps/app/index.html`, if you edited them.
- Any other shell file above that you edited, such as `page-header.tsx` or `data-table.tsx`.

## What you do

1. If you replaced `brand-mark.svg`, make your mark into the pair. The old file was a mask: its shape mattered and its colour did not. Write two square SVGs with real colours, one that reads on a light background and one on a dark background:

   ```sh
   cp packages/ui/src/assets/shell/brand-mark.svg packages/ui/src/assets/shell/brand-mark-light.svg
   cp packages/ui/src/assets/shell/brand-mark.svg packages/ui/src/assets/shell/brand-mark-dark.svg
   rm packages/ui/src/assets/shell/brand-mark.svg
   ```

   Then set the fill colours in each file. A mask file paints with `#000` and `#fff`, which shows as black and white once it is an `<img>`.

2. If you edited `brand-mark.tsx`, take the new file and move your edit into it. Keep the two `<img>` and the `variant` prop: other blocks render `BrandMark` with no props and expect the `icon` variant.
3. If you edited a `vite.config.ts` or an `index.html` that the plan lists, keep the `brandHtml()` plugin and the `<title>` element it replaces.
4. Run `saasaloy update --resolved <path>` for each file the plan marks as a conflict, then run the checks:

   ```sh
   pnpm install
   pnpm check
   ```

## Verify

```sh
ls packages/ui/src/assets/shell/
grep -rn "brand-mark.svg" apps packages/ui/src
```

The first command lists `brand-mark-light.svg` and `brand-mark-dark.svg` and no `brand-mark.svg`. The second prints nothing. `pnpm build` passes, and `apps/admin/dist/index.html` holds `<title><your name> Admin</title>` and a `<link rel="icon">` whose file exists under `apps/admin/dist/assets/`.
