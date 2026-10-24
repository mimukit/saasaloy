# Finish the theme split

Projects made before 0.6.0 kept the web tokens in `packages/ui/src/styles/globals.css` and the design document at the repository root. The base now splits the theme across three files: `globals.css` holds the shared Tailwind setup, `brand.css` holds the product's tokens, and `web.css` holds the landing page's utilities. `saasaloy update` creates `brand.css` and `web.css` and lists `globals.css` and `Layout.astro` in the merge plan, because the project owns both. It never moves your tokens for you.

These steps used to live in the generated project's `AGENTS.md`. They moved here when that file was cut down, because only a project made before the split needs them.

## Symptoms

- `packages/ui/src/styles/globals.css` still holds a `:root` block, a `.dark` block and `@theme inline`.
- `DESIGN.md` sits at the repository root, not at `apps/web/DESIGN.md`.
- `saasaloy add admin` writes an app whose build fails to resolve `@repo/ui/styles/admin.css`.

## Finish the split

Run `saasaloy update` for the base first, then do these in order.

1. Move the `@custom-variant dark` line, the `:root` block, the `.dark` block and the `@theme inline` block from `globals.css` into `brand.css`, replacing the template's copies there, below its `@import "./globals.css";`. Keep your own values, not the template's.
2. Add `"./styles/*": "./src/styles/*"` to the `exports` of `packages/ui/package.json`, if the update did not.
3. In `apps/web/src/layouts/Layout.astro`, import `@repo/ui/styles/web.css` in place of `@repo/ui/globals.css`.
4. Set `tailwind.css` in `packages/ui/components.json` to `src/styles/brand.css`, if the update did not.
5. Move `DESIGN.md` to `apps/web/DESIGN.md`, and run the `saasaloy-design` skill's `update` flow so its fingerprint names `brand.css`.
6. Run `pnpm build` and check that `globals.css`, `brand.css` and `web.css` hold one `@theme inline` and one `@custom-variant dark` between them.

## With the admin app installed

`saasaloy update` also moves the admin theme. It creates `packages/ui/src/styles/admin.css` and deletes `apps/admin/src/styles/admin.css`, or keeps the old file with a warning when you edited it. Carry any edit across to the new file, then delete the old one.

The new admin app imports `@repo/ui/styles/admin.css`, so its build fails until step 2 adds the `./styles/*` export. Update the base and finish step 2 before you build admin, and before you run `saasaloy add admin` on a project made before the split.

## Add the newer landing blocks

`logo-cloud`, `pain-points`, `how-it-works`, `showcase`, `audience` and `testimonials` came after the first landing page. A project made before them gets the files through `saasaloy update`, and adds each one to its own `apps/web/src/pages/index.astro` by hand, because the page is the owner's.

The blocks need the landing utilities at the end of `web.css`. `web.css` is an owned file, so `update` lists it in the merge plan and never adds them for you. Copy the template's block, from the comment that opens "The landing page's layout" to the `stylelint-enable` line, to the end of your `web.css`. A project made before the theme split skips this copy: `update` creates its `web.css` from the template, block included.
