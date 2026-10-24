# 0047: The signed-in product lives in an `app` module on a shared `shell`

A signed-in end user had no app to land in. `admin` admits only the admin role, and #183 put a customer panel in `web`, a static Astro site. A new `app` capability, a TanStack Router SPA at `apps/app` on port 3002, holds every screen a signed-in user sees, and `web` keeps only public pages. The app frame (layout, nav, user menu, theme toggle) moves from `@repo/ui/*/admin`, where PR #204 put it, into a `shell` capability under `@repo/ui/*/shell`. `admin` and `app` both depend on `shell`, and it holds no auth logic: `admin` guards on the role, `app` on the session. `auth` ships the sign-in and sign-up blocks, and each app renders them on its own route. Settled on 2026-10-21 in the grill of `docs/plans/0074-plan-agent-native-mvp-build-2026-10-21.md`.

## Status

accepted. Amended on 2026-10-24 (below): `shell` owns the primitive set and the page blocks too.

## Considered Options

- A signed-in panel inside `web`. Rejected: it needs on-demand rendering in a site built to ship static HTML, and it adds a second screen pattern beside the admin SPA.
- A non-admin area inside `admin`. Rejected: one app for two audiences, with the role check spread through every route.
- `app` depends on `admin` and imports its shell. Rejected: customer code would import from an `admin` path, and every product would have to install admin.
- `app` copies the shell under `@repo/ui/*/app`. Rejected: about 60 duplicate files that drift apart.
- Each app keeps its own sign-in screen. Rejected: two screens to restyle, where one block serves both.

## Consequences

- A project that installed `admin` before the move gets the new `shell` paths through `saasaloy update` and a merge plan for any shell file it edited.
- A third signed-in app depends on `shell` and gets the same frame with no copy.
- "Customer panel" is retired as a term. The `app` module is the product UI home.

## Amendment — 2026-10-24: `shell` owns the whole kit, not only the frame

The #226 grill found that the frame alone is not enough. The approved `app` mockup renders `DataTable`, `PageHeader`, `EmptyState`, `Button`, `Field` and `StatusPill`, not only the layout. A file left in `admin` is a file `app` cannot import with no `admin`. So `shell` owns everything generic in PR #204's set: the coss primitives in `components/shell/`, every block except the `feature-flags` block, the containers, the `lib/shell/` helpers, the brand mark and the `@tanstack/react-table` patch. `admin` keeps only `admin.css`, its app and its api route.

`shell` also ships `styles/shell.css`. It declares the status pairs, the status pill tones, the sort accent and the skeleton and toast motion, with neutral defaults at zero specificity and no import. Each app stylesheet imports its theme, then `shell.css`, then sets its own values. This keeps `shell` free of any app stylesheet.

Rejected: a frame-only `shell` (`app` would still need `admin`), a second module for the primitives (one more dependency edge with no consumer that wants one without the other), and the primitives in the base template (every project would carry about 40 files and a table library with no SPA). A project that installed `admin` before the move follows the upgrade steps in the `saasaloy-shell` skill.
