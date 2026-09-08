# 0037 — An alternate implementation that adds one file is a provider

[ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md) settles the provider/driver line with two questions about the state a capability holds, and it puts `storage` on the driver side. That row is wrong, and this record moves it. The two questions ask about the data. They never ask about the code, and the code is what the two shapes actually differ in: a driver **replaces** files the core would otherwise own, a provider **adds** one. `storage` adds one. So `storage` takes providers, `storage-cloudflare` and `storage-memory` sit beside each other, and `STORAGE_PROVIDER` picks at runtime. Settled while planning issue [#127](https://github.com/mimukit/saasaloy/issues/127) (`docs/plans/0051-plan-storage-capability-module-2026-09-08.md`).

## Status
accepted. Amends [ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md): it adds a third question to the system-of-record test and rewrites the `storage` row of its table. ADR 0033's `database` row, its two existing questions, and its binding-registration rules all stand.

## The third question

Ask three questions now, in order.

1. **Does the project own the schema and the migrations?** Drivers, if yes.
2. **Does the project query the state directly, and would a swap require moving existing data?** Drivers, if yes.
3. **Does the alternate implementation replace files the core owns, or add one?** Providers, if it adds one.

Question 3 outranks question 2 when the two disagree. Question 1 still decides on its own: a capability whose migrations the project writes takes drivers whatever its file shape is.

ADR 0033 wrote the tie-break the other way. It said "when a future capability answers the two questions differently from each other, the second question wins, because a data migration is the cost the shape exists to make visible". That sentence is withdrawn. A data migration is a **cost to name**, not a reason to pick a shape, and the two shapes do not differ in how loudly they can name it. A provider capability can state in its skill that a swap copies bytes by hand, and `storage` does. What the driver shape buys is mutual exclusion, and mutual exclusion is only worth its price when two implementations cannot coexist in one build.

## Why `storage` moves

Three facts, each checked against the code rather than the category.

- **`storage-s3` is one file plus a registration patch.** R2 exposes an S3-compatible API, so the S3 provider is the R2 provider with a different endpoint. It replaces no core file, carries no scaffold, and needs no `tsconfig.json` of its own. `database-postgres` breaks all three of those, which is what earned `database` the driver shape in [ADR 0026](0026-adr-database-driver-split-2026-08-28.md), and `.agents/skills/create-provider/SKILL.md` already states that size test.
- **The local provider has to sit beside the real one.** `storage-memory` is why a project develops uploads with no Cloudflare account and no network. Under `conflictsWith` a project holds `storage-memory` or `storage-cloudflare`, never both, and the one a developer wants at their desk is not the one that ships. That is the same argument ADR 0033 used to keep `queue` on the provider side, and it applies here unchanged.
- **Nothing in the core is dialect-shaped.** `packages/storage` is a provider contract, a key builder, an HMAC token and a proxy route. Every provider implements the same eleven methods against the same `StorageEnv`. There is no `client.ts` for a second implementation to overwrite, so the file collision that `conflictsWith` exists to prevent cannot occur.

The migration cost is real and stays stated. Bytes do not follow the code. Moving a project from R2 to S3 copies every object by hand, and no `saasaloy migrate storage` is promised, in this record or any other.

### The revised table

Only the `storage` row changes.

| Capability | Shape | Why |
|---|---|---|
| `email` | providers | No state. An email send is an endpoint. |
| `sms` | providers | No state, and no Cloudflare product at all. |
| `logger` | providers | The sink owns the lines; nothing reads them back through the capability. |
| `queue` | providers | The platform owns the messages, they are transient, and no consumer queries them. |
| `kv` | providers | The platform owns the entries and they carry a TTL. |
| `database` | drivers | The project owns the schema and the migrations, and queries the rows. |
| `storage` | **providers** | An alternate implementation adds one file and replaces none. A swap copies bytes by hand, and no migration is promised. |

## Considered Options

- **Leave `storage` on drivers and accept the loss of `storage-memory`.** Rejected. It costs the local-provider rule that AGENTS.md states for every capability, and it buys mutual exclusion over two files that never collide.
- **Ship `storage-memory` as a mode of `storage-cloudflare`, selected by an env var, so the driver row can stand.** Rejected. It puts an in-memory `Map` inside the module that owns the R2 binding and the `aws4fetch` pin, and a project that never touches Cloudflare still installs both.
- **Drop question 2 and decide on file shape alone.** Rejected. Question 2 is what keeps `database` honest: even if a Postgres driver were somehow one file, the rows would still have to move, and the install-time refusal is the only thing that makes a project name its database once.
- **Decide `storage` case by case and write no rule.** Rejected for the reason ADR 0033 gives: the question has come up four times now, and `backups`, `images` and `ai` each raise it again.

## Consequences

- **`modules/storage` is a `saasaloy:capability` with `dependsOn: ["api"]` and no `requiresOneOf`.** `storage-cloudflare` and `storage-memory` are `saasaloy:feature` modules, each one file plus a `plugin-array` patch into the core's `providers` array, and neither names the other in `conflictsWith`. `STORAGE_PROVIDER` is required; unset or unknown throws at construction, with no fallback in either direction.
- **The proxy route is authorized by an HMAC token, not by a session.** `packages/storage` signs `{ key, method, exp, maxBytes, contentType }` with Web Crypto HMAC-SHA256 under `STORAGE_URL_SECRET` and puts it in the query string; the route verifies before it reads a byte. This is a consequence of the shape, not a detour around auth. `createUploadUrl` returns a presigned vendor URL from one provider and a proxy URL from another, and the caller must not be able to tell which. Only a credential the core itself issues makes the two targets interchangeable, and Web Crypto keeps the core at zero npm dependencies. `STORAGE_URL_SECRET` is required, generated by hand with `openssl rand -base64 32`, and its absence throws on the first proxy URL naming both the variable and the command.
- **The object table lives in `file-uploads`, not in the core.** `packages/storage` holds bytes, keys, tokens and the proxy route, and depends on `api` only. A core-owned `storage_object` table would force `database` and one of its drivers onto every project that wants a bucket, which is exactly the coupling the provider shape exists to avoid. `file-uploads` owns `storage_object` and `file_job` and is their only reader through `@db/repositories/objects.ts`. The cost is recorded rather than hidden: a later `backups` or `images` that wants records depends on `file-uploads` or ships its own table.
- **Signed links are bearer credentials with an asymmetry we cannot remove.** A proxy token could be revoked; a presigned R2 URL cannot be. Expiry is the only control on the vendor path, so upload targets last 5 minutes, download targets 1 hour, and `expiresIn` is clamped at 24 hours. Every capability skill states this.
- **A provider swap copies bytes by hand.** Both storage skills say so, and no command is offered. This is the sentence the driver shape used to carry on `storage`'s behalf.
- **`.agents/skills/create-provider/` and `.agents/skills/create-module/` carry the third question**, so an author applies the rule instead of reading a precedent out of `email`.
- **Nothing reopens.** No `core` interfaces package, no `saasaloy migrate storage`, no per-provider deploy targets, and no copying of objects between providers.

## Follow-ups

Three items are deferred by decision, not by doubt. This unattended run does not create GitHub issues, so they are recorded here and filed by hand.

1. **Per-tenant storage quota, with `usage-metering`.** v1 caps a single file through `STORAGE_MAX_UPLOAD_BYTES` (default 100 MiB, the Free-plan Worker body cap) and caps no tenant. An authenticated tenant can accumulate objects without limit, and the skill says so. A quota by `SUM(size)` scans the table on every upload, so it belongs with the metering capability that already keeps counters.
2. **`infra` translator support for `r2_buckets`.** `modules/infra`'s `translate.ts` reads `d1_databases` and `vars` and refuses the rest. `storage-cloudflare` patches `r2_buckets` into `wrangler.jsonc` correctly, and a project that installs `infra` gets no Pulumi resource for the bucket. This joins the same gap ADR 0033 records for `send_email`, `queues` and `triggers`.
3. **Resumable multipart upload UI in `file-uploads`.** The contract carries `createMultipartUpload`, `presignPart`, `completeMultipart` and `abortMultipart`, and the export job is their first consumer. A user upload in v1 is one presigned PUT, so a dropped connection restarts the file. A resumable UI drives the same four methods from the browser.

## References
Issue [#127](https://github.com/mimukit/saasaloy/issues/127), `docs/plans/0051-plan-storage-capability-module-2026-09-08.md`. Amends [ADR 0033](0033-adr-transient-state-capabilities-take-providers-2026-09-08.md). Related: [ADR 0001](0001-adr-all-in-on-cloudflare-2026-07-22.md) (its 2026-08-04 amendment), [ADR 0020](0020-adr-capability-owns-its-vendor-packages-2026-07-24.md), [ADR 0021](0021-adr-pulumi-iac-engine-for-infra-2026-07-25.md), [ADR 0026](0026-adr-database-driver-split-2026-08-28.md), [ADR 0028](0028-adr-routes-register-by-chained-route-patch-2026-08-28.md). Glossary: `CONTEXT.md` → "Provider module", "Driver module", "Object", "Object key", "Upload target", "Presign".
