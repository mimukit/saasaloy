# Plan: harden the template dev loop, lint, web and module defaults (#306)

Grilled: 2026-11-04

## Context

Source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, section "Issue 1", filed as #306. PrimeShopr ran 314 agent sessions on Saasaloy from 2026-10-06 to 2026-11-04. Those sessions hit a set of small, confirmed defects in the base template and in the `api`, `admin`, `storage-cloudflare` and `sms-khudebarta` modules. Each defect cost an agent session time, or (for the R2 bucket) put a broken receipt link in production. The reference implementation is `/home/dev/projects/primeshopr` at `21139b8`.

Goal: a fresh scaffold runs its own gate clean, and a project on it does not hit these defects again.

Target: on a fresh scaffold with every touched module added, `pnpm typecheck`, `pnpm lint` and `pnpm test` exit 0, and a commit of only `apps/admin/src/routeTree.gen.ts` passes the pre-commit hook. Today the web workspace has no `typecheck` script, so that workspace is not checked at all.

Other threads work #307 to #313 at the same time. #307 edits the api CORS setup and the dev configs (`astro.config.mjs`, ports), so this plan keeps its edits in those files to one line each.

## Design decisions (settled)

Each row from the grill is marked asked or defaulted.

| Decision | Resolution |
|----------|-----------|
| Scope | The tasks of #306, with three changed by the grill: the `@source` glob becomes a guard test, the signed-in state pattern becomes a skill section, and the R2 check is a project test. No new capability, no new module. |
| Vite cache split | `separateBuildCache()` in `apps/web/astro.config.mjs` moves every command except `dev` to `node_modules/.vite-build` (`command !== "dev"`). `astro sync` then stops deleting the live dev server's `deps_ssr`. Lifted from PrimeShopr `apps/web/astro.config.mjs:191-205`. |
| Web typecheck | `apps/web/package.json` gets `"typecheck": "astro sync && tsc --noEmit"`, the PrimeShopr shape, and the `typescript` devDependency the other template workspaces pin. `tsconfig.json` drops `"baseUrl": "."`; `paths` resolves relative to the tsconfig without it. |
| lint-staged | The oxlint step gets `--no-error-on-unmatched-pattern` (oxlint 1.x supports it; PrimeShopr `lint-staged.config.js:12`). |
| Hotfix commit type (asked, Q1) | Keep `@commitlint/config-conventional` unchanged. The template `AGENTS.md` states: "A hotfix commit uses `fix`; `hotfix` is a branch name, not a commit type." A `fix` commit gets the patch bump and the changelog entry, and `hotfix` would get neither. |
| `@source` list (asked, Q2) | Keep the per-component list in `packages/ui/src/styles/globals.css`; a glob costs about 26 kB of landing CSS (45.7 kB to 71.5 kB, recorded in that file). Add a vitest test, `apps/web/src/lib/ui-sources.test.ts` (`packages/ui` has no Node types), that reads every `components/<name>` import in `packages/ui/src/blocks/**` and `apps/web/src/**` with a regex and fails when `globals.css` has no `@source "../components/<name>.tsx"` line. Update `packages/ui/AGENTS.md` to name the test. |
| env:setup and a new key (defaulted, Q3) | The `local` source in `packages/env/src/sources.ts` uses the `.env.example` value for a key that `packages/env/.env` does not hold at all. A key present with a blank value stays blank, so a deliberate blank still fails the check. `.env.prod` takes no default. No file write to `packages/env/.env`. |
| R2 bucket name (asked, Q4) | `storage-cloudflare` drops `apps/api/test/r2-bucket.test.ts` through a `"workspace": "apps/api"` scaffold (`packages/storage` has no Node types). It reads `bucket_name` of the `BUCKET` entry in `apps/api/wrangler.jsonc` and `R2_BUCKET_NAME` in `packages/env/.env` and `packages/env/.env.prod`, and fails when a set value differs. It skips a file that is absent or leaves the key blank. It does not see a value that only a remote source (Infisical) holds; the `R2_BUCKET_NAME` description in the descriptor says so. |
| Admin background (asked, Q5) | Light `--background` and `--sidebar` in `modules/admin/files/ui/styles/admin.css` become `oklch(0.97 0 0)` (pure neutral), approved by the owner on 2026-11-04 from a swatch of cream, `oklch(0.96 0.003 258)` and `oklch(0.97 0 0)`. The dark theme is unchanged. |
| Admin `--sidebar` (defaulted, Q7) | It takes the same value as `--background`, as it does today. |
| Signed-in state pattern (asked, Q6) | No code. A section in `modules/auth/skills/saasaloy-auth/SKILL.md` describes the `session:change` event and the `data-session` hint on `<html>` set before paint, with PrimeShopr `apps/web/src/lib/session.ts`, `session-hint.ts` and `src/layouts/Layout.astro` as the reference. The base `apps/web` has no auth and no header that would import code. |
| Sitemap and robots | Lift PrimeShopr `apps/web/src/pages/sitemap.xml.ts` with an `EXCLUDED` set of `404` and `500`, plus `public/robots.txt` that allows all and names `/sitemap.xml`. The `Sitemap:` line uses `https://example.com`, the placeholder `site` in `astro.config.mjs` uses, with a comment to change both. |
| Sitemap test (defaulted, Q8) | The route exports a pure `sitemapPaths(files)`; a vitest test beside it checks that `/`, `/privacy/` and `/terms/` are in and `/404/`, `/500/` and a `[slug]` route are out. No build in the test. The root `vitest.config.ts` already runs `apps/*` as projects. |
| CORS `maxAge` | One line: `maxAge: 7200` in the `cors({...})` call in `modules/api/files/src/index.ts`, plus a test that a preflight answers `Access-Control-Max-Age: 7200`. |
| Admin first load | `__root.tsx` gets `pendingComponent: () => null`. `public/_headers` gets the PrimeShopr `/assets/*` immutable rule. `index.html` gets `<link rel="preload" as="fetch" crossorigin="use-credentials" href="%PUBLIC_API_URL%/admin/auth/get-session">`; the path matches `basePath: "/admin/auth"` in `modules/auth/files/src/client.ts`. |
| khudebarta error | Read the body with `response.text()` first, then `JSON.parse`. On a parse failure, the `SmsError` message carries the first 200 characters of the body, whitespace collapsed. |
| Database skill | Two new rules in `modules/database/skills/saasaloy-database/SKILL.md`: a seed slice uses fixed dates, never `Date.now()` or `new Date()`; and when two branches each generate migration `NNNN`, the later one renumbers after the merge and regenerates `meta/_journal.json` with `db:generate`. |
| Update notes (defaulted, Q9) | Per ADR 0058. A module change gets a note in `modules/<name>/update-notes/`. The base note waits in the release task below, because the repo test refuses a base note dated after the CLI package version (owner, 2026-11-04). A CLI-managed file that `update` replaces needs no note. |
| Outward actions (defaulted, Q10) | Label #306 `ready` only. No commit, no push, no issue body edit, unless the owner asks. |

