# Plan — `admin` capability module

**Grilled:** 2026-08-27

**Issue:** [#13](https://github.com/mimukit/saasaloy/issues/13) · **Created:** 2026-08-27 · **Status:** hardened

## Context

Generated projects have a marketing site (`apps/web`), an API spine (`apps/api`), a database and auth — and nowhere for a logged-in user to stand. Every feature module that owes a screen (`billing`, `teams`, `usage-metering`) is blocked on the admin shell existing first, which is why the phase-3 plan names `admin` as a prerequisite it never designs.

`saasaloy add admin` scaffolds `apps/admin`: a TanStack Router SPA on Vite, deployed at `app.x.com` as Workers static assets. The stack choice is settled by the build spec §2.3 — deliberately Router, not Start, because a client-rendered SPA never asks Workers to render it, which sidesteps the known fullstack-Start-on-Workers generation risk. SEO is irrelevant behind a login.

`admin` is the first capability that scaffolds a *second frontend app*, and the first React host in the tree. Its job is the same as `api`'s and `database`'s: establish the convention-based extension point (a routes folder feature modules drop pages into) before any feature needs it.

Success: `saasaloy add admin` on a clean playground resolves `auth` → `api` → `database` first, deploys green, gates unauthenticated visitors to a login screen, shows a signed-in user the shell, and lets a future `billing` module add a page and its nav entry by dropping one file.

## What the grill established

Facts read from the repo; none required a decision, all shaped one below.

| Finding | Consequence |
|---|---|
| `modules/api` and `modules/auth` both hardcode `http://localhost:3001` in their `DEV_ORIGINS`, with source comments naming it as `apps/admin`'s port. The api Worker is fixed at `:4000`, `strictPort`. | Local dev needs zero new CORS or cookie wiring. The scaffold must claim port 3001 with `strictPort: true` — the reservation already exists on the other side. |
| Localhost cookies are host-only, and `SameSite=Lax` treats localhost ports as same-site; `deriveCookieDomain` in `modules/auth` deliberately stays host-only on localhost. | The session guard works under `wrangler dev` with no `COOKIE_DOMAIN` set. Cross-subdomain is a prod-only concern, already owned by auth's env vars. |
| `modules/auth` ships `emailAndPassword: { enabled: true, requireEmailVerification: false }`. | Signup is a UI-scope choice only; the server accepts it today, and a fresh playground can bootstrap its first user in the browser. |
| The patch layer (`packages/cli/src/lib/patch/pkg-json.ts`) patches only dependency sections — there is no patch kind for a package's `exports` map. | The draft's plan to drop a React client into `packages/auth` (`@auth/client-react.ts`) is unbuildable without a new patch kind. The React client lives in `apps/admin` instead. |
| `@repo/ui` already ships `blocks/theme-toggle.tsx`, built per #64 to be importable unchanged by a React SPA, and `lib/theme.ts` exports `THEME_INIT_SCRIPT` Node-importably for exactly the `transformIndexHtml` case. | The shell's theme story is assembly, not design. |

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| **Stack** | TanStack Router + Vite SPA, per spec §2.3. No SSR, no TanStack Start. |
| **`dependsOn`** | `["auth"]`, resolving recursively to `api` and `database`. The session guard is the shell's whole job; an admin app without auth is a static page pretending. |
| **Scaffold shape** | A `scaffolds` block for `apps/admin` with alias `@admin: apps/admin/src`, mirroring `modules/api`'s `apps/api` scaffold. Dev server on port 3001, `strictPort: true` — the slot api and auth already reserve. |
| **Auth UI scope** | **Login + signup**, both outside the guarded layout. Self-serve signup is the SaaS default, the server already allows it, and it is how a fresh playground gets its first user. Better Auth signs the user in on signup, so success lands on the dashboard. |
| **`routeTree.gen.ts`** | **Checked in as a module file** for the scaffold's own routes, so `typecheck` is green from the first second. The router plugin regenerates it on every `dev`/`build`; a header comment says so and forbids hand edits. |
| **Extension point** | **File-based routing.** `@tanstack/router-plugin` globs `src/routes/`; a feature module adds a page by dropping `routes/_authed/billing.tsx`, exactly as api modules drop `routes/waitlist.ts`. No AST patch touches the router. |
| **Nav registration** | **Route `staticData`.** A dropped route declares `staticData: { nav: { label, order } }`; the nav component walks the route tree and renders what it finds. A page and its nav entry are one file that cannot disagree. Rejected: a patched `navItems` array (file + patch per page, drifts from the routes). |
| **Session guard** | A `_authed` pathless layout route. `beforeLoad` fetches the session **once per app load**, cached in router context; unauthenticated → redirect to `/login` with a `redirect` search param back. The guard is UX; the API is the enforcement line. Rejected: per-navigation fetch (latency for no security gain — httpOnly means the client can never be the gate anyway). |
| **401 handling** | A shipped **`@admin/lib/api.ts`** fetch helper: prefixes `VITE_API_URL`, sets `credentials: 'include'`, redirects to `/login` on 401. Named in the skill as *the* way feature pages call the API. Rejected: raw fetch (one forgotten `credentials` flag is a silent logged-out state); TanStack Query (a data layer for a shell with no data). |
| **Auth client** | **Lives in `apps/admin`** as `src/lib/auth.ts`, wrapping `better-auth/react`'s `createAuthClient` with the same `baseURL`/`basePath: "/auth"`/`credentials: "include"` contract as `@repo/auth/client`. `better-auth` becomes an admin dependency, version-matched to `modules/auth`'s pin. The draft's file-drop into `packages/auth` died on the missing `exports`-map patch kind. |
| **API origin** | `VITE_API_URL`, baked at build time, defaulting to `http://localhost:4000`. **Build per environment** is accepted as standard SPA practice; the skill documents it. Rejected: a runtime `config.js` (fetch-before-boot machinery for a problem the deploy pipeline solves). |
| **Deployment** | Workers static assets, copying `apps/web`'s `wrangler.jsonc` shape, plus `not_found_handling: "single-page-application"` so deep links resolve client-side. |
| **Theme boot** | A Vite `transformIndexHtml` plugin at `head-prepend` injecting `THEME_INIT_SCRIPT` from `@repo/ui/lib/theme`. Mandated by #64: never a `<script type="module">` (deferred, flashes), never a pasted copy (drifts). The nav includes `@repo/ui`'s `theme-toggle` block. |
| **Base stays inert** | Nothing in `packages/cli/templates/base/` changes. Spec §2.6's anti-rot thesis: churny wiring lives in modules. |

## Approach

### What it reuses

| Existing thing | Used for |
|---|---|
| `modules/api/registry-item.json` | The app-scaffold descriptor shape (`scaffolds` with a `wrangler.jsonc`, `vite.config.ts`, `src/routes/`) |
| `packages/cli/templates/base/apps/web/wrangler.jsonc` | The static-assets deploy shape, plus SPA fallback |
| `packages/ui` (`@repo/ui`) | Components, `globals.css`, `blocks/theme-toggle.tsx`, `THEME_INIT_SCRIPT` |
| `modules/auth/files/src/client.ts` | The `baseURL`/`basePath`/`credentials: "include"` contract `src/lib/auth.ts` mirrors in React form |
| `modules/api` + `modules/auth` `DEV_ORIGINS` | The pre-reserved `:3001` slot and the localhost cookie story |
| `pnpm play:init` → `.dev/playground` | The verification harness |

### Phase 1 — `modules/admin` descriptor + `apps/admin` scaffold (built 2026-08-27)

- `registry-item.json`: `dependsOn: ["auth"]`, the `apps/admin` scaffold with alias `@admin`, `envVars: { VITE_API_URL }` in the descriptors' established voice.
- `files/package.json` — React 19 + `@tanstack/react-router` + `@tanstack/router-plugin` + `better-auth` + Vite, exact-pinned, `"clean": "rimraf -g dist \"*.tsbuildinfo\""` per the template rule.
- `files/vite.config.ts` — router plugin (file-based routes), the theme `transformIndexHtml` plugin importing `THEME_INIT_SCRIPT`, `server: { port: 3001, strictPort: true }` with the same "the port cannot drift" comment web and api carry.
- `files/wrangler.jsonc` — `{{PROJECT_NAME}}-admin`, static assets, `not_found_handling: "single-page-application"`.
- `files/index.html`, `files/src/main.tsx`, `files/src/routes/__root.tsx` — the shell frame importing `@repo/ui/globals.css`.
- `files/src/routeTree.gen.ts` — checked in for the scaffold's own routes, header comment marking it plugin-owned.

**Verify:** `saasaloy add admin` on a clean playground resolves the chain `auth → api → database`; `pnpm typecheck` and `pnpm build` green with no prior dev run; run twice is idempotent.

### Phase 2 — auth: client, guard, login, signup (built 2026-08-27)

- `src/lib/auth.ts` — the React auth client (`better-auth/react`), one place holding `VITE_API_URL` + `basePath` + credentials.
- `src/lib/api.ts` — the fetch helper: base URL, `credentials: 'include'`, 401 → `/login`.
- `src/routes/_authed.tsx` — the `beforeLoad` guard, session cached in router context, redirect to `/login?redirect=…`.
- `src/routes/login.tsx` and `src/routes/signup.tsx` — email/password against the auth API; success navigates to the guarded index (signup auto-signs-in).
- Sign-out in the shell nav via the auth client.

**Verify:** under `wrangler dev` (api) + `vite dev` (admin), an unauthenticated hit on `/` lands on `/login`; signup creates the first user and lands on the dashboard; the cookie rides cross-origin; sign-out returns to `/login`; a manufactured 401 redirects.

### Phase 3 — the shell (built 2026-08-27)

- `src/routes/_authed/index.tsx` — the empty dashboard, carrying `staticData: { nav: { label: "Dashboard", order: 0 } }` as the worked example of the convention.
- Nav component: walks the route tree for `staticData.nav` entries, renders them ordered, plus the `theme-toggle` block and sign-out.
- The convention documented in the scaffolded app: where a feature drops a page, how the guard is inherited, how the nav entry is declared.

**Verify:** shell renders in light and dark with no first-paint flash; dropping a dummy `routes/_authed/demo.tsx` with a `nav` entry puts it in the nav with no other edit, and deleting the file removes it.

### Phase 4 — skill + verification (built 2026-08-27)

- `modules/admin/skills/saasaloy-admin/SKILL.md`: adding a page (the one-file drop with `staticData.nav`), the guard contract and its once-per-load freshness, calling the API through `lib/api.ts`, the env checklist (`VITE_API_URL` per environment; prod `CORS_ORIGINS` must include the admin origin and `COOKIE_DOMAIN` must span the subdomains), and the #64 theme-plugin rule.
- Full playground pass: `add admin` from clean, dependency chain, second-run idempotence, `pnpm deps:verify` clean.
- QA doc under `docs/qa/` (written by the QA step, not the build).

### Rejected alternatives

- **Drop the React client into `packages/auth`.** The natural home, and where `modules/auth`'s own comment points — but no patch kind edits an `exports` map, and inventing one for a single file is CLI scope this issue doesn't need. Revisit if a third React consumer appears.
- **A patched `navItems` array.** Proven codemod, wrong shape: every page becomes file + patch, and the nav can disagree with the routes.
- **TanStack Start.** Rejected by spec §2.3; the SPA never asks Workers to render it.
- **TanStack Query.** A data-fetching layer for a shell that fetches nothing; feature modules can bring it when they bring data.
- **Runtime `config.js` for the API origin.** One artifact for all envs, at the cost of fetch-before-boot machinery; build-per-environment is the accepted SPA norm.

## Non-goals

- **Any feature page.** `billing`, `teams`, and friends bring their own routes later; the shell ships empty.
- **Role/permission model.** The guard checks "has a session", nothing finer. Roles arrive with `teams`.
- **User management UI, profile, settings pages.** Feature-module territory.
- **Email verification and password reset.** Both need the `email` capability, which `auth` deliberately doesn't depend on; their own issue.
- **Patching `apps/web`** — no login links or cross-app nav in the marketing site in this issue.
- **An `exports`-map patch kind.** The one thing the grill found missing from the CLI; not needed once the client lives in `apps/admin`.
- **`saasaloy doctor` checks** for admin env vars. Owned by #47.
