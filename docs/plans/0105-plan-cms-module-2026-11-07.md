# Plan: in-house `cms` module

Grilled: 2026-11-07

## Context

Saasaloy has no way to publish editorial content. A project that wants a blog must hand-write pages in `apps/web` and deploy for each post. We compared EmDash, Payload, SonicJS and Keystatic on 2026-11-07, and rejected each one. The owner requires that admins manage content inside the existing `apps/admin` panel, with no separate CMS dashboard, one login (Better Auth) and one database (the project's Drizzle driver). EmDash fails that requirement with its own admin at `/_emdash/admin`, its own users and its own Kysely migrations. Payload needs a Next.js or TanStack Start app and the Workers Paid plan.

The goal is that a staff member writes, publishes and edits blog posts from `apps/admin`, and visitors read them on the public site with no deploy. The same building blocks (rich-text field, editor, renderer, media field) must be reusable by a future `ecommerce` module for product descriptions.

Target: an admin publishes a post in `apps/admin`, and `GET /blog/<slug>` on `apps/web` serves it within 60 seconds. An unpublished or draft post returns 404. The 60 seconds is the cache TTL chosen in the grill, not a measured baseline, because no CMS exists yet.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Build or adopt | Build in-house. EmDash and Payload each bring a second admin UI, a second user table and a second migration system (research, 2026-11-07). |
| Module type | `saasaloy:feature` named `cms`, the same shape as `feature-flags` and `file-uploads`: a `packages/cms` scaffold plus `files[]` for db, api, admin and web. It wraps no external service, so it takes neither providers nor drivers (ADR 0033, ADR 0037). `dependsOn`: `api`, `database`, `validators`, `auth`, `admin`, `file-uploads`. |
| Content types | Code-defined. A developer declares a collection with `defineCollection` in `packages/cms/src/collections/<name>.ts` and registers it with a `plugin-array` patch into `defineCms({ collections: [] })`, the same way `feature-flags` registers flags in `src/flags/system.ts`. Admins fill entries in. Admins cannot create types. The module ships a `blog` collection. |
| Storage | `cms_entries` holds the **working draft**: typed common columns (`collection`, `slug`, `status`, `title`, `published_at`, `author_id`, `version`, `published_revision_id`) and a JSON `data` column that the collection's Zod schema checks on every write. `cms_revisions` holds snapshots (`title`, `slug`, `data`, `html`, `author_id`, `created_at`). `cms_redirects` holds old slugs (`collection`, `old_slug`, `entry_id`). All three follow ADR 0038 and ship `.sqlite.ts` and `.pg.ts` variants with `onlyWith`. Unique key: (`collection`, `slug`) on entries and (`collection`, `old_slug`) on redirects. (grill Q1, Q4) |
| Draft and published | The public site serves the revision that `published_revision_id` names. Publish copies the working row into a new revision, renders its HTML, and points `published_revision_id` at it. Saving a draft never changes the live post. (grill Q1) |
| Statuses | `draft`, `published`, `archived`. Unpublish sets `published_revision_id` to null and the status to `draft`. Archive also hides the entry from the default admin list. Hard delete works only on `draft` and `archived` entries, and cascades to revisions and redirects. (grill Q11, Q12) |
| Restore | Restoring a revision copies its snapshot into the working draft. The live post changes only on the next publish. (grill Q13) |
| Concurrency | Every save and every publish sends the `version` it started from. A stale version returns `409 conflict`. (grill Q14) |
| Dates | `published_at` is set on the first publish only. Later publishes change `updated_at`, and the post page shows "Updated" when the two differ. (grill Q15) |
| Authors | `author_id` references `users` with `on delete set null`. A post with no author shows no byline. (grill Q16) |
| Revision growth | Keep the newest 50 revisions per entry, and prune older ones on save. Never prune the live revision. (grill Q7) |
| Slug changes | When publish changes the live slug, it writes a `cms_redirects` row. A public read that misses checks redirects and returns a 301 to the current slug. A redirect points at the entry, so a chain of renames ends at the current slug. (grill Q4) |
| Editor | Tiptap (MIT packages only, no Pro extensions). Stored as Tiptap JSON, never HTML. `packages/cms` owns every Tiptap dependency and exports the editor from `@repo/cms/editor`, with React as a peer dependency (ADR 0020). The zero-runtime-dependency rule applies to provider cores, and `cms` is a feature. (grill Q6) |
| Renderer | `@tiptap/static-renderer` `renderToHTMLString`. The **api renders once at publish** and stores `html` in the revision, so `apps/web` carries no Tiptap. A custom `nodeMapping` renders the media image node through `publicImageUrl`. A `pnpm cms:rerender` script rebuilds `html` for every live revision after a renderer upgrade or a `STORAGE_PUBLIC_URL` change. (grill Q2) |
| Link safety | Links accept only `http`, `https`, `mailto`, `tel` and relative URLs. Both the editor's Link extension and the renderer check this, so a crafted api write cannot bypass the editor. (grill Q8) |
| Media | Reuse `file-uploads` (`storage_objects`, `POST /files/uploads`, `public-image.ts`). The CMS adds no storage code. The CMS does not track which posts use a file. (grill Q20) |
| Excerpt and SEO | A manual `excerpt` field. If it is empty, use the first 160 characters of the body text. Meta title falls back to the title, and the Open Graph image falls back to the cover. (grill Q17) |
| Products | Out of the CMS. The future `ecommerce` module owns typed product tables. It reuses the CMS's rich-text field, editor, renderer and media field. |
| Who can edit | The roles that already open the admin shell (`admin` and the owner role in `apps/admin/src/lib/auth.ts`). No author or editor roles in this plan. |
| Web delivery | `apps/web/src/pages/blog/index.astro` and `blog/[slug].astro` set `prerender = false`. Marketing pages stay prerendered, which the `astro.config.mjs` comment already allows "with no config change". |
| Web to api | The `@repo/cms` client calls the api's public routes with `fetch` to `PUBLIC_API_URL`. No service binding. (grill Q5) |
| Cache | An isolate-local `Map` with a 60-second TTL, copied from `feature-flags/src/cache.ts`. It also caches 404s and redirects. No purge on publish. Move to the `kv` capability if traffic grows. (grill Q3, Q18) |
| Listing | Newest `published_at` first, paged with `?page=N`. (grill Q19) |
| Checked-in settings | A `cms` section at `packages/config/src/sections/cms.ts`: blog base path (`/blog`), page size (10), RSS title and RSS description (ADR 0052). (grill Q9) |
| Web Worker entry | Phase 5 first checks whether the adapter's generated `dist/client/wrangler.json` already sets `main` once a page is on demand. If it does not, add a `wrangler-field` patch kind for scalar keys to the CLI. (grill Q10) |
| Feeds | The module adds `/blog/rss.xml` and `/blog/sitemap.xml` as on-demand endpoints in `apps/web`. The base has no site-wide sitemap to merge into. |
| Tests | Vitest beside the source, as the repo already runs (`turbo run test && vitest run`). Api route tests follow `file-uploads/files/api/routes/files.test.ts`. No new test runner. The renderer gets a node unit test in Phase 2. Phase 3 proves it runs in workerd with one publish against the api under `wrangler dev` in `.dev`. (grill Q21) |
| Approved outward action | Phase 6 files one `needs-planning` issue titled `feat(cms): add draft preview links and scheduled publishing`. (grill Q22) |
| UI house rules | Admin screens follow `modules/admin/files/DESIGN.md` (dense, panelled backoffice, status tokens `status-open`, `status-ok`, `status-warn`). Blog pages follow `packages/cli/templates/base/apps/web/DESIGN.md`. |
| Visual reference | None yet. Phase 1 produces the mockup, and the owner approves it before any build (AGENTS.md rule). Phase 1 stays attended. (grill Q23) |
| Live revision pointer | `published_revision_id` carries no database foreign key. A key forms an entries and revisions loop that makes the seed engine throw `SeedCycleError`. The repository keeps the pointer valid, and a prune never deletes the live revision. Owner decision, 2026-11-07 (Phase 2). |
| Last editor | `cms_entries` gains a nullable `updated_by` column that references `users` with `on delete set null`, set on every save and publish. A `409 conflict` body returns that user's name and `updated_at`, so the conflict alert names the other editor as the mockup shows. Owner decision, 2026-11-07 (Phase 2), built in Phase 3. |
| Mockup approved | Approved by the owner on 2026-11-07, round 1. Screenshots: seven screens, light and dark, 1440 and 360, kept outside the repo on the dev box at `~/saasaloy-mockups/0105-cms-mockup-r1/` (images are not committed). The mockup app is `.dev/cms-mockup/`, built from the real `shell`, `storage` (`FileDrop`) and web components. The approval accepts these choices: draft is `status-open`, published is `status-ok`, archived is neutral. The list has filter chips Current (draft and published, the default), Draft, Published, Archived and All. A published entry whose draft differs from the live revision shows "Unpublished edits" in the list and the editor, so the api exposes that state. An entry with no author shows a muted "No author" in the admin. The Updated column shows relative time under 36 hours, then the date and time. The editor has a main column (Title, Slug with the base-path prefix, Body) and a 20rem side column (Publishing, Cover image, Excerpt, SEO) that moves below the body under `lg`. The header holds Revisions, Unpublish (published entries only), Save draft and Publish. The conflict alert names the other editor and the time, and offers only Reload. The revisions drawer is a right-hand sheet that marks the live revision, offers Restore on every row and notes the 50-revision limit. The cover picker needs a stored-image state with Replace and Remove around `FileDrop`. Empty SEO fields show their fallback as placeholder text. The web navbar gains a "Blog" link. The blog index is one list (date, title, excerpt, optional 16rem cover on the right, on top on mobile) with "Page N of M" and Older and Newer links. The post page uses the 48rem reading width, an "All posts" link, one line for author, date and "Updated", and hand-written prose styles. |

## Approach

Build the CMS as one feature module that copies the `feature-flags` layout. The registry lives in a scaffolded package, the data in `@db`, the routes in `@api`, the screens in `@admin`, and the public pages in `@web`. It reuses these existing parts:

- `file-uploads` for media upload, storage rows and public image URLs
- the admin shell, its `nav-entry` patch kind and its role guard
- the `chained-route` patch kind for `apps/api/src/index.ts`
- the `plugin-array` patch kind for the collection registry, the config section and the env preset
- `feature-flags/src/cache.ts` as the model for the isolate cache

Rejected alternatives:
- **Per-collection tables.** Each type gets its own Drizzle table. Queries are better typed, but each new type needs a migration, and the admin form cannot be generic.
- **Build-time content.** An Astro content loader reads the api during `astro build`, and a publish starts a rebuild. `web` keeps no Worker, but each publish takes minutes to show.
- **Two data columns for draft and published.** Title, slug and SEO fields would each need two copies too (grill Q1).
- **Rendering in the web app.** It puts Tiptap in the web Worker bundle, and a future storefront would repeat it (grill Q2).

### Phase 1: mockup (#327) (built 2026-11-07)

Attended: the owner approves the mockup screenshots. An unattended run stops before Phase 2 until this plan records the approval.

- Mock up the admin "Blog" list: title, status badge, author, updated time, and a "New post" button.
- Mock up the admin post editor: title, slug, Tiptap body with toolbar, cover image picker, excerpt, an SEO panel (meta title, meta description, Open Graph image), the Save draft, Publish and Unpublish actions, a 409 conflict message, and a revisions drawer with restore.
- Mock up the public `/blog` index and a `/blog/<slug>` post page in the web design system, in light and dark themes, including the "Updated" line and a post with no byline.
- Record the approval and the round it settled on as a Design decisions row.

Done when: this plan carries a "Mockup approved" row with the date and the screenshot paths.

### Phase 2: core package and schema (#327) (built 2026-11-07)

- Scaffold `packages/cms` (`@repo/cms`) with `define.ts` (`defineCollection`, `defineCms`), field builders (`text`, `slug`, `richText`, `media`, `seo`), and the `blog` collection in `src/collections/blog.ts`.
- Add `renderer.ts`, which turns Tiptap JSON into HTML with `renderToHTMLString`, a media `nodeMapping`, and the link-protocol filter.
- Export the editor React component from `@repo/cms/editor`.
- Add the `cms` config section with a `plugin-array` patch.
- Add `cms_entries`, `cms_revisions` and `cms_redirects` schemas for D1 and Postgres, a repository in `@db/repositories/cms.ts` (publish, restore, revision pruning, redirect lookup), a seed slice with two sample posts, and Zod validators in `@validators/cms.ts`.
- Add the `cms:rerender` script.
- Add an `env-preset.ts` only if the module declares `envVars`, so that `scripts/env-presets.test.ts` passes.

Done when: `pnpm test` passes the define, validator, repository and renderer tests. The renderer test shows that a `javascript:` link is dropped. `scripts/table-names.test.ts` passes with the three new tables.

### Phase 3: api routes (#327) (built 2026-11-07)

- Add `apps/api/src/routes/cms.ts` through a `chained-route` patch at `/cms`.
- Admin routes, guarded by the admin role: list entries per collection, read one, create, save draft, publish, unpublish, archive, delete, list revisions, restore a revision. Save and publish check `version`.
- Public routes: list published entries per collection (paged, newest first) and read one published entry by slug, with a 301 for a redirected slug. Drafts and archived entries never leave these routes.
- Check the `data` column against the collection's Zod schema on every write, and return the repo's standard error shape on failure.

Done when: route tests show that a signed-out caller gets 401 on admin routes, a non-admin gets 403, a stale `version` gets 409 on save and on publish, a public read of a draft gets 404, a renamed published slug gets a 301 to the new slug, and deleting a published entry is refused. One publish against the api under `wrangler dev` in `.dev` returns the rendered `html`. If the renderer fails in workerd, stop and report it.

### Phase 4: admin screens (#327) (built 2026-11-07)

- Add a `nav-entry` patch: group "Content", entry "Blog" at `/cms/blog`.
- Build the list and editor screens from the approved mockup. Generate the form from the collection definition, so a new collection needs no new screen code.
- Use the `file-uploads` upload block for the cover image and for images inside the editor body.

Done when: in `.dev`, an admin creates a post, uploads a cover image, saves a draft, publishes it, edits it again, sees two revisions, and restores the first one into the draft. A second tab that saves an old version sees the conflict message.

### Phase 5: web pages, feeds and cache (#327) (built 2026-11-07)

- Check whether the adapter's generated `dist/client/wrangler.json` sets `main` once a page is on demand. If it does not, add the `wrangler-field` patch kind.
- Add `blog/index.astro` and `blog/[slug].astro` with `prerender = false`, the SEO meta tags with their fallbacks, and the stored `html`.
- Add `/blog/rss.xml` and `/blog/sitemap.xml` as on-demand endpoints.
- Add the `@repo/cms` client that reads the public routes over `PUBLIC_API_URL`, with the 60-second isolate cache.

Done when: in `.dev`, an admin publishes a post, and `curl -s -o /dev/null -w '%{http_code}' <web>/blog/<slug>` returns `200` within 60 seconds, with the post title in the body. A draft slug returns `404`, and a renamed slug returns `301`. `/blog/rss.xml` validates as RSS 2.0. `/`, `/privacy` and `/terms` are still prerendered files in `dist/client`, and `wrangler deploy --dry-run` passes for `apps/web`.

### Phase 6: skill, docs and gates (#327)

- Write `modules/cms/skills/saasaloy-cms/SKILL.md`. It covers how to add a collection, how to render a field, how another module reuses the editor and renderer, when to run `cms:rerender`, and a warning that deleting a media file breaks the live posts that use it.
- Add `removeWarnings` for the three tables, as `feature-flags` does.
- File the follow-up issue `feat(cms): add draft preview links and scheduled publishing` with the `needs-planning` label.
- Run `pnpm lint`, `pnpm test`, `pnpm deps:check` and `saasaloy add cms` in `.dev` on both database drivers.

Done when: all four commands pass, `saasaloy add cms` succeeds in `.dev` with `database-d1` and with `database-postgres`, and the follow-up issue exists.

## Migration and rollback

The module adds three new tables and changes no existing rows. `db:generate` writes the create migration when the module is added. To roll back, remove the module, run `db:generate`, review the drop migration, and apply it. The `removeWarnings` entry tells the developer that the tables, and the media rows in `storage_objects`, survive the removal until they do this.

## Open questions

None. The grill on 2026-11-07 settled every question (Q1 to Q23).

## Non-goals

- Draft preview links and scheduled publishing. Phase 6 files the follow-up issue.
- Media reference tracking. Deleting a file that a live post uses breaks that post, and the skill says so (grill Q20).
- A cache purge on publish. A publish shows within the 60-second TTL.
- Admin-defined content types or custom fields.
- Product catalog data, which belongs to the future `ecommerce` module.
- Author, editor and contributor roles, and per-entry permissions.
- i18n of entries, taxonomies (categories and tags), comments and site search.
- A site-wide sitemap that covers the marketing pages.
- Importing content from WordPress or another CMS.
