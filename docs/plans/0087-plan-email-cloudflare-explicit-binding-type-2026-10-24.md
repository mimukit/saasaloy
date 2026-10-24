# Plan: Cloudflare providers import their Workers types explicitly

Grilled: 2026-10-24

Updated 2026-10-24 during the build: Q12 (the `queue` exception) was asked and settled with the owner after the full-scaffold typecheck found it. The review of PR #274 added the `payment` core to Phase 4, which carried the package unused like `sms` and `logger`.

## Context

Issue #253. The full `database-d1` scaffold that #220 typechecks in `release:smoke` fails in `@repo/email-react`:

```
../email/src/providers/cloudflare.ts(60,43): error TS2304: Cannot find name 'SendEmail'.
```

`modules/email-cloudflare/files/cloudflare.ts:60` casts the binding to `SendEmail`, an ambient global that `@cloudflare/workers-types` declares only when a tsconfig lists it in `types`. `modules/email/files/tsconfig.json` lists it, so `packages/email` passes. `modules/email-react/files/src/index.ts` re-exports `safeUrl` from the `@repo/email` barrel, the barrel imports every registered provider, and `modules/email-react/files/tsconfig.json` lists no `types`. So `tsc` in `email-react` compiles the Cloudflare provider without the globals.

Every other workspace that imports a capability barrel (`packages/auth`, `packages/feature-flags`) lists `@cloudflare/workers-types` in its own `types`, which is why only `email-react` fails today. ADR 0036 decided on purpose that `email-react` carries no Worker types, and ADR 0030 rejected the same move for `packages/ui`. The defect sits in the providers: each one makes every consumer of its core pay for a vendor global. `kv-cloudflare`, `queue-cloudflare` and `storage-cloudflare` use the same ambient pattern, and the `sms` and `logger` cores carry the package with no file that uses it.

Goal: a provider's vendor types stay inside the provider, so a workspace that imports a capability core typechecks with no vendor setup of its own, and no core lists a vendor types package (AGENTS.md, "The core is vendor-blind").

Target: a project with `email`, `email-cloudflare` and `email-react` passes `pnpm typecheck` with 0 errors, and no file under `modules/{email,kv,storage,sms,logger,payment}/files` names `@cloudflare/workers-types`. `queue` is the one exception (see Design decisions).

Prototypes (2026-10-24, deleted), all with `tsc` 7.0.2, the base tsconfig and `types: []`:

- Email: a consumer workspace reproduced the exact TS2304 error with the ambient `SendEmail`, and exited 0 with `import type { SendEmail } from "@cloudflare/workers-types"`. The package has no `types` field, so Bundler resolution picks its importable `index.ts`, which the package README documents for this case.
- `kv` and `queue`: the real core `src` plus the real provider file, with one `import type` line added, exit 0.
- `storage`: the same setup fails 3 times (`cloudflare.ts:228`, `:306`, `:336`). The core contract uses the DOM `ReadableStream`, and the Workers `ReadableStream` adds `readAtLeast` and makes `value` optional on a done read, so neither is assignable to the other. The ambient `types` entry merges the two globals today and hides the gap. A cast from `StorageBody` to the Workers stream union compiles.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the fix goes | In each Cloudflare provider file: `import type { … } from "@cloudflare/workers-types"` in place of the ambient globals. A consumer needs no setup. |
| Scope | All four Cloudflare providers (`email-cloudflare`, `kv-cloudflare`, `queue-cloudflare`, `storage-cloudflare`) in this plan, plus the `sms` and `logger` cores, which carry the package unused. One rule everywhere. |
| Who owns `@cloudflare/workers-types` | The provider. Each Cloudflare provider adds a `package-json-dependency` patch with `section: "devDependencies"` into its core's `package.json`, the way `database-d1` pins it into `packages/db` (ADR 0026). Each core `package.json` drops the devDependency, and each core `tsconfig.json` drops `compilerOptions.types`. |
| The `queue` exception (Q12, settled in the build) | `packages/queue` keeps the devDependency and `types: ["@cloudflare/workers-types"]`, and `queue-cloudflare` adds no devDependency patch. Its `jobs` array imports feature barrels (`@repo/billing`, `@repo/file-uploads`), and `billing-stripe` runs `import { env } from "cloudflare:workers"`. Only the ambient `index.d.ts` declares that module, so no `import type` can replace it. The full `database-d1` scaffold failed `@repo/queue` typecheck with TS2307 until the entry came back. `queue-cloudflare` still imports its own types explicitly. Rejected: a tsconfig patch kind from `billing` (a CLI change), and removing `cloudflare:workers` from `billing-stripe` (a billing design change). |
| Why the import resolves from a consumer | `tsc` resolves the import from the provider file's own directory, so it finds `packages/<cap>/node_modules/@cloudflare/workers-types` through that devDependency. The consumer declares nothing. |
| Storage stream boundary | `storage-cloudflare` casts at its 3 boundary points and the core contract stays as it is. `put` and `uploadPart` cast to `WorkerReadableStream \| ArrayBuffer \| string`; `get` returns `object.body as unknown as ReadableStream`. One comment states that both names describe one runtime object. |
| Name of the imported stream type | `import type { ReadableStream as WorkerReadableStream }`, so the DOM global keeps its plain name in the core contract. |
| Static guard | None. The full-scaffold typecheck that #220 adds to `release:smoke` is the long-term guard. |
| Test approach | No new kind of test. Each phase checks a scaffold in `.dev` with `pnpm typecheck`. |
| Out of scope | `packages/auth` and `packages/feature-flags` keep `@cloudflare/workers-types` in `types`. No note for existing projects, because the CLI does not re-apply a scaffold and an extra devDependency is harmless. This plan sets no order against #220. |
| Outward actions | Commit and push this plan on `main`, update #253 with a link to the plan, and label it `ready`. The build opens one PR for #253. No follow-up issue. |

