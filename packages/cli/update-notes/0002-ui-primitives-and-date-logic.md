---
title: The base ships form primitives, date pickers and a warning token
version: 0.9.0
---

## What update does

`saasaloy update` creates these files in `packages/ui/src/`, because none of them exists in a project made before this release:

- `components/`: `calendar.tsx`, `checkbox.tsx`, `combobox.tsx`, `date-picker.tsx`, `dialog.tsx`, `input-group.tsx`, `input-otp.tsx`, `number-field.tsx`, `password-field.tsx`, `popover.tsx`, `radio-group.tsx`, `select.tsx`, `skeleton.tsx`, `sonner.tsx`, `switch.tsx`, `textarea.tsx`, and `NOTICE.md` (the coss ui licence the calendar's classes need).
- `lib/calendar.ts`, `lib/date-picker.ts` and `lib/date-field.ts`: the date logic both the base and the shell pickers use, on `Date` and `Intl` with no date library. The calendars show days in `config.app.locale` and start the week on that locale's first weekday, with Monday where the runtime gives no week info. A `weekStartsOn` prop overrides it.
- `content/date-picker.ts`: every word the pickers show.

It adds `sonner` 2.0.8 and `input-otp` 1.5.0 to `packages/ui/package.json`. It rewrites `AGENTS.md`, `packages/ui/AGENTS.md` and `.gitignore` if you never edited them. The new agent rules: compare a kit component with your own source before you copy it, and recommend one to the owner; a field with more than 7 options uses a combobox; mockup and QA images go in the gitignored `.artifacts/`; and a closed list of UI changes that need no mockup. `packages/ui/AGENTS.md` also lists the shipped primitives, the `Select` `items` rule and three `shadcn add` faults.

`brand.css` gains `--warning` and `--warning-foreground` in `:root` and `.dark`, and `--color-warning` and `--color-warning-foreground` in `@theme inline`. The project owns `brand.css`, so the update does not write it.

## What the merge plan gets

- `packages/ui/src/styles/brand.css`, because the project owns it. Step 1 is the merge.
- A file under `packages/ui/src/components/` or `packages/ui/src/content/` with one of the names above that you already made yourself, for example a `dialog.tsx` from `shadcn add dialog`. The update leaves yours in place and the plan lists it.
- `packages/ui/package.json`, `AGENTS.md`, `packages/ui/AGENTS.md` and `.gitignore`, if you edited them.

## What you do

1. Add the warning pair to `packages/ui/src/styles/brand.css`, after the `--destructive` line in each block. Keep your other values:

   ```css
   :root {
     --warning: oklch(0.666 0.179 58.318);
     --warning-foreground: oklch(0.555 0.163 48.998);
   }

   .dark {
     --warning: oklch(0.828 0.189 84.429);
     --warning-foreground: oklch(0.828 0.189 84.429);
   }

   @theme inline {
     --color-warning: var(--warning);
     --color-warning-foreground: var(--warning-foreground);
   }
   ```

2. Refresh the fingerprint in `apps/web/DESIGN.md` and add the four warning colours to its `colors`. Run the saasaloy-design skill's `update` flow.
3. For each primitive you had already added with `shadcn add`, compare yours with the template's and keep one. The template's `select.tsx` makes `items` required, so a `Select` without it fails `typecheck`. Pass `items` with a `{ label, value }` list.
4. Run `saasaloy update --resolved <path>` for each file the plan marks as a conflict, then install and run the checks:

   ```sh
   pnpm install
   pnpm check
   ```

## Verify

```sh
grep -c -- "--warning" packages/ui/src/styles/brand.css
grep -n ".artifacts/" .gitignore
ls packages/ui/src/lib/calendar.ts packages/ui/src/components/date-picker.tsx
```

The first command prints 6. The second prints one line. The third lists both files. `pnpm check` passes.
