---
title: The admin starts its session check with the HTML and gets a neutral light canvas
---

## What update does

- `apps/admin/index.html` preloads `%PUBLIC_API_URL%/admin/auth/get-session`, so the session check starts with the HTML rather than after every script loads.
- `apps/admin/src/routes/__root.tsx` sets a blank `pendingComponent`. A slow session check no longer shows the list skeleton before the login screen.
- New file `apps/admin/public/_headers` caches `/assets/*` for a year as immutable. Vite puts a content hash in each of those names.
- `packages/ui/src/styles/admin.css` changes the light `--background`, `--sidebar`, `--primary-foreground` and `--sidebar-primary-foreground` from cream, `oklch(0.96 0.008 73.74)`, to `oklch(0.97 0 0)`. `apps/admin/DESIGN.md` names the new value.

`saasaloy update` writes each file you never edited, and puts each one you edited in the merge plan.

## What the merge plan gets

Each of the files above that you edited. Keep your edits and add the change described for that file. If you chose your own admin colours on purpose, keep them and skip the `admin.css` change.

## What you do

Nothing beyond the merge plan.

## Verify

```sh
pnpm --filter @repo/admin build && cat apps/admin/dist/_headers && grep -n 'rel="preload"' apps/admin/dist/index.html
```

The first command prints the `/assets/*` rule, and the second prints the preload link.
