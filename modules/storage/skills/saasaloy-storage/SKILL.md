---
name: saasaloy-storage
description: Runbook for the storage capability — provider-agnostic object storage in packages/storage, with per-provider modules (storage-cloudflare, storage-memory). Use when uploading or downloading a file from a route, building an object key, issuing a signed upload or download link, choosing or switching STORAGE_PROVIDER, generating STORAGE_URL_SECRET, working on the proxy route, or writing a custom storage provider.
---

# storage — provider-agnostic object storage from `packages/storage`

`packages/storage` (`@repo/storage`) is the capability core: a key builder, a signed-link token, a proxy route, and a **provider registry**. It has **zero runtime dependencies** and knows nothing about R2, S3 or any other object store. Each provider ships as its own module, dropping one file into `src/providers/` and registering itself in the array in `src/index.ts`.

Callers import `@repo/storage`, call `createStorage(env)`, and never learn which provider is active.

## Set it up

1. `saasaloy add storage`, then a provider module.
2. Generate the signing secret and put it where the Worker reads it:

```sh
openssl rand -base64 32          # copy the value
echo 'STORAGE_URL_SECRET=<value>' >> apps/api/.dev.vars
pnpm wrangler secret put STORAGE_URL_SECRET   # for production
```

Nothing generates this for you. A signing key with a known default is a signing key an attacker holds, so the core throws on the first link it is asked to sign, and the message names both the variable and the command.

3. Set `STORAGE_PROVIDER` to the provider you installed. It is required even when one provider is installed, and an unknown value throws at construction. There is no fallback in either direction: a production deploy must not quietly write nowhere, and a test run must not quietly write to a real bucket.

| Variable | Required | What it does |
|---|---|---|
| `STORAGE_PROVIDER` | yes | Names the installed provider that stores bytes. |
| `STORAGE_URL_SECRET` | yes | HMAC key for the signed upload and download links. |
| `STORAGE_MAX_UPLOAD_BYTES` | no | Per-file cap. Defaults to 104857600 (100 MiB). |
| `STORAGE_PROXY_URL` | no | Origin the proxy route answers on, for a caller on another origin. |

## Upload from a route

```ts
import { buildKey, createStorage } from "@repo/storage";

const files = createStorage(c.env);
const key = buildKey({ tenantId, scope: "uploads", id: objectId, filename });
const target = await files.createUploadUrl(key, { contentType });
return c.json(target, 200);
```

The browser does the same `PUT target.url` whichever provider is active. `target.direct` says which path it took:

- `direct: true` — a presigned URL on the vendor. The bytes never touch the Worker.
- `direct: false` — the capability's own `PUT /storage/objects?token=…` route, which streams the body through the binding.

A provider returns `undefined` from `presignPut` when it cannot sign (no API credentials, or no signing at all), and the core falls back to the proxy with no code change at the caller. That is what lets `storage-memory` and an R2 bucket with no API token serve the same UI.

## Keys are built, never written

```ts
buildKey({ tenantId: "t1", scope: "uploads", id: "01H…", filename: "отчёт.csv" });
// "t/t1/uploads/01H…/_.csv"
```

A caller passes parts, so no route can write outside its tenant prefix. `tenantId`, `scope` and `id` are rejected when they carry a separator or `..`; the filename is sanitized instead, because a user picked it. Every client method runs `assertValidKey` first, so a key from anywhere else raises `StorageError` with code `invalid_key`.

`buildKey` puts a per-object id in the path, so a soft-deleted record never blocks a re-upload of the same filename.

## Links are bearer credentials

An upload link lives 5 minutes, a download link 1 hour, and any `expiresIn` is capped at 24 hours. Whoever holds the link can do what it says, with no session check — a forwarded download link works for the person you forwarded it to. Keep that in mind before you put one in an email.

The asymmetry that cannot be removed: a proxy token could be revoked by rotating `STORAGE_URL_SECRET`, but a presigned vendor URL cannot be revoked before it expires. The 24-hour cap is the only control on that path.

## Size caps

`createUploadUrl` writes `maxBytes` into the proxy token and the route refuses a larger `content-length`. **A presigned PUT carries no cap** — S3 query signing has nothing to enforce one with — so a hostile client can write one oversize object per issued link. The feature that owns the object record (`file-uploads`) heads the real object at `complete` and deletes it when it disagrees with the row. That is the window, and it is the reason `complete` exists.

v1 caps a file, not a tenant. An authenticated tenant can accumulate objects without limit; the per-tenant quota is a follow-up issue with `usage-metering`.

## Errors

Every call throws one type, `StorageError`, with one of six codes: `not_found`, `invalid_key`, `too_large`, `rate_limited`, `not_supported`, `provider_error`. A provider maps its vendor code onto one of these and keeps the raw one in `providerCode`. `not_supported` is what an optional method (presigning, multipart) throws on a provider that lacks it, so a caller branches on a code rather than on a missing function.

The package never retries. A retry loop inside a request handler holds the Worker's response open. `retryable` is the hook for a caller, or a queue consumer, to decide.

Selecting the provider happens earlier, in `createStorage(env)`, and a bad `STORAGE_PROVIDER` or a missing `STORAGE_URL_SECRET` throws a plain `Error` there. Those are deploy-time misconfigurations, not failed object operations.

## Write a provider

Follow `.agents/skills/create-provider/`. A provider is one file in `src/providers/` plus a `plugin-array` patch that appends it to the array in `src/index.ts`. Implement `put`, `get`, `head`, `delete` and `list`; add presigning and multipart only if the vendor has them. Read what you need from the `env` you are handed, and never from `process.env`.

If a new provider would need more than one file and a registration patch, the contract is wrong. Fix the contract.

## Known gaps

- The `infra` translator handles `d1_databases` and `vars` only; a bucket binding is not translated yet.
- There is no `saasaloy migrate storage`. Swapping providers copies bytes by hand, and no migration is promised (ADR 0035).
