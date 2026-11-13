---
title: The admin ui kit moves into the shell module
when:
  installed:
    - admin
---

## What update does

Before `shell`, the `admin` module wrote its ui kit under `@repo/ui/{components,blocks,containers,lib}/admin`. That kit now belongs to the `shell` module, under `@repo/ui/{components,blocks,containers,lib}/shell` and `packages/ui/src/assets/shell`. The new `admin` depends on `shell`, so `saasaloy update` installs `shell` and removes each unchanged file under `components/admin/`, `blocks/admin/`, `containers/admin/` and `lib/admin/`. It writes the new imports into `admin` and into every module with an admin screen: `teams`, `billing`, `payment`, `feature-flags`, `multitenant`, `file-uploads` and `api-keys-organization`.

`blocks/admin/feature-flags` stays where it is. It is the one admin-only block, and the update already points its imports at the right place.

## What the merge plan gets

- Each shell file you edited under an old `admin` path. It stays at the old path, and the plan lists it.
- `oxlint.config.mjs`, if you edited it, with the new twin-primitive rule.

## What you do

1. Commit your work first, so the update's changes are the only change in the tree.
2. Update every installed module in one run, so `admin`, `shell` and every module with an admin screen move together:

   ```sh
   saasaloy update
   ```

3. Move each edit you made in an old admin file into the file at its new shell path, then delete the old file. Run `saasaloy update --resolved <path>` for a file the plan marks as a conflict. A replaced logo is the common case. If you replaced `packages/ui/src/assets/brand-mark.svg`, run:

   ```sh
   cp packages/ui/src/assets/brand-mark.svg packages/ui/src/assets/shell/brand-mark.svg
   rm packages/ui/src/assets/brand-mark.svg
   ```

4. Rewrite the imports in your own files. The pattern skips `blocks/admin/feature-flags`:

   ```sh
   grep -rlE '@repo/ui/(components|blocks|containers|lib)/admin/' apps packages/ui/src \
     | xargs perl -pi -e 's#\@repo/ui/(components|blocks|containers|lib)/admin/(?!feature-flags)#\@repo/ui/$1/shell/#g'
   ```

5. Put the twin-primitive rule in `oxlint.config.mjs`, in the `overrides` array, if the update did not. It replaces the older rule whose globs name the `admin` folders and whose pattern holds `!@repo/ui/components/admin/*`:

   ```js
   // The signed-in apps share one primitive set in packages/ui/src/components/shell/,
   // which `saasaloy add shell` writes (`admin` and `app` install it). Inside those apps
   // and the shell, admin and auth folders of @repo/ui, a base primitive or a base block
   // with a shell twin is a lint error.
   {
     files: [
       "apps/admin/**",
       "apps/app/**",
       "packages/ui/src/blocks/admin/**",
       "packages/ui/src/blocks/auth/**",
       "packages/ui/src/blocks/shell/**",
       "packages/ui/src/components/shell/**",
       "packages/ui/src/containers/shell/**",
     ],
     rules: {
       "no-restricted-imports": [
         "error",
         {
           patterns: [
             {
               group: [
                 "@repo/ui/components/*",
                 "!@repo/ui/components/shell/*",
                 "@repo/ui/blocks/error-state",
                 "@repo/ui/blocks/theme-toggle",
               ],
               message:
                 "Signed-in app code uses the shell set: import from @repo/ui/components/shell/* and @repo/ui/blocks/shell/*.",
             },
           ],
         },
       ],
     },
   },
   ```

6. Install, then run the checks:

   ```sh
   pnpm install
   pnpm check
   ```

   A project made before `pnpm check` runs `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` instead.

## Verify

```sh
grep -rnE '@repo/ui/(components|blocks|containers|lib)/admin/' apps packages/ui/src | grep -v 'blocks/admin/feature-flags'
```

The command prints nothing. `pnpm check` passes. If `pnpm` reports `failed to resolve import @tanstack/react-table`, run `pnpm install --fix-lockfile` once.
