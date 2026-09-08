# Plan: `storage` capability with `storage-cloudflare`, `storage-memory` and `file-uploads`

Grilled: 2026-09-08

Issue: [#127](https://github.com/mimukit/saasaloy/issues/127). Source: `docs/plans/0048-plan-module-catalog-2026-09-07.md` (P0 #5), `docs/research/0001-research-module-libraries-2026-09-07.md`. Blocked by [#125](https://github.com/mimukit/saasaloy/issues/125) (`queue`) for the export, import, sweep and purge jobs only.

## Context

Nine catalog entries want object storage: `file-uploads`, `data-export`, `import`, `images`, `video`, `backups`, `gdpr`, `blog` OG images and the admin attachment surface. The catalog listed `storage`, `file-uploads`, `data-export`, `import` and `images` as five modules. Upload UI, signed URL and object record are one story, so this plan builds four modules: `storage` (the neutral core in `packages/storage`), `storage-cloudflare` (the R2 provider, the default), `storage-memory` (the local provider) and `file-uploads` (the feature, which also carries export and import).

The capability follows the `email` shape (AGENTS.md "portable capabilities, swappable providers") and the `queue` and `billing` precedents from 2026-09-08: a vendor-blind core, one provider file registered by `plugin-array`, `STORAGE_PROVIDER` selecting at runtime, and a local provider so a project develops uploads with no Cloudflare account.

Success means: `saasaloy add storage storage-cloudflare file-uploads` produces a project where a signed-in user uploads a file from the admin app and sees it listed, the upload goes to a presigned R2 URL without touching the Worker, and deleting the record deletes the object and leaves a soft-deleted row behind it; `STORAGE_PROVIDER=memory` with `storage-memory` runs the same UI and the same routes with no Cloudflare account and no network; and `storage-s3` needs one file plus a registration patch, because R2's S3-compatible API is the same code with a different endpoint.

Platform facts checked on 2026-09-08. The R2 Workers binding reads and writes but cannot sign a URL; Cloudflare's own R2 docs use `aws4fetch` with `signQuery: true` for presigned GET and PUT. `aws4fetch` is 1.0.20 with zero dependencies. Presigning R2 needs an R2 API token (account id, access key id, secret access key), which the binding does not supply. A presigned PUT cannot cap the uploaded byte count. R2 allows 5 GiB in one PUT, 4.995 TiB multipart, and 10,000 parts. A Worker's inbound request body caps at 100 MB on the Free plan, which is the proxy path's real ceiling. **D1 binds at most 100 parameters per query**, caps a query at 30 seconds and a database at 10 GB. A queue message payload caps at 128 KB, so a job carries an object key and never rows. ADR 0033 (`queue`, the system-of-record test) and ADR 0034 (`billing`) exist on their issue branches, not on `main`.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Providers, not drivers, and ADR 0033 gains a third question | ADR 0033's second question ("would a swap move data?") answers yes for `storage`: bytes do not follow the code. Two things override it. A `storage-s3` module is one file plus a registration patch, because R2 speaks S3, so it never breaks the provider size test the way `database-postgres` breaks it. And the local provider must sit beside the real one, which is the whole reason the shape exists. ADR 0037 adds the third question — does the alternate implementation replace files the core owns, or add one? — moves the `storage` row to the provider side, and states plainly that a provider swap copies bytes by hand and no migration is promised. |
| One upload method, two possible targets | The client exposes `createUploadUrl(key, options)` returning `{ url, method, headers, expiresAt, direct }`. `direct: true` is a presigned S3 URL the browser PUTs to. `direct: false` is a URL to the proxy route the capability ships, which streams the body through the binding. The UI does the same PUT either way, so `storage-memory` and an R2 bucket with no API token both work, and presign stays an optional contract method. `createDownloadUrl` mirrors it. |
| The core holds no table, and `storage` does not depend on `database` | Grilled and reversed: the draft justified a capability-owned table with "export and import need it", and both folded into `file-uploads`, leaving that feature as the only consumer. `packages/storage` is bytes, keys, tokens and the proxy route, with `dependsOn: ["api"]`. `file-uploads` owns `storage_object` and `file_job`. A later `backups` or `images` that wants records depends on `file-uploads` or ships its own; the cost is recorded here rather than paid by every storage install. |
| The proxy route is authorized by an HMAC token, not by a session | `packages/storage` signs `{ key, method, exp, maxBytes, contentType }` with Web Crypto HMAC-SHA256 under `STORAGE_URL_SECRET` and puts it in the URL query. The proxy route verifies before it reads a byte. Web Crypto keeps the core at zero npm dependencies, and a token is what makes the two targets interchangeable to the caller. |
| `STORAGE_URL_SECRET` is required, generated by hand, and its absence throws loudly | Nothing in the CLI generates secret values, and a signing key that silently defaults is worse than a loud failure. The descriptor documents `openssl rand -base64 32`; the skill covers `.dev.vars` and `wrangler secret put`. The core throws on the first request for a proxy URL when the variable is unset, and the message names both the variable and the command. `storage-memory` has no other target, so this fires in local dev on the first upload, which is where it should. |
| A record is written before the bytes and confirmed after | `POST /files/uploads` writes a `pending` row and returns the upload target. The client PUTs, then calls `POST /files/uploads/:id/complete`, which `head()`s the object through the binding, compares real size and content type against the row, deletes the object and refuses when they disagree, and otherwise flips the row to `ready`. This is what makes a presigned PUT safe. |
| A presigned PUT cannot enforce a size cap, so `complete` does | The signed URL carries `maxBytes` in the token, but S3 query signing has nothing to enforce it with. An oversize object is caught at `complete`, deleted, and the row marked `rejected`. The skill states the window: a hostile client can write one oversize object per issued token before it is deleted. |
| v1 caps a file, not a tenant | The per-tenant quota moves to `usage-metering` as a follow-up issue. `STORAGE_MAX_UPLOAD_BYTES` (default 100 MiB, the Free-plan Worker body cap) is the only limit v1 enforces. The issue's Phase 3 criterion is rewritten to match, and the skill says plainly that an authenticated tenant can accumulate objects without limit. Half a limit was judged worse than a named gap. |
| Delete is soft, in three states | `DELETE /files/:id` sets `deleting`, deletes the object, then sets `deleted` with `deletedAt`. The row is never removed by the request. The intent marker is what makes the crash window self-healing: a request that dies after the object delete leaves a `deleting` row the sweep finishes, instead of a `ready` row whose download 404s forever. |
| The repository owns the `deletedAt` filter, and a purge job ends the row | Every read goes through `@db/repositories/objects.ts`, which exposes no raw query, so no route can forget the filter. `storage.purge` hard-deletes `deleted` rows older than `STORAGE_PURGE_AFTER_DAYS` (default 30). `buildKey` puts a per-object id in the path, so a soft-deleted row never blocks a re-upload of the same filename. |
| Pending, deleting and purge sweeps install only with `queue` | `@queue/jobs/storage-sweep.ts` runs daily under `onlyWith: "queue"`: it deletes `pending` rows older than 24 hours with their objects, finishes any `deleting` row, and purges past the retention window. The core does not depend on `queue`. Because `deleting` is now a correctness path, the skill carries the manual command for a project without `queue`. |
| Signed links are short-lived bearer credentials | Upload targets expire in 5 minutes, download targets in 1 hour, and `expiresIn` is capped at 24 hours. The skill states that a forwarded download link grants access with no session check, and names the asymmetry we cannot remove: a proxy token could be revoked, a presigned R2 URL cannot be, so the cap is the only control on the R2 path. |
| Error codes | `StorageError`: `not_found`, `invalid_key`, `too_large`, `rate_limited`, `not_supported`, `provider_error`. `not_supported` is what an optional method throws on a provider that lacks it, so a caller branches on a code rather than on a missing function. Providers map vendor codes, keep the raw one in `providerCode`, and set `retryable` honestly. The core never retries. |
| Keys are namespaced by the capability, never by the caller | `buildKey({ tenantId, scope, id, filename })` produces `t/<tenantId>/<scope>/<id>/<sanitized-filename>`. A caller passes parts, not a path, so no route can write outside its tenant prefix and no filename can traverse. A key that fails the pattern raises `invalid_key`. |
| Multipart ships in the contract, and the export job is its first consumer | The contract declares `createMultipartUpload`, `presignPart`, `completeMultipart` and `abortMultipart` as optional. `storage-cloudflare` implements them over the binding's multipart API; `storage-memory` implements them properly, not as stubs, because the export job depends on them. `file-uploads` v1 issues one presigned PUT for a user upload; the resumable upload UI is a follow-up issue. |
| `file-uploads` carries export and import | Four modules, as the issue's table says. `data-export` and `import` do not become their own descriptors; their routes, jobs and screens land in `file-uploads`, which therefore declares `queue` and `validators` in `dependsOn`. The cost is accepted and recorded: a project that wants only uploads still receives the export and import code. |
| Export chains pages into one multipart upload | Each `storage.export` message reads one 5,000-row page, buffers to a 5 MiB minimum part, appends the part and enqueues the next message; the last message completes the upload and writes the signed link onto the `file_job` row. D1's 30-second query cap and the Worker's CPU budget both apply per message, so no tenant size can time the job out, and the part count stays far under R2's 10,000. |
| Import runs two passes and compensates on failure | Pass 1 streams the uploaded CSV from storage, validates every row through `@validators`, writes a per-row error report object, and inserts nothing. Pass 2 inserts in batches of `floor(100 / columns)` rows, respecting D1's 100-parameter cap, chained across messages, every row carrying the `importId`. Any failure in pass 2 deletes by `importId`, so a failed import leaves no partial data. The consequence is a real scope limit: v1 imports only into tables that carry an `importId` column, not arbitrary ones. |
| The screen lives in `apps/admin` | A `/files` page: an upload control, the tenant's object list with size and type, a delete action, an export button and a CSV import flow with column mapping and a report view. `const-array` on `NAV_ITEMS`, as `teams` and `billing` do. `file-uploads` adds `admin` to `dependsOn`. |
| `StorageEnv` is opaque, no `Bindings` patch | `STORAGE_PROVIDER?`, `STORAGE_URL_SECRET?` and an index signature, the same as `EmailEnv` and `QueueEnv`. The provider file casts its own binding. `apps/api/src/index.ts` is not patched for the binding. |
| `storage-cloudflare` presigns only when it is configured | The R2 binding does reads and writes always. `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_BUCKET_NAME` are optional env vars; with all four present the provider signs, and without them `createUploadUrl` returns the proxy target instead. One module, both modes, no second descriptor. |
| `infra` translator is out of scope again | `translate.ts` handles `d1_databases` and `vars` only. `r2_buckets` joins the follow-up issue #125 Phase 1 files for `send_email`, `queues` and `triggers`. The skill states the gap. |

## Approach

Reuses, by name: `modules/email/files/src/{define,provider,index}.ts` as the core template and the selection-throws rule; `modules/queue` from the #125 branch for `defineJob`, `defineSchedule` and the job registration patch; `modules/auth/files/db/schema/auth.{sqlite,pg}.ts` with `onlyWith` for the two-dialect tables; `packages/cli/src/lib/patch/ts-module.ts` (`plugin-array`) for provider and job registration; `wrangler-binding` unchanged, because `r2_buckets` is a top-level key and needs no dotted path; `chained-route` (ADR 0028) for `/storage` and `/files`; `const-array` on `NAV_ITEMS` for the admin page, as `modules/teams` does; `@ui/blocks` (ADR 0030) for the upload block; `modules/database`'s repository pattern for the `deletedAt` filter; `.agents/skills/create-provider/SKILL.md` gains a `storage` mode.

Rejected alternatives, one line each:

- Drivers (`conflictsWith`, `requiresOneOf`, one installed). Loses `storage-memory` beside `storage-cloudflare`, and `storage-s3` replaces no core file, so the driver test does not fit.
- Presign only. Forces R2 API token secrets on day one and leaves `storage-memory` unable to accept an upload at all.
- Worker proxy only. Every byte pays Worker CPU and the 100 MB Free-plan request cap becomes the upload cap.
- `unstorage` as the core. It abstracts key-value mounts, not signed URLs or multipart, and it would put an npm dependency in a core the ADR requires to have none.
- The object table in `packages/storage`. Drafted, then reversed in the grill: `file-uploads` is its only consumer, and the table would force a database driver onto every storage install.
- Session-authorized proxy route. Ties the proxy target to `auth` and makes the two upload targets behave differently to the caller.
- A generated dev default for `STORAGE_URL_SECRET`. Ships a known-value signing key to production.
- Caller-supplied keys. One route bug writes across tenants, and nothing in the contract can catch it.
- Hard delete, in either order. Row-first leaks bytes nothing names; object-first leaves a listed file that 404s.
- Per-tenant quota by `SUM(size)` in v1. Deferred to `usage-metering` rather than shipped as a limit that scans.
- Validate-the-whole-file-in-memory import. Caps the file at Worker memory and still breaks the 100-parameter batch.
- `data-export` and `import` as separate modules. Considered and rejected; the trade is recorded in the decision table.

### Phase 1: ADR and glossary (built 2026-09-08)

The three follow-ups are recorded in ADR 0037's "Follow-ups" section, not filed on GitHub: the unattended run that built this phase creates no issues. File them by hand.

- [ ] Write ADR 0037 "An alternate implementation that adds one file is a provider": adds the third question to ADR 0033's test, moves the `storage` row to the provider side, states that a provider swap copies bytes by hand with no migration promised, and records the HMAC proxy token and the feature-owned object table as consequences.
- [ ] Renumber if ADR 0033 or 0034 land on `main` under different numbers; both are on issue branches today.
- [ ] Update `CONTEXT.md` "Provider module" and "Driver module" to the sharpened test, and add "Object", "Object key", "Upload target" and "Presign" entries.
- [ ] Verify AGENTS.md's `storage` sentence matches the ADR; it already says provider shape.
- [ ] Rewrite #127's Phase 3 quota criterion to the per-file cap, and file the follow-up issues: per-tenant quota with `usage-metering`; `infra` translator support for `r2_buckets`; resumable multipart upload UI in `file-uploads`.

### Phase 2: the neutral core (`packages/storage`) (built 2026-09-08)

- [ ] `modules/storage/registry-item.json`: `saasaloy:capability`, `dependsOn: ["api"]`, `envVars` for `STORAGE_PROVIDER`, `STORAGE_URL_SECRET` and `STORAGE_MAX_UPLOAD_BYTES`, scaffold `packages/storage` with alias `@storage`, patch `@repo/storage` into `apps/api/package.json`.
- [ ] `provider.ts`: `StorageProvider` (`name`, `put`, `get`, `head`, `delete`, `list`, optional `presignPut`, `presignGet`, optional multipart four), `StorageEnv`, `StorageObject`, `UploadTarget`, `DownloadTarget`, `StorageError` with the six codes.
- [ ] `define.ts`: `defineStorage({ providers })`, `create(env)` selecting on `STORAGE_PROVIDER` with the same throw-never-fall-back rule as `email`, `createUploadUrl`/`createDownloadUrl` choosing presign or proxy and applying the 5-minute, 1-hour and 24-hour cap, and the wrap of a raw provider throw into `StorageError`.
- [ ] `keys.ts`: `buildKey` and the key pattern check, with tests for traversal, absolute paths and non-ASCII filenames.
- [ ] `token.ts`: Web Crypto HMAC sign and verify, constant-time compare, expiry check, and the throw naming `STORAGE_URL_SECRET` and `openssl rand -base64 32` when the secret is unset. Zero dependencies.
- [ ] `@api/routes/storage.ts` registered by `chained-route` at `/storage`: the proxy `PUT` and `GET`, both token-verified before a byte is read, streaming through the client.
- [ ] `index.ts` barrel with `export const storage = defineStorage({ providers: [] })` and `createStorage(env)`; `src/providers/.gitkeep`.
- [ ] `package.json` exports `.`, `./providers/*`; `clean` script with pinned `rimraf`.
- [ ] Unit tests: provider selection, unset and unknown `STORAGE_PROVIDER`, key building and rejection, token sign/verify/expiry, the unset-secret throw, `expiresIn` clamping, `not_supported` from a provider missing an optional method, `StorageError` wrapping a raw throw.

### Phase 3: `storage-cloudflare` and `storage-memory`

- [ ] `modules/storage-cloudflare`: one file `files/cloudflare.ts` at `@storage/providers/cloudflare.ts`, exporting `cloudflare()`.
- [ ] Patches: `wrangler-binding` `r2_buckets` entry `{ binding: "BUCKET", bucket_name: "app-storage" }` matched on `binding`; `plugin-array` into `storage.providers`; `package-json-dependency` `aws4fetch` 1.0.20 into `packages/storage/package.json`.
- [ ] Reads, writes, `head`, `delete` and `list` go through the R2 binding. Multipart goes through the binding's multipart API.
- [ ] `presignPut` and `presignGet` use `aws4fetch` with `signQuery: true` against `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>`, and return `undefined` when any of the four R2 API env vars is missing, so the core falls back to the proxy.
- [ ] Map R2 and S3 failures onto the six codes, keep the raw code in `providerCode`, set `retryable` honestly.
- [ ] `modules/storage-memory`: one file `files/memory.ts` at `@storage/providers/memory.ts`. A `Map` of key to bytes plus metadata, no presign, everything served through the proxy route, and a working multipart implementation because the export job needs it.
- [ ] `.agents/skills/create-provider/SKILL.md` gains a `storage` mode. The `saasaloy-storage` skill documents `wrangler r2 bucket create app-storage`, the four R2 API secrets and what they buy, generating `STORAGE_URL_SECRET`, the presign-versus-proxy fallback, the key convention, the bearer-link caveat, the sweep gap without `queue`, and the `infra` translator gap.

### Phase 4: `file-uploads`

- [ ] `modules/file-uploads/registry-item.json`: `saasaloy:feature`, `dependsOn: ["api", "auth", "admin", "database", "storage", "queue", "validators"]`, `envVars.STORAGE_PURGE_AFTER_DAYS`.
- [ ] `storage_object` in two dialect variants under one target with `onlyWith`: `id`, `key`, `provider`, `tenantId`, `ownerId`, `contentType`, `size`, `checksum`, `status` (`pending`, `ready`, `rejected`, `deleting`, `deleted`), `createdAt`, `completedAt`, `deletedAt`, `metadata`; unique on `key`, index on `(tenantId, status)`.
- [ ] `@db/repositories/objects.ts` is the only read path, and it always filters `deletedAt IS NULL`. No route issues a raw query against the table.
- [ ] Routes at `/files`: `POST /uploads` (per-file cap, `pending` row, upload target), `POST /uploads/:id/complete` (head, verify size and content type, delete and mark `rejected` on mismatch, else `ready`), `GET /` (the tenant's list), `DELETE /:id` (`deleting`, delete the object, then `deleted` with `deletedAt`).
- [ ] Every row carries owner, tenant, size and content type, and every query scopes by tenant.
- [ ] `@ui/blocks/file-uploads.tsx` and the `apps/admin` `/files` page, wired into `NAV_ITEMS` by `const-array`.
- [ ] `@queue/jobs/storage-sweep.ts` and its daily schedule, `onlyWith: "queue"`: finish `deleting` rows, delete `pending` rows older than 24 hours with their objects, purge `deleted` rows past `STORAGE_PURGE_AFTER_DAYS`.
- [ ] End-to-end in `.dev`: upload, list, download, delete (row soft-deleted, object gone), and an oversize refusal, under `storage-cloudflare`; the same five under `storage-memory` with `STORAGE_PROVIDER=memory`.

### Phase 5: export and import

- [ ] `file_job` table (two dialects, `onlyWith`): `id`, `tenantId`, `kind`, `status`, `objectId`, `reportKey`, `uploadId`, `cursor`, `partNumbers`, `rowCount`, `errorCount`, timestamps.
- [ ] `@queue/jobs/storage-export.ts`: one 5,000-row page per message, buffered to a 5 MiB minimum part, appended to a multipart upload whose id and parts live on the `file_job` row; the last message completes the upload and writes the signed link.
- [ ] `POST /files/export` enqueues; `GET /files/jobs/:id` reports status and the download link.
- [ ] `@queue/jobs/storage-import.ts` pass 1: stream the CSV from storage, map columns from the request, validate every row through `@validators`, write the per-row error report object, insert nothing.
- [ ] Pass 2: insert in batches of `floor(100 / columns)` rows, chained across messages, every row carrying `importId`; any failure deletes by `importId` and marks the job failed.
- [ ] The admin page gains the export button, the import upload with column mapping, and the report view.
- [ ] `saasaloy-storage` and `saasaloy-file-uploads` skills document both flows, the page and batch sizes, the `importId` column requirement, and that a failed import leaves nothing behind.

## Open questions

None left open by the grill on 2026-09-08. Four items are deferred by decision, not by doubt, and each is a follow-up issue filed in Phase 1: the per-tenant quota (with `usage-metering`), the resumable multipart upload UI, the `infra` translator's `r2_buckets` support, and the ADR renumbering if 0033 or 0034 land differently on `main`.

## Non-goals

- A per-tenant storage quota. v1 caps a single file only; the quota goes to `usage-metering`.
- `images` (Cloudflare Images or Media Transformations), `video` (Stream). Different bindings, different products, later modules.
- `storage-s3` and `storage-b2`. The contract must admit them; this plan does not build them.
- A resumable or chunked upload UI. The contract carries multipart and the export job uses it; the UI is a follow-up issue.
- Virus scanning, content moderation, and thumbnail generation.
- A public CDN domain, a custom bucket domain, or cache-control policy for public objects.
- Revocation of an issued link before it expires, and one-use tokens.
- Importing into tables that do not carry an `importId` column.
- Copying bytes between providers, and any `saasaloy migrate storage`.
- `backups`, `gdpr` erasure fan-out, `job-dashboard`.
- `infra` translator support for `r2_buckets`.