## Approach

Each task is a few lines, so the plan groups them by the files they touch, not by finding. It reuses the PrimeShopr files named above, the `local` source in `packages/env/src/sources.ts`, the update-note format in `packages/cli/update-notes/0001-brand-css.md`, and the tests the repo already runs (`scripts/*.test.ts`, each module's `*.test.ts`, the template's root `vitest.config.ts`).

### Phase 1: base dev loop and lint (built 2026-11-04)

- `apps/web/astro.config.mjs`: `command !== "dev"` and a comment that names `astro sync` as the second case.
- `apps/web/package.json`: the `typecheck` script and the `typescript` devDependency. `apps/web/tsconfig.json`: remove `baseUrl`.
- `apps/web/astro.config.mjs`: a `@ts-expect-error` on `ssr.optimizeDeps.entries`, which the new typecheck found. Vite types that key without `entries` but merges it into `environments.ssr.optimizeDeps`, which honours it, so the gap is type-only.
- `lint-staged.config.js`: the oxlint flag.
- Template `AGENTS.md`: the hotfix line.
- Done when: in a fresh `.dev` scaffold, `pnpm --filter @repo/web typecheck` exits 0; `astro sync` beside a running `astro dev` leaves `node_modules/.vite/deps_ssr` in place; and `git commit` of only an oxlint-ignored file passes the hook.

### Phase 2: web sitemap and robots (built 2026-11-04)

- `apps/web/src/pages/sitemap.xml.ts`, its test, and `apps/web/public/robots.txt`.
- Done when: the test passes, and `pnpm --filter @repo/web build` writes `dist/client/sitemap.xml` and `dist/client/robots.txt`.

### Phase 3: env:setup takes new defaults (built 2026-11-04)

- The fallback in the `local` source.
- Tests in `packages/env/src/sources.test.ts`: an absent key takes the default; a present blank key stays blank; `prod` takes no default.
- Done when: with a `packages/env/.env` that lacks a key `.env.example` gives a default, `pnpm env:setup` exits 0 and writes that default to the service file.

### Phase 4: ui source guard (built 2026-11-04)

- The `@source` guard test in `packages/ui` and the `packages/ui/AGENTS.md` line.
- Done when: the test passes on the template, and fails when one `@source "../components/…"` line for a block-imported component is removed.

