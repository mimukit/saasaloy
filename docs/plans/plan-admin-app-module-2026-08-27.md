# Plan: admin capability module (apps/admin)

Grilled: 2026-08-27

## Context

The README promises an `admin` capability (`apps/admin`, TanStack Router + Vite SPA) but no module exists; gap item 3 in `unishopr-reborn/docs/misc/saasaloy-base-and-gaps-2026-08-27.md`. The first real project needs a backoffice, and it is the primary consumer of the RPC `AppType` (plan-api-rpc-routes-2026-08-27.md). Success means `saasaloy add admin` scaffolds an SPA that serves a login screen on `:3001`, authenticates against better-auth over the credentialed CORS spine, denies non-admin users, and renders a dashboard that calls the api through the typed client.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Module shape | `saasaloy:capability` named `admin`, one `scaffolds` entry for `apps/admin` with alias `@admin`. ADR-0003 keeps the base landing-page-only; apps arrive as modules. |
| dependsOn | `["api", "auth"]`. Admin is an authenticated backoffice from day one; database arrives transitively through auth. |
| Access gate | Role check, default-deny. The auth module adopts better-auth's `admin` plugin (role column migration included); the admin guard requires `session.user.role === "admin"`; the first admin is promoted via a documented one-liner. A session alone never grants entry. |
| Routing | TanStack Router, file-based via `@tanstack/router-plugin` for Vite. Feature modules drop `src/routes/<feature>.tsx` with no patch, the admin-side twin of the schema barrel. |
| Data layer | `hc<AppType>` from `@repo/api` (type-only) + TanStack Query. Router loaders integrate with Query for caching and invalidation. |
| Auth wiring | `@repo/auth`'s existing `src/client.ts` (better-auth client) with `credentials: "include"`; guard in the root layout redirects to `/login`. Cookies follow ADR-0004. |
| Deploy | Same as `apps/web`: Vite build to `dist`, wrangler `assets` with `not_found_handling: "single-page-application"`, no Worker code. Dev on `:3001` with `strictPort` (already allowlisted in the CORS spine). |
| Env | `PUBLIC_API_URL`, unified with the waitlist convention; admin's `vite.config.ts` sets `envPrefix: "PUBLIC_"`. Defaults to `http://localhost:4000` in dev; declared in the descriptor's `envVars`. |
| Removal | `remove admin` deletes the module's own files; route files other modules dropped into `apps/admin` survive (remover fact) and the skill documents removing those modules first. |
| Version pins | TanStack Router/Query/plugin majors are pinned at implementation time through `pnpm deps:update`; the plan names no versions. |

## Approach

Reuse `apps/web`'s package.json and wrangler.jsonc as the scaffold template (scripts, `clean`, static-assets deploy), `@repo/ui` for Tailwind 4.3 + shadcn components, `@repo/auth/client` for sessions, and the `package-json-dependency` patch kind for the workspace deps. The `create-module` skill authors the descriptor.

### Phase 1: auth module gains the admin role (#87) (built 2026-08-28)

Enable better-auth's `admin` plugin in `packages/auth`'s server config and client; add the role column to the auth schema (new migration via the database flow); document the first-admin promotion one-liner in the auth SKILL.md. Verify in `.dev`: a promoted user's session carries `role: "admin"`.

### Phase 2: module descriptor and app scaffold (#87) (built 2026-08-28)

Create `modules/admin/registry-item.json` scaffolding `apps/admin`: `package.json` (`@repo/admin`, react 19.2, TanStack Router/plugin/Query, `@repo/ui`, type-only `@repo/api` and `@repo/auth` devDependencies, `clean`, `dev` on `:3001` strictPort, `build`, `deploy`, `typecheck`), `vite.config.ts` (react + router-plugin + tailwind + `envPrefix: "PUBLIC_"`), `wrangler.jsonc` (static assets, SPA fallback), `tsconfig.json`, `index.html`, `src/main.tsx`, `src/routes/__root.tsx`. Verify: `saasaloy add admin` in `.dev` scaffolds, `pnpm dev` serves the shell on `:3001`, `pnpm build` + `wrangler deploy --dry-run` pass.

### Phase 3: guarded shell (#87) (built 2026-08-28)

`src/lib/auth.ts` wraps `@repo/auth`'s client with `PUBLIC_API_URL`; `src/routes/login.tsx` renders the sign-in form with `@repo/ui` components; the root layout's `beforeLoad` requires an admin-role session and redirects everyone else to `/login` (signed-in non-admins get a denied state, not the shell). Sidebar shell with a user menu and sign-out. Verify in `.dev`: sign up, promote, sign in, guarded redirect for both anonymous and non-admin users, sign out, cookie behaviour across `:3001` → `:4000`.

### Phase 4: typed data layer and dashboard seed (#87)

`src/lib/api.ts` exports the `hc<AppType>` client bound to `PUBLIC_API_URL` with `credentials: "include"`; QueryClient provider in `main.tsx`; `src/routes/index.tsx` dashboard calls `/health` through the client and renders the typed response. Document the loader + Query convention. Verify: dashboard renders live api data, and a deliberate schema change in the api surfaces as a type error in admin's `typecheck` (turbo runs it across workspaces, so CI inherits the check).

### Phase 5: skill, docs, and downstream conventions (#87)

Write `skills/saasaloy-admin/SKILL.md`: the route-file drop convention, the role guard, the typed-client recipe, the `:3001`/`:4000` port and CORS story, the removal caveat for foreign route drops, and deploy. Update `modules/README.md` and the root README table (admin moves from promised to real). Verify: `pnpm deps:verify`, CLI test suite green.

## Non-goals

- No admin CRUD screens for real entities; the dashboard seed proves the wiring only. Feature modules bring their own route drops.
- No permission system beyond the single admin role; finer roles are a project concern.
- No SSR; the SPA stays static assets on a Worker.
- No panel island (`/panel` in apps/web); that is gap 5, a separate plan.