Rejected:

- `email-react` lists `@cloudflare/workers-types` in `types`. It reverses ADR 0036, puts a Cloudflare type into a render package, and is needed even when `email-cloudflare` is not installed.
- `email-react` imports from a provider-free subpath of `@repo/email`. It fixes one consumer and leaves the same trap for the next workspace that imports a barrel.
- `storage` keeps the ambient types. It leaves two rules side by side.
- The `storage` core defines its own stream interface. It changes the contract that `apps/api/routes/storage.ts` and `storage-memory` use.

## Approach

Reuse the importable form of `@cloudflare/workers-types` and the existing `package-json-dependency` patch kind. No CLI change. One PR, in the phase order below. Phase 1 alone clears #253.

For each capability, the change has the same four parts:

1. The provider file adds one `import type` line and rewrites its "ambient globals" header comment to say the types are imported, and why: the barrel compiles this file in every consumer of the core.
2. The provider's `registry-item.json` adds a patch: `{"file":"packages/<cap>/package.json","kind":"package-json-dependency","section":"devDependencies","name":"@cloudflare/workers-types","range":"5.20261001.1"}`, the pin the cores carry today.
3. `modules/<cap>/files/package.json` removes the `@cloudflare/workers-types` devDependency.
4. `modules/<cap>/files/tsconfig.json` removes `compilerOptions.types`, and removes `compilerOptions` when it is then empty.

### Phase 1: email (built 2026-10-24)

- Apply the four parts to `email-cloudflare` and `email`, with `import type { SendEmail } from "@cloudflare/workers-types"`.
- `modules/email/skills/saasaloy-email/SKILL.md`: update any sentence that says the core carries Worker types.

Done when:

- In `.dev`, a fresh project with `email`, `email-cloudflare` and `email-react` passes `pnpm typecheck` with exit 0, and `pnpm --filter @repo/email-react typecheck` prints no TS2304.
- In `.dev`, a fresh project with `email`, `email-console` and `email-react` passes `pnpm typecheck`, and its `packages/email/package.json` has no `@cloudflare/workers-types`.

### Phase 2: kv and queue (built 2026-10-24)

- Apply the four parts to `kv-cloudflare` and `kv`, with `import type { KVNamespace, RateLimit }`.
- Apply part 1 only to `queue-cloudflare`, with `import type { ExecutionContext, Message, MessageBatch, Queue, ScheduledController }`. The `queue` core keeps its devDependency and its `types` entry, with a comment that names the reason (the Q12 row). `cloudflareQueueHandlers()` still registers in the `handlers` table in `apps/api/src/worker.ts`, and the imported interfaces stay structurally the same as the globals that `apps/api` sees.
- Update the `kv` and `queue` capability skills where they say the core carries Worker types.

Done when: in `.dev`, a fresh project with `kv`, `kv-cloudflare`, `queue`, `queue-cloudflare` and `feature-flags` passes `pnpm typecheck` with exit 0, and a project with `kv-memory` and `queue-memory` only passes it with no `@cloudflare/workers-types` in `packages/kv/package.json`.

### Phase 3: storage (built 2026-10-24)

- Apply the four parts to `storage-cloudflare` and `storage`, with `import type { R2Bucket, R2Object, R2PutOptions, ReadableStream as WorkerReadableStream }`.
- Change the 3 boundary points: `cloudflare.ts:227` (`get`), `:305` (`put`) and `:335` (`uploadPart`), as the Design decisions row says, with one comment above them.
- Update the `storage` capability skill where it says the core carries Worker types.

Done when: in `.dev`, a fresh project with `storage` and `storage-cloudflare` passes `pnpm typecheck` with exit 0, the `storage-cloudflare` tests pass, and a project with `storage-memory` only passes it with no `@cloudflare/workers-types` in `packages/storage/package.json`.

### Phase 4: sms, logger and the provider rule (built 2026-10-24)

- `modules/sms/files`, `modules/logger/files` and `modules/payment/files`: remove the devDependency and `compilerOptions.types` (parts 3 and 4). No provider change.
- `.agents/skills/create-provider/SKILL.md`: correct line 184 and the `kv` and `queue` binding-flavour text that say a binding provider has no npm dependency. Add one rule to "The shape": a provider names a vendor type with `import type`, never an ambient global, and pins the types package with a devDependency patch into its core.

Done when:

- `grep -rln workers-types modules/{email,kv,storage,sms,logger,payment}/files` prints nothing.
- Each of the four `modules/*-cloudflare/files/cloudflare.ts` files starts with an `import type { … } from "@cloudflare/workers-types"`.
- In `.dev`, a full `database-d1` scaffold (every module, `database-d1` side of each conflict) passes `pnpm typecheck` with exit 0.
- The repo gate exits 0: `pnpm lint`, `pnpm typecheck`, `pnpm test`. `pnpm deps:check` lists the new devDependency patch pins and adds no new failure (it already fails on `main` for upstream drift).

## Open questions

None. The grill settled every decision.

## Non-goals

- The other #220 failures: #252 (`@repo/admin` payments imports), the auth lint failure, and the `ERR_PNPM_PACKAGE_MANAGER_NO_IMPORTER` smoke failure.
- Any change to `email-react` files or to ADR 0036.
- `@cloudflare/workers-types` in `packages/auth`, `packages/feature-flags`, `packages/db` or `apps/api`.
- A static guard against ambient globals.
- Generating Worker types with `wrangler types`.