### Phase 5: module defaults (built 2026-11-04)

- `api`: `maxAge` and its test.
- `admin`: `pendingComponent`, `public/_headers`, the preload link, and `--background` and `--sidebar` set to `oklch(0.97 0 0)` in `ui/styles/admin.css`. Update `modules/admin/files/DESIGN.md` where it names the old value.
- `storage-cloudflare`: `cloudflare-bucket.test.ts`, its `files[]` entry, and the descriptor text for `R2_BUCKET_NAME`.
- `sms-khudebarta`: the body extract, and a test that an HTML 502 body appears in the error message, cut to 200 characters.
- Done when: each module's own tests pass; the bucket test fails on a mismatched `R2_BUCKET_NAME` and passes on a match or a blank; and in a scaffold with `admin` added, the built `apps/admin/dist/_headers` holds the `/assets/*` rule and `dist/index.html` holds the preload link.

### Phase 6: skills and update notes (built 2026-11-04)

- The two database skill rules and the auth skill section.
- Update notes for each changed project-owned file. Check ownership against the scaffold's manifest, not by guess.
- Done when: every changed file under `packages/cli/templates/base/` or `modules/*/files/` that a project owns has a note or a stated reason, the repo gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`) passes, and the target in Context holds on a fresh `.dev` scaffold.

## Release task: the base update note

`packages/cli/src/lib/update-notes.test.ts` refuses a base note dated after the CLI version in `packages/cli/package.json`, and a note dated 0.8.0 never reaches a project already on 0.8.0. So the base note for this plan waits here, settled with the owner on 2026-11-04. At the release that ships #306, write the text below to `packages/cli/update-notes/0002-template-dev-loop.md` with that release's version.

````markdown
---
title: The web app typechecks, ships a sitemap, and env:setup fills new defaults
version: <the release that ships #306>
---

## What update does

- `apps/web/package.json` gains a `typecheck` script (`astro sync && tsc --noEmit`) and a `typescript` devDependency, so `pnpm typecheck` now checks the web app. `apps/web/tsconfig.json` drops `"baseUrl": "."`, which TypeScript 7 rejects.
- `apps/web/astro.config.mjs` gives every command except `astro dev` its own Vite cache. Before, the `astro sync` in `typecheck` deleted the running dev server's `deps_ssr` folder.
- `lint-staged.config.js` passes `--no-error-on-unmatched-pattern` to oxlint, so a commit of only ignored files, such as a regenerated `routeTree.gen.ts`, passes the hook.
- New files: `apps/web/src/pages/sitemap.xml.ts`, `apps/web/src/lib/sitemap.ts` with its test, `apps/web/public/robots.txt`, and `apps/web/src/lib/ui-sources.test.ts`, which fails when a primitive the site renders has no `@source` line in `packages/ui/src/styles/globals.css`.
- `AGENTS.md` states that a hotfix commit uses the `fix` type.

`saasaloy update` writes each file above that you never edited, and puts each one you edited in the merge plan.

## What the merge plan gets

- `packages/env/src/sources.ts`, because the project owns it. The steps below are the merge.
- `packages/ui/src/styles/globals.css`, for a comment change only. Take the new comment or keep yours.
- Any file in the list above that you edited.

## What you do

1. In `packages/env/src/sources.ts`, find the loop in `local.load` that copies each example key from `held.values`. Replace it with this, so a key your `packages/env/.env` does not hold takes the example's default in development:

   ```ts
   const takeDefaults = request.environment !== "prod";
   const mine = new Map<string, string>();
   for (const [key, fallback] of parseValues(
     readExample(request.root, request.service.name)
   )) {
     const value =
       held.values.get(key) ??
       (takeDefaults && fallback !== "" ? fallback : undefined);
     if (value !== undefined) {
       mine.set(key, value);
     }
   }
   ```

2. Set the `Sitemap:` line in `apps/web/public/robots.txt` to your live origin, the same one `site` names in `apps/web/astro.config.mjs`.

3. Run `pnpm install`, because `apps/web` has a new devDependency.

## Verify

```sh
pnpm typecheck && pnpm test && pnpm env:setup
```

All three exit 0. After `pnpm --filter @repo/web build`, `apps/web/dist/client/sitemap.xml` lists your pages.
````

## Non-goals

- Ports, `strictPort`, CORS origins and the tailnet origin. #307 owns them.
- New ui primitives or shell blocks. #311 owns them.
- `saasaloy update` behaviour. #312 owns it.
- Shipped session code for the static site. The skill section covers it until a module puts a header on `apps/web`.
- A glob over `packages/ui/src/components/`.
- A sitemap integration (`@astrojs/sitemap`). The hand-written route is enough for a few pages.
