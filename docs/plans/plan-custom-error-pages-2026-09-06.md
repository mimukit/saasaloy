# Plan: custom error pages across the base template
Grilled: 2026-09-06

## Context

The base template ships no error surface at all. A visitor who mistypes a path on `apps/web` gets Cloudflare's empty asset miss, because `apps/web/wrangler.jsonc` sets no `not_found_handling`. A visitor who mistypes a path in the admin SPA gets a blank screen, because `not_found_handling: "single-page-application"` returns `index.html` and TanStack Router has no not-found component to render. An unmatched `apps/api` path answers Hono's built-in plain-text `404 Not Found`, which is the one response in that Worker that is not the `{ error: { code, message } }` envelope every other path publishes. A caught render error in the admin app falls to `ErrorComponent`, TanStack's unstyled developer screen.

Success means every scaffolded project answers a wrong path, a failed render, and a server-render failure in its own theme, in one voice, with no per-project work.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Scope | 404 in each of the three apps, one shared error screen, and a `500.astro` on `apps/web` backed by the `@astrojs/cloudflare` adapter. |
| SSR adapter (grilled Q1) | In scope for this plan. `apps/web` gains `@astrojs/cloudflare` so Astro can render `500.astro`; a static site alone cannot. |
| Prerender policy (grilled Q7) | Every page stays prerendered (`output: "static"` with the adapter). The 500 page is infrastructure: today nothing renders on demand, so nothing can trigger it, and a future module that drops a `prerender = false` page inherits it for free. |
| 500 page mode (grilled Q8) | Prerendered, no `error` prop, no failure detail in the response. It renders `ErrorState` with a retry link. |
| `apps/web` wrangler (grilled Q9) | Becomes an adapter-managed Worker: `main` points at the adapter's `dist/_worker.js` output, `assets` stays with `not_found_handling: "404-page"` for asset-path misses, and the "no Worker code" comment is rewritten. Dev port 3000, `strictPort`, and the CORS story do not move. |
| Status number in copy (grilled Q2) | Always shown. `ErrorState` takes a required `code` label ("404", "500"). It is a display label, not a claim about the HTTP status: the admin not-found shows "404" over a soft 200, accepted. |
| Admin not-found placement (grilled Q3) | Inside `AppShell`, as `notFoundComponent` on the root route in `__root.tsx`, so the nav stays usable. |
| Admin guard vs 404 (grilled Q4) | Admins only see the admin 404. The root `beforeLoad` guard runs before not-found rendering, so an anonymous visitor on an unknown path gets the login redirect. Accepted: no path-existence leak, no guard change. |
| API 405 (grilled Q5) | Not distinguished. One 404 envelope for unmatched path and wrong method, matching Hono's model; noted in the handler comment. |
| Where the words live (grilled Q6) | New `packages/ui/src/content/errors.ts`, following `content/landing.ts`'s shape rules. A copy pass over `landing.*` never reaches error strings; a translation pass walks both files. |
| Where the markup lives | New `packages/ui/src/blocks/error-state.tsx`, reached at `@repo/ui/blocks/error-state`, matching how `footer`/`hero`/`navbar` work. |
| API 404 shape | The same `errorFor(404, ...)` envelope the existing `onError` builds, registered as `base.notFound(...)` in `apps/api/src/index.ts`. |

## Approach

One shared block, four call sites (web 404, web 500, admin not-found, admin error boundary), plus the api envelope. Everything the block renders already exists: `Card`/`CardHeader`/`CardTitle`/`CardDescription`/`CardContent` from `@repo/ui/components/card`, `Button` and `buttonVariants` from `@repo/ui/components/button`, `cn` from `@repo/ui/lib/utils`, `lucide-react` icons. The layout copies `modules/admin/files/src/components/access-denied.tsx`, the closest existing error screen.

Rejected: per-app markup with no shared block (two copies to keep in step); full `output: "server"` (ends the static marketing-site model); an on-demand 500 page (renders inside a failing request and can leak internals).

### Phase 1: the shared error block (#118) (built 2026-09-06)

