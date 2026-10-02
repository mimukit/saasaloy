---
name: saasaloy-file-uploads
description: Work on the file-uploads feature in this project — the storage_objects record, the /files routes, the public image path, the upload block, and the sweep job. Use when adding or changing anything that records, lists, serves or deletes an uploaded file, when a public image will not render, or when a public upload is refused.
---

# saasaloy-file-uploads

`storage` moves bytes. `file-uploads` remembers them.

The capability can PUT an object and GET it back, and then knows nothing about it: no route can list a tenant's files, tell a finished upload from an abandoned one, or say whether an object is world-readable. This module adds the record that answers all three, plus the two ways a file comes back out — a short-lived signed link for a private file, a stable CDN-cached URL for a public image.

## What landed

| File | What it owns |
|---|---|
| `packages/db/src/schema/file-uploads.ts` | The `storage_objects` table. One dialect variant landed; its twin is in the module. |
| `packages/db/src/repositories/objects.ts` | Every query against that table, and the tenant boundary. |
| `packages/validators/src/file-uploads.ts` | The upload request and list query schemas. |
| `apps/api/src/lib/file-uploads.ts` | `resolveTenant`, the two key scopes, `publicUrl`, `publicImageUrl`. |
| `apps/api/src/routes/files.ts` | Five authenticated routes and one deliberately unauthenticated one. |
| `packages/ui/src/blocks/file-uploads.tsx` | The screen's markup. Presentational, as every block is. |
| `packages/ui/src/lib/public-image.ts` | `imageUrl(url, options, enabled)`, the browser half of the image path. |
| `apps/admin/src/routes/files.tsx` | The `/files` screen, and the three-step upload. |
| `packages/file-uploads/src/sweep.ts` | The daily housekeeping sweep, written against a port. |
| `packages/file-uploads/src/job.ts` | The sweep as the `queue` capability registers it. |
| `apps/api/src/lib/storage-sweep.ts` | That port, over the real Drizzle client and the bucket. |

## The routes

| Route | Auth | What it does |
|---|---|---|
| `GET /files` | session | The tenant's list, newest first, keyset-paginated. A public row carries `url`. |
| `POST /files/uploads` | session | Records a `pending` row and returns an upload target. |
| `POST /files/uploads/:id/complete` | session | Heads the real object, verifies it, marks `ready` or `rejected`. |
| `GET /files/:id/download` | session | A signed link for a **private** object. Refuses a public id. |
| `DELETE /files/:id` | session | `deleting` → delete the object → `deleted`. |
| `GET /files/public/*` | **none** | Serves a `public-uploads` key with no token and no session. |

## An upload is two calls, and the second one is the point

`POST /files/uploads` writes the row before the object exists, then hands back a target. `POST /files/uploads/:id/complete` heads what actually arrived and compares its size and content type against what was declared. A mismatch deletes the object and marks the row `rejected`.

Do not shorten this to one call. A presigned R2 PUT carries no size cap — S3 query signing has nothing to enforce one with — so the cap checked at step one is a claim by the client and nothing more. `complete` is the only place reality is checked. `modules/storage`'s own skill names this window; this is what closes it.

The row is written first, not last, so an upload abandoned halfway leaves a `pending` row the sweep can find rather than an orphan in the bucket.

## Tenant scoping

Every key is `t/<tenantId>/<scope>/<id>/<filename>`, and every query filters on the tenant.

`resolveTenant(session)` in `apps/api/src/lib/file-uploads.ts` is the only place that knows where the tenant id comes from. It reads the session's `activeOrganizationId` — the column `auth` declares on `sessions` whether or not `multitenant` is installed — and falls back to the literal `default`. There is no import of `multitenant`, no dynamic import, and no branch on what is installed, because there is nothing to branch on: the column is always there and it is always nullable.

**This is weaker than `forTenant`, on purpose.** `multitenant` wraps the query builder so a cross-tenant read cannot be written; depending on it would make organizations a precondition for uploading a file. What carries the guarantee here instead is that `packages/db/src/repositories/objects.ts` is the only read path and every function in it takes a tenant id. A route that writes its own `db.select().from(storageObjects)` removes the boundary. Treat one as a review failure, not a style preference.

