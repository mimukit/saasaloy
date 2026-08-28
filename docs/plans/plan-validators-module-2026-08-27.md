# Plan: validators capability module

Grilled: 2026-08-27

## Context

Input validation schemas today live inline in api routes; nothing shares them. The RPC rework (gap 2) and the admin app (gap 3) both need the same Zod schemas on the server and in a client bundle. Gap item 4 in `unishopr-reborn/docs/misc/saasaloy-base-and-gaps-2026-08-27.md` calls for `packages/validators` with zod as the only runtime dependency. The base template is deliberately frontend-only (ADR-0003), and zod currently enters a project only through the api module, so the package arrives as a registry module, not a template package. Success means `saasaloy add validators` scaffolds a `packages/validators` that an api route consumes through `@hono/zod-validator` and a browser bundle can import without pulling server code.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Placement | A `validators` capability module scaffolds `packages/validators`, like database scaffolds `packages/db`. The base template stays frontend-only. |
| Coupling to api | `dependsOn: ["api"]`. Verified fact: a patch whose target file is missing is silently skipped and never retried (`applier.ts:288`; add-order is strict, no retro-apply), so loose coupling would let "add validators, then api" quietly yield a broken import. The resolver now guarantees `apps/api/package.json` exists when the dependency patch runs. |
| File shape | Per-feature files `src/<feature>.ts` with an `exports` map of `"./*": "./src/*.ts"`. Consumers import `@repo/validators/<feature>`. Mirrors `@repo/db/repositories/*`. |
| Error schema | `src/common.ts` seeds a shared `errorSchema`: `{ error: { code, message } }`. The RPC rework's routes and clients type against it instead of inventing per-route shapes. |
| Runtime deps | zod only, pinned to the same version as the api module (4.4.3 today). No @hono/zod-validator here; the adapter stays in apps/api. |
| Pin lockstep | Accepted risk: the deps updater resolves per-file, so the two zod pins can drift. Mitigation: extend `scripts/update-deps.ts`'s "Notes" output to flag same-dep version divergence across template/module manifests. |
| Isomorphism | No Workers types, no Node APIs, no `process.env` in schema files. The package must bundle for the browser unchanged. |

## Approach

Reuse the database module's descriptor as the template: a `saasaloy:capability` with one `scaffolds` entry, an alias (`@validators`), and a `package-json-dependency` patch onto `apps/api/package.json`. Reuse `@repo/db`'s package.json shape (`clean` via rimraf, `typecheck`, exports map). The `create-module` skill authors the descriptor.

### Phase 1: module descriptor and package files (#84)

Create `modules/validators/registry-item.json` (`dependsOn: ["api"]`) scaffolding `packages/validators`: `package.json` (`@repo/validators`, zod 4.4.3, `clean`, `typecheck`), `tsconfig.json` extending `@repo/tsconfig`, `src/common.ts` with `errorSchema` plus reusable primitives (`email`, `id`, pagination). Patch `"@repo/validators": "workspace:*"` into `apps/api/package.json`. Verify: `saasaloy add validators` in `.dev` (api present via the resolver) scaffolds and typechecks.

### Phase 2: api consumption convention (#84)

Prove the pattern end-to-end in `.dev`: a route validating with `zValidator("json", someSchema)` where `someSchema` comes from `@repo/validators/<feature>`, inferred types flowing to the handler, error responses shaped by `errorSchema`. Document the convention in `skills/saasaloy-validators/SKILL.md`: one file per feature, schemas named `<action><Feature>Input`, types via `z.infer`, no server imports, errors via `errorSchema`.

### Phase 3: updater divergence note (#84)

Extend `scripts/update-deps.ts` to emit a "Notes" line when the same dependency resolves to different versions across template/module manifests in one run (today only repo-pin major divergence is flagged). Verify with a fixture or a dry run against the doubled zod pin.

### Phase 4: docs and registry hygiene (#84)

Update `modules/README.md` and the root README module table. Run `pnpm deps:verify` for the zod pin. Note in the database and api skills that request-shaped validation belongs in `@repo/validators`, while DB column shapes stay in `packages/db/src/schema`.

## Non-goals

- No validation adapter code (`@hono/zod-validator` wiring stays in apps/api routes).
- No response/output schemas beyond `errorSchema`; response typing comes from RPC inference.
- No base-template change.
- No migration of existing inline schemas; the waitlist schema moves in the RPC plan's phase 3, not here.
- No cross-file lockstep grouping in the deps updater; the divergence note is the whole mitigation.
