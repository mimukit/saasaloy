# Plan: the `file-uploads` feature module

Grilled: 2026-09-23

## Context

`storage`, `storage-cloudflare` and `storage-memory` shipped as Phases 1 to 3 of [plan 0051](0051-plan-storage-capability-module-2026-09-08.md) (issue #127). A project can move bytes into R2 and issue a signed upload or download target. Nothing records that a file exists.

That leaves two gaps a product hits immediately. No table owns an object, so no route can list a tenant's files, delete one, or tell a finished upload from an abandoned one. And a presigned PUT carries no size cap, which `modules/storage/skills/saasaloy-storage/SKILL.md:109` already names as the window `complete` was designed to close. The window stays open until this module lands.

Two needs drive the scope: upload and download against R2, and upload and display of an image. Success is a project that runs `saasaloy add file-uploads`, uploads a file from the shipped UI block, lists it, downloads it, deletes it, and renders an uploaded avatar in an `<img>` tag that a CDN caches.

This plan supersedes Phase 4 of plan 0051 and adds the public-object path. Phase 5 of that plan, CSV export and import, is issue #174 and is out of scope here.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| How many modules for these two needs | One. `file-uploads` covers both. The three storage modules are already built and none of them merge. |
| Whether to build an `images` module | No. Cloudflare Images is a second product with a second binding, its own ids and its own billing, and using it would store the same bytes twice. An object already in R2 transforms on the way out through Cloudflare image transformations, which is a URL prefix on the zone, not a binding. |
| How a browser displays an uploaded image | A public object. The record carries `visibility`, and a public object's URL is `${STORAGE_PUBLIC_URL}/${key}`, served with no token. |
| Where the public marker lives in the key | The `scope` segment: `t/<tenantId>/public-uploads/<id>/<filename>`. `assertValidKey` pins the key to five segments starting with a literal `t` (`modules/storage/files/src/keys.ts:42`), so a leading `public/` prefix is not buildable without changing the core. `public-uploads` rather than `public` keeps the what-it-is-for fact in the segment, so #174 can add `public-exports` without reopening this. |
| What gates a public upload | `STORAGE_PUBLIC_URL`, not the provider. Unset means `POST /uploads` refuses `visibility: "public"` with a message naming the variable. No provider-conditional branch anywhere in the module. |
| Who serves a public object with no custom domain | This module's own `GET /files/public/*`, unauthenticated, serving only a key whose scope is `public-uploads`. It touches no file another module owns, and it leaves `packages/storage` unchanged. |
| Whether that route is gated in production | No. It is always enabled and simply unused when `STORAGE_PUBLIC_URL` points at the R2 custom domain. A public object is world-readable by decision, so the second path is slower, not less safe. |
| What `STORAGE_PUBLIC_URL` holds | An origin only. The key is appended verbatim, so the local route must serve the five-segment key unchanged. A path rewrite in dev is exactly the bug this arrangement would otherwise hide. |
| Where `cache-control` on a public object comes from | A Cloudflare Cache Rule on the custom domain, matching `/t/*/public-*/*`. The browser does the PUT, not the Worker, so no code path in this module can attach the header. `PutOptions` carries `contentType` and `metadata` only, and widening it belongs to #127. |
| Whether an object can change visibility | No. Visibility is chosen at `POST /uploads` and frozen, because the scope segment is part of the key and a flip would have to rewrite the object. Changing it means a new upload. |
| What protects a public object | The key. `crypto.randomUUID()` is the repo's id convention, so the `<id>` segment carries 122 random bits and enumeration is infeasible. The skill still states plainly that a public object is world-readable and a leaked URL cannot be revoked. |
| Where image variants come from | `publicImageUrl(key, options)` wraps the public URL in `/cdn-cgi/image/<options>/`, gated on `STORAGE_IMAGE_TRANSFORMS`, default off. With the flag off the helper returns the plain public URL and ignores the options, so a project that never enables transformations still renders images. |
| Whether the download route serves public objects | No. The list response carries `url` for public rows, so a grid renders in one round trip. `GET /files/:id/download` stays private-only and refuses a public id. |
| Whether `queue` is required | No. The sweep job ships under `onlyWith: "queue"` and `queue` stays out of `dependsOn`, because garbage collection is not a precondition for uploading a file and `queue` brings a provider choice and a Cron Trigger with it. |
| The `checksum` column | Dropped from v1. Nothing in these phases writes it, and `complete` already verifies size and content type. Add it back with the job that computes it. |
| The table name | `storage_objects`, plural snake_case, Drizzle export key `storageObjects` ([ADR 0038](../adr/0038-adr-table-names-are-plural-snake-case-2026-09-12.md)). Plan 0051's `storage_object` predates that ADR. |
| The tenant column | A plain `tenantId` (`tenant_id text NOT NULL`), following the only precedent in the repo: `modules/feature-flags/files/db/schema/feature-flags.sqlite.ts:62` uses the same column and names it "whatever a project calls a tenant: an organization id under `teams`, or its own". **Not** `tenantColumn()` from `@repo/db/tenant-column`, because that ships in `multitenant` and would force organizations onto every project that wants file uploads. |
| Where the tenant id comes from | One `resolveTenant(c)` helper inside this module. It returns the active organization id when `multitenant` is installed, and the literal `default` otherwise. The branch lives in that one function and nowhere else. |
| The tenant id with no tenant concept | The literal `default`, so every key is `t/default/…`. `ownerId` still distinguishes users. Adding `multitenant` later leaves existing objects under `t/default/` where they still resolve, because a key cannot be rewritten and any other choice orphans them. |

## Approach

Build one feature module, `modules/file-uploads`, typed `saasaloy:feature`, on the shape `feature-flags` and `waitlist` already use: routes into `@api/routes/`, a dialect-split schema under `onlyWith`, a repository under `@db/repositories/`, a UI block, an admin route, and a `const-array` patch into `NAV_ITEMS`.

It reuses the capability rather than reimplementing any of it. `createStorage(env)`, `buildKey`, `createUploadUrl` and `createDownloadUrl` come from `@repo/storage`, and the module adds no vendor dependency and touches no binding. The sweep job uses `defineJob` and `defineSchedule` from `@repo/queue`, registered through `plugin-array` patches on the `jobs` and `schedules` arrays the way `billing` registers its own. Input validation goes through `@validators`.

Tenant scoping is the module's own, not `multitenant`'s. `resolveTenant(c)` returns a tenant id, the repository takes it as an argument on every call, and every query filters on it. That is weaker than `forTenant`, which wraps the query builder and cannot be bypassed, and the plan accepts the weaker guarantee in exchange for installing without `multitenant`. The repository being the only read path is what carries the guarantee, so a route issuing a raw query against the table is a review failure, not a style preference.

The public path is entirely inside this module. `packages/storage` does not change, no file another module owns is overwritten, and the key stays within the pattern the core already enforces.

`dependsOn: ["api", "auth", "admin", "database", "storage", "validators"]`. `queue` is deliberately absent. The sweep job and its schedule ship under `onlyWith: "queue"`, so they land only in a project that already has the capability, and uploading a file never drags in a queue provider or a Cron Trigger. Without them, abandoned `pending` rows and expired `deleted` rows accumulate and a failed object delete leaves a row in `deleting`. That is untidy, not broken, and the skill says so.

### Rejected alternatives

- **A separate `images` module.** Second binding, second product, duplicate bytes, duplicate records. Revisit only for signed variants, background thumbnails or moderation, none of which the stated need includes.
- **Serving images through a signed download URL.** No new setup, but no CDN cache, a round trip per image, and a URL that expires inside a page someone shares.
- **Widening `KEY_PATTERN` for a leading `public/` prefix.** A `packages/storage` change belonging to #127, and the `scope` segment already carries the fact.
- **Exempting the public scope inside `@api/routes/storage.ts`.** The `dependsOn` rule in `packages/cli/src/lib/collisions.ts:12` would permit a feature module to overwrite that file, and the exemption would vanish the next time `storage` rewrites it.
- **Depending on `multitenant` for `tenantColumn()` and `forTenant()`.** Stronger scoping, and it makes organizations a precondition for uploading a file. `feature-flags` set the precedent of a plain `tenant_id` column with no such dependency.
- **A capability-owned object table.** Settled in plan 0051: it would force a database driver onto every storage install, and `file-uploads` is the only consumer.

### Phase 1: the record and the repository (built 2026-09-23)

- [ ] `modules/file-uploads/registry-item.json`: `saasaloy:feature`, the six `dependsOn`, and `envVars` for `STORAGE_PURGE_AFTER_DAYS`, `STORAGE_PUBLIC_URL` and `STORAGE_IMAGE_TRANSFORMS`
- [ ] `storage_objects` in two dialect variants under one target with `onlyWith`, export key `storageObjects`: `id`, `key`, `provider`, `tenantId`, `ownerId`, `contentType`, `size`, `visibility` (`private`, `public`), `status` (`pending`, `ready`, `rejected`, `deleting`, `deleted`), `createdAt`, `completedAt`, `deletedAt`, `metadata`
- [ ] `tenant_id text NOT NULL` with no foreign key, carrying the same comment `feature_flag_overrides` does about what a project calls a tenant
- [ ] Unique index on `key`; `storage_objects_tenant_id_idx`; `storage_objects_tenant_id_status_idx`
- [ ] `id` is `crypto.randomUUID()` and the schema comment says it is security-relevant, because it is the unguessable segment of a public key
- [ ] `resolveTenant(c)` in `@api/lib/file-uploads.ts` returns the active organization id when `multitenant` is installed and `default` otherwise, and it is the only place in the module that knows the difference
- [ ] `@db/repositories/objects.ts` is the only read path. Every function takes a tenant id and filters on it, and every function filters `deletedAt IS NULL`. No route issues a raw query against the table
- [ ] `@validators/file-uploads.ts` covers the upload request: filename, content type, declared size, visibility

### Phase 2: the routes (built 2026-09-23)

- [ ] `POST /files/uploads`: enforce the per-file cap, refuse `visibility: "public"` when `STORAGE_PUBLIC_URL` is unset, insert a `pending` row, build the key with scope `uploads` or `public-uploads`, return the upload target
- [ ] `POST /files/uploads/:id/complete`: head the real object, verify size and content type against the row, delete the object and mark `rejected` on a mismatch, else mark `ready`
- [ ] `GET /files`: the tenant's list, paginated, carrying `url` on every public row
- [ ] `GET /files/:id/download`: a download target for a private object; refuses a public id
- [ ] `DELETE /files/:id`: mark `deleting`, delete the object, then mark `deleted` with `deletedAt`
- [ ] Every row carries owner, tenant, size and content type, and every query scopes by tenant

### Phase 3: the public path (built 2026-09-23)

- [ ] `GET /files/public/*`: no token, no session. It rejects any key whose scope segment is not `public-uploads`, and it rejects a key that fails `assertValidKey` before it reads the row
- [ ] The wildcard receives the full five-segment key and serves it unchanged, so the same record resolves identically in dev and in production
- [ ] `publicUrl(key)` returns `${STORAGE_PUBLIC_URL}/${key}`; `publicImageUrl(key, { width, height, fit, format })` inserts `/cdn-cgi/image/<options>/` when `STORAGE_IMAGE_TRANSFORMS` is true, and returns `publicUrl(key)` otherwise
- [ ] The skill documents the production setup: the R2 custom domain, the Cache Rule on `/t/*/public-*/*`, and that Cloudflare image transformations must be enabled on the zone. **Confirm the current plan-tier requirement for transformations against Cloudflare's own docs before writing this step** — it was not verified during the grill
- [ ] The skill states the failure mode in plain words: a public object is world-readable by anyone who learns its key, the choice is made once at upload, and there is no un-publish short of deleting the object and uploading it again

### Phase 4: the UI and the sweep (built 2026-09-23)

- [ ] `@ui/blocks/file-uploads.tsx`: pick a file, request a target, PUT it, call `complete`, show the list
- [ ] The `apps/admin` `/files` page, wired into `NAV_ITEMS` by `const-array`
- [ ] An avatar example in the block that uses `publicImageUrl`, so the image path has a worked caller
- [ ] `@queue/jobs/storage-sweep.ts` and its daily schedule, both `onlyWith: "queue"` and both absent from a project without the capability: finish `deleting` rows, delete `pending` rows older than 24 hours with their objects, purge `deleted` rows past `STORAGE_PURGE_AFTER_DAYS`
- [ ] `skills/saasaloy-file-uploads/SKILL.md`

### Phase 5: proof

- [ ] End-to-end in `.dev` under `storage-cloudflare`: upload, list, download, delete, and an oversize refusal
- [ ] The same five under `storage-memory` with `STORAGE_PROVIDER=memory`
- [ ] A public image upload under `storage-memory` that renders through `GET /files/public/*`, and the same key under `storage-cloudflare` that renders through the custom domain. The two URLs differ only in origin
- [ ] A public upload with `STORAGE_PUBLIC_URL` unset is refused with a message naming the variable
- [ ] `publicImageUrl` with `STORAGE_IMAGE_TRANSFORMS` off returns the plain URL and the image still renders
- [ ] The whole upload, list, download, delete cycle runs in a `.dev` project with neither `multitenant` nor `queue` installed, writing keys under `t/default/` and shipping no job file
- [ ] The same cycle with `multitenant` installed writes keys under the active organization id, and a member of one organization cannot list or download another's object
- [ ] `pnpm lint` and `pnpm deps:verify` pass

## Open questions

None. The grill on 2026-09-23 closed all five of the draft's open questions and the five branches they opened. Two items are deferred to the writer rather than to a decision.

Phase 3 must confirm Cloudflare's current plan-tier requirement for image transformations before the skill asserts it.

The `resolveTenant(c)` branch needs a mechanism, and the plan does not name one. `multitenant` ships `requireTenant` in `packages/auth`, so the module cannot import it unconditionally. Phase 1 decides between a dynamic import in a `try`, a `typeof` guard on an optional export, and an `onlyWith` file pair. That is an implementation choice with no user-visible difference, which is why it is not a grill question, but it must be settled before the repository is written.

## Non-goals

- `images` as a module. Cloudflare Images and Media Transformations stay out; this plan uses image transformations on a public R2 URL and nothing else.
- CSV export and import, the `file_jobs` table, and the two multipart jobs. Issue #174.
- Any change to `packages/storage`. Widening `KEY_PATTERN`, adding `cacheControl` to `PutOptions`, and adding `publicUrl?()` to the provider contract all belong to #127 if they are wanted at all.
- A lint rule or a type-level guard that refuses a raw query against `storage_objects`. The repository is the guarantee, enforced by review. Issue #140 tracks the general version.
- Migrating objects written under `t/default/` when a project later installs `multitenant`. They stay where they are and keep resolving.
- A per-tenant storage quota. Still `usage-metering`'s, still a filed follow-up.
- A resumable or chunked upload UI. The contract carries multipart; the UI is a filed follow-up.
- Changing an object's visibility after upload.
- A `checksum` column, until something computes one.
- Virus scanning, content moderation, and server-side thumbnail generation.
- Revoking an issued signed link, or a public URL, before it expires.
- `infra` translator support for `r2_buckets`.
- Copying bytes between providers, and any `saasaloy migrate storage`.