A project that adds `multitenant` later keeps its existing objects under `t/default/`. Nothing migrates them: a key cannot be rewritten, and any other choice orphans the bytes.

## Public objects

Visibility is chosen once, at `POST /files/uploads`, and frozen. The marker lives in the key's `scope` segment — `t/<tenantId>/public-uploads/<id>/<filename>` — so flipping it would have to rewrite the object. There is no un-publish short of deleting the file and uploading it again.

**A public object is world-readable by anyone who learns its key.** The key is the access control: `crypto.randomUUID()` gives the `<id>` segment 122 random bits, so enumeration is infeasible, but a leaked URL cannot be revoked. Say that out loud to anyone who asks for "public but only for logged-in users" — that is a private object with a signed link, which is the other half of this module.

`STORAGE_PUBLIC_URL` gates a public upload, not the provider. Unset, `POST /files/uploads` refuses `visibility: "public"` and names the variable in the message. Nothing falls back to private: storing a file the uploader believes is shareable is worse than refusing.

### Two ways a public object is served

In production `STORAGE_PUBLIC_URL` points at an **R2 custom domain** (`https://files.example.com`) and the bytes never touch the Worker. In dev it points at this module's own route (`http://localhost:4000/files/public`) and the Worker streams them.

The key is appended verbatim in both cases, all five segments of it, so the same record resolves through either:

```
https://files.example.com/t/acme/public-uploads/abc/logo.png
http://localhost:4000/files/public/t/acme/public-uploads/abc/logo.png
```

The two differ in their prefix, not in the key. That is the part that must not drift: rewrite the path in dev and a record that works locally 404s in production, which is exactly the bug this arrangement exists to prevent. In dev `STORAGE_PUBLIC_URL` therefore carries the `/files/public` path as well as the origin; in production it is an origin and nothing else.

The local route is never gated off in production. It is the slower path, not the less safe one, and it refuses twice before it touches the database: the scope segment has to be `public-uploads`, and the key has to pass `assertValidKey`.

### Production setup

1. **Attach a custom domain to the bucket.** R2 → your bucket → Settings → Public access → Custom domains. Set `STORAGE_PUBLIC_URL` to that origin, with no path.
2. **Add a Cache Rule** on the zone, matching URI path `/t/*/public-*/*`, setting `Edge TTL` and a browser `cache-control`. The header has to come from here: the browser does the PUT, not the Worker, so no code path in this module ever touches the object and `PutOptions` carries `contentType` and `metadata` only.
3. **Enable image transformations** if you want `publicImageUrl` to resize. Images → Transformations → pick the zone → enable. Then set `STORAGE_IMAGE_TRANSFORMS=true`.

Checked against Cloudflare's own docs on 2026-09-23: **transformations need no Pro plan.** Every account gets 5,000 unique transformations a month. On the Images Free plan that is a ceiling rather than an overage — past it, already-cached variants keep serving and a *new* variant returns error 9422 until you move to Images Paid, where the same transformations cost $0.50 per 1,000. A unique transformation is one source image plus one option set, counted once per calendar month, so three widths of one avatar is three of them.

With `STORAGE_IMAGE_TRANSFORMS` off — the default — `publicImageUrl` returns the plain public URL and ignores its options. Every image still renders, just unresized. That is deliberate: the `/cdn-cgi/image/` prefix 404s on a zone that has not enabled the feature, and a broken `<img>` is worse than a large one.

### Why there is no `images` module

Cloudflare Images is a second product with a second binding, its own ids and its own billing, and using it would store the same bytes twice. An object already in R2 transforms on the way out through a URL prefix on the zone. Revisit only for signed variants, background thumbnails or moderation — none of which this module claims.

## The sweep

The sweep runs at 04:00 UTC daily and makes three bounded passes: finish `deleting` rows, remove `pending` rows older than 24 hours along with anything at their key, and purge `deleted` rows past `STORAGE_PURGE_AFTER_DAYS` (30 by default).