- Add `packages/ui/src/content/errors.ts` with copy for the not-found, the render-failure, and the server-failure cases. Follow the shape rules written at the top of `content/landing.ts`: max three levels, stable ids, single-brace `{token}` placeholders through `lib/interpolate.ts`, no runtime concatenation. Point back at `landing.ts`'s preamble instead of copying it.
- Add `packages/ui/src/blocks/error-state.tsx` exporting `ErrorState`. Props: required `code` label, title, description, and one or two actions; copy defaults come from `content/errors.ts`.
- The block renders with zero client JavaScript, so an Astro page needs no `client:*` directive. No state, no effects.
- `packages/ui/package.json` already exports `./blocks/*` and `./content/*`; no export-map change.
- Verify with `pnpm lint` (four passes) and `pnpm typecheck`.

### Phase 2: `apps/web` 404, 500, and the Cloudflare adapter (#118)

- Add `@astrojs/cloudflare` (exact-pinned) to `packages/cli/templates/base/apps/web/package.json` and register it in `astro.config.mjs`. Keep `output: "static"`; do not set `prerender = false` on any page. Rewrite the config's "no SSR adapter" comment to say why the adapter is there (the 500 page, and server runtime for future on-demand pages).
- Add `src/pages/404.astro` and `src/pages/500.astro`. Both use `Layout.astro` exactly as `privacy.astro` does and render `ErrorState` with codes "404" and "500". `500.astro` stays prerendered and reads nothing from the failed request.
- Update `wrangler.jsonc`: add `main` pointing at the adapter's Worker output, keep `assets` with `"not_found_handling": "404-page"`, rewrite the "pure static site" comment. Verify the exact `main` path and any `assets.binding` the adapter's current docs require.
- Confirm behavior against `wrangler dev` over the built output, not the Astro dev server; the dev server has its own error handling.

### Phase 3: admin not-found and error screens (#118)

- Add `notFoundComponent` to the root route in `modules/admin/files/src/routes/__root.tsx`, rendering `ErrorState` inside `AppShell` with a link to `/`.
- Replace the bare `ErrorComponent` fallback in `RootError` with `ErrorState` (code "500", retry via the router's `reset`, home link). Keep the `NotAdminError` branch that renders `AccessDenied` ahead of it, untouched.
- Verify the guard interaction: the root `beforeLoad` must run before not-found rendering, so an anonymous visitor on an unknown path lands on `/login`. If TanStack Router behaves otherwise, raise it; decision Q4 assumes this order.
- Do not hand-edit `src/routeTree.gen.ts`. No file is added under `src/routes/`, so the tree should not move.
- Update `modules/admin/registry-item.json` only if a new file lands under `files/`.

### Phase 4: `apps/api` 404 envelope (#118)

- Add `.notFound((c) => c.json(errorFor(404, "not found"), 404))` to the `base` chain in `modules/api/files/src/index.ts`, next to `.onError(...)`. Both are single slots, so a later `chained-route` patch inherits them.
- Keep the explicit `Hono<{ Bindings; Variables }>` annotation on `base` intact.
- Comment that a wrong method also answers 404, per decision Q5.
- A sub-app mounted with `.route()` inherits the handler as long as it sets none of its own, same as `onError`.

### Phase 5: docs and module descriptors (#118)

- Record the block in the base template's `DESIGN.md` alongside the other blocks.
- State the rule in `packages/cli/templates/base/AGENTS.md`: an app that adds a route surface answers a miss with `ErrorState`, and no app writes its own error markup. Note that a `prerender = false` page inherits `500.astro`.
- Note in the `saasaloy-admin` and `saasaloy-api` skills that a feature module inherits the not-found handling and must not register a second one.
- Run `pnpm lint` and `pnpm deps:check`, then scaffold into `.dev` and confirm all three apps end to end.

## Open questions

None. Grilled 2026-09-06; the two remaining verifications (adapter `main` path, TanStack guard-before-not-found order) are implementation checks, listed in Phases 2 and 3.

## Non-goals

- No on-demand (`prerender = false`) page in the base template; the 500 page waits for a module that adds one.
- No custom Cloudflare error page or `_routes.json` work.
- No error reporting, no Sentry, no client-side error telemetry.
- No change to `AccessDenied`, to the auth gate, or to any redirect rule in `__root.tsx`.
- No 405 handling in the api.
- No error pages in modules other than `admin` and `api`; a feature module inherits these.
- No offline or maintenance page.
