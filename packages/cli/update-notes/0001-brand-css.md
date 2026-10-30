---
title: Move the web tokens from web.css into brand.css
version: 0.8.0
---

## What update does

The web tokens move from `packages/ui/src/styles/web.css` to a new `packages/ui/src/styles/brand.css` beside it: the `:root` and `.dark` blocks, the `@custom-variant dark` line and the `@theme inline` block. `brand.css` imports `globals.css`. `web.css` imports `brand.css` and keeps the landing page's layout, type and motion utilities. `packages/ui/components.json` points shadcn at `brand.css`.

`saasaloy update` creates `brand.css` from the template. It overwrites `packages/ui/components.json` only if you never edited it. It leaves `apps/web/DESIGN.md` alone, because that file is a seed.

Until you finish the steps below, `apps/web/src/layouts/Layout.astro` still loads your old `web.css`, so the site looks the same and `brand.css` is unused.

## What the merge plan gets

- `packages/ui/src/styles/web.css`, because the project owns it. The steps below are the merge.
- `packages/ui/src/styles/globals.css` and `apps/web/src/layouts/Layout.astro`, for comment changes only. Take the new comments or keep yours; no code changes.
- `packages/ui/components.json`, if you edited it.

## What you do

1. Copy the `@custom-variant dark` line and the `:root`, `.dark` and `@theme inline` blocks from your `packages/ui/src/styles/web.css` into `packages/ui/src/styles/brand.css`. Replace the template's copies below its `@import "./globals.css";` line. Keep your own values: a preset you applied lives in `web.css`, not in the new file.
2. In `web.css`, delete those four and change `@import "./globals.css";` to `@import "./brand.css";`. Keep the landing block, from the comment that opens "The landing page's layout" to the end of the file.
3. Set `tailwind.css` in `packages/ui/components.json` to `src/styles/brand.css`, if the update did not:

   ```json
   "tailwind": {
     "config": "",
     "css": "src/styles/brand.css",
     "baseColor": "neutral",
     "cssVariables": true
   }
   ```

4. Refresh the fingerprint in `apps/web/DESIGN.md`. Run the saasaloy-design skill's `update` flow, or edit the last line of the file by hand so it names `packages/ui/src/styles/brand.css` with the first 12 hex characters of that file's sha256. This command prints them:

   ```sh
   node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFileSync } from 'node:fs'; process.stdout.write(createHash('sha256').update(readFileSync('packages/ui/src/styles/brand.css')).digest('hex').slice(0, 12))"
   ```

   The last line then reads:

   ```markdown
   _Updated from packages/ui on YYYY-MM-DD · tokens sha256:<12 hex> of packages/ui/src/styles/brand.css_
   ```

## Verify

Build the project:

```sh
pnpm build
```

Then check that `globals.css`, `brand.css` and `web.css` hold one `:root`, one `.dark`, one `@theme inline` and one `@custom-variant dark` between them. Each count this command prints must be 1:

```sh
cat packages/ui/src/styles/globals.css packages/ui/src/styles/brand.css packages/ui/src/styles/web.css > /tmp/styles.css
for pattern in '^:root' '^\.dark' '^@theme inline' '^@custom-variant dark'; do printf '%s %s\n' "$pattern" "$(grep -c "$pattern" /tmp/styles.css)"; done
```

`grep -c '@import "./brand.css";' packages/ui/src/styles/web.css` prints 1.