**It runs only with the `queue` capability**, and `queue` is deliberately not in `dependsOn`: garbage collection is not a precondition for uploading a file, and `queue` brings a provider choice and a Cron Trigger with it. Without it everything still works — upload, list, download, delete — and what you lose is the tidying. Abandoned rows accumulate, soft-deleted rows are never dropped, and a row whose object delete died halfway stays in `deleting`. That is untidy, not broken.

The three files always land; only the two `plugin-array` registrations need `queue`. In a project without it, `saasaloy add file-uploads` warns that three patch targets are missing — `packages/queue/package.json` once and `packages/queue/src/index.ts` twice, each printed both in the plan and again at apply time — and `packages/file-uploads/src/job.ts` is dead code. That is the expected output, not a failure — a patch carries no `onlyWith` condition the way a file does. Add `queue` later and run `saasaloy add file-uploads --force`; a plain re-run answers "already installed" and changes nothing, while `--force` re-applies the patches, which are idempotent.

The sweep is split across three files for two reasons worth knowing before you move any of it. A file targeting `@queue/...` cannot ship conditionally, because the applier resolves the alias before it applies `onlyWith`, so the job would break `add` in every project with no queue. And a job file inside `packages/queue` that imported `@repo/db` would pull the schema barrel's `import.meta.glob` into a workspace that does not compile with Vite's types. So `packages/file-uploads` holds the sweep and the registration with zero runtime dependencies, and `apps/api/src/lib/storage-sweep.ts` implements the port. It is `packages/billing`'s arrangement, for the same reasons.

## Wire-up

The applier writes `packages/ui/src/blocks/file-uploads.tsx` and then stops. It never edits a page.

The admin screen needs no wiring: `apps/admin/src/routes/files.tsx` landed with the module and the router plugin makes `/files` reachable on its own. Putting it in the nav panel is the separate, optional step `apps/admin/src/components/nav.ts` describes. Add one line to the `Manage` group in `NAV_AREAS`:

```ts
{ to: "/files", label: "Files", icon: FolderIcon },
```

No patch does it for you, because `NAV_AREAS` is a nested structure and the `const-array` codemod appends to a flat one.

The rest of this section is for putting the block on a *second* surface, such as a user-facing page in `apps/web`.

1. **The file to edit:** `apps/web/src/pages/account.astro`, or whichever page should carry the uploader.
2. **The import line, verbatim** — and note that the page imports an app-side island, not the block:

   ```ts
   import FileUploadsPanel from "@web/components/FileUploadsPanel";
   ```

   You write that island yourself. The block is presentational: it takes rows and three callbacks and calls them, and `packages/ui` imports no api package and no http client. Copy the three-step upload out of `apps/admin/src/routes/files.tsx` — ask the api for a target, PUT the bytes to it with `credentials: "omit"`, then call `complete`.

3. **The tag, verbatim, with its client directive:**

   ```astro
   <FileUploadsPanel client:load />
   ```

   `client:load` rather than `client:visible` because the panel holds a file input and its own upload state; hydrating it late would mean a control that looks ready and is not.

4. **A suggested anchor:** after the profile card, or wherever you want it. Placement is yours.

`saasaloy remove file-uploads` deletes the block file and leaves the import you added. Take that line out by hand.

## Things that will bite you

- **A migration is yours to run.** Dropping the schema file into `packages/db/src/schema/` gets it into the barrel; it does not touch your database. Run `pnpm db:generate`, read the migration, then apply it.
- **`STORAGE_URL_SECRET` is still required**, by `storage`, not by this module. Without it the first upload throws while signing the target.
- **The public route answers 404 for every refusal.** A bad scope, a malformed key, a missing row and a missing object all look identical from outside. That is intentional: an unauthenticated caller learns nothing about which check it failed.
- **`GET /files/:id/download` refuses a public id** with a 400 rather than signing one. The list response already carries `url` for a public row; a second, expiring URL would imply a revocability this module does not have.
- **The list is keyset-paginated, not offset-paginated.** The cursor carries the last row's `createdAt` *and* `id`, because two rows can share a millisecond. Treat it as opaque; an unreadable one falls back to the first page.
- **`size` on a `pending` row is what the client claimed.** Only after `complete` does it hold the real number.
