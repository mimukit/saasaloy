# Plan: Hono RPC route shape for the api module

Grilled: 2026-08-27

## Context

The api module registers routes with `import.meta.glob`: a module drops `@api/routes/<feature>.ts` and the entry mounts it at runtime, with no edit to `src/index.ts`. That gives zero-edit drops but no composed type, so clients (the future admin app, web islands like `WaitlistForm`) hand-write fetch calls and response shapes. Gap item 2 in `unishopr-reborn/docs/misc/saasaloy-base-and-gaps-2026-08-27.md` calls for chained routes, explicit status codes, and an exported `AppType` for `hono/client` inference. Success means a consumer writes `const res = await client.waitlist.$post({ json })` and the request body, status codes, and response body are all inferred from the server code.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| RPC is the default | The reworked `api` module IS the api capability. No opt-in variant, no separate `api-rpc` module, no legacy file-per-route mode kept alongside. Every new scaffold gets RPC. |
| Route registration | Static chained spine. `src/index.ts` chains `.route("/<feature>", feature)` explicitly and exports `AppType`. The `import.meta.glob` mount goes away. |
| How modules add routes | A new `chained-route` patch kind in the applier: adds the import and inserts `.route("/x", x)` into the chain via magicast (ADR-0010). No anchor comments; the future `update` flow works from manifest hashes and three-way merge (ADR-0006, plan-update-and-ai-merge), never sentinel markers. |
| chained-route removal | This kind implements its inverse in the remover, alone among patch kinds: a stale `.route()` referencing a deleted file breaks typecheck, unlike a stale wrangler binding. The general patch-reversal issue stays open where the remover documents it. |
| Route file contract | Each file exports a chained sub-app: `const waitlist = new Hono<...>().get(...).post(...)`. Chaining is required inside route files too; statement-style `app.get(...)` loses type accumulation. |
| Status codes | Always explicit: `c.json(body, 200)`, `c.json({ error }, 400)`. Explicit literals are what narrow the client's per-status response types. |
| Error shape | Responses of 4xx/5xx conform to `errorSchema` from `@repo/validators/common` (`{ error: { code, message } }`), one shape across all modules. |
| auth mount | The better-auth catch-all mounts before the typed chain and stays out of `AppType`. Frontends touch `/auth/*` only through `@repo/auth/client`. |
| AppType consumption | Consumers import `type { AppType }` from `@repo/api` (a type-only `"./client"` export on apps/api) and call `hc<AppType>` themselves. Each consumer owns its three-line `src/lib/api.ts`; no shared client package. |
| Validation | Routes validate with `zValidator` over schemas from `@repo/validators/<feature>` (plan-validators-module-2026-08-27.md), so input types flow into the client. |
| tsc cost | Measured, not assumed: phase 2 benchmarks typecheck time with a batch of synthetic routes. If it degrades, the documented mitigation is per-feature `hc<typeof feature>` clients; the spine stays chained either way. |

Rejected: per-feature RPC types over the surviving glob (keeps zero-edit drops, fragments the client); a hand-maintained type-only chain beside the glob (two sources of truth).

## Approach

Reuse the applier's `plugin-array` machinery as the model for the new patch kind, the existing `Bindings` type and CORS spine in `src/index.ts`, the `DbBindings` composition convention from the database module, `errorSchema` from the validators module, and the applier test harness for fixtures.

### Phase 1: `chained-route` patch kind in the applier (#83)

Add the patch kind to `packages/cli/src/lib/schema.ts` and the patch dispatch: given `{ file, kind: "chained-route", path: "/waitlist", import: { name, from } }`, insert the import and append `.route("/waitlist", waitlist)` to the exported chain. Implement the inverse in `remover.ts` (delete the call and the import). Add applier-harness fixtures for add, re-add idempotency, and remove. Verify: CLI test suite green.

### Phase 2: rework the api module to the RPC shape (#86)

Rewrite `modules/api/files/src/index.ts`: keep `Bindings` and the CORS middleware, mount the (future) auth handler before the chain, replace the glob loop with an explicit chain starting at `health`, and `export type AppType = typeof routes`. Rewrite `routes/health.ts` to the chained-export contract with an explicit `c.json({ status: "ok" }, 200)`. Add the type-only `"./client"` entry to apps/api's package.json `exports`. Benchmark typecheck with ~30 synthetic chained routes and record the number in the skill. Rewrite `skills/saasaloy-api/SKILL.md`: chained sub-app export, explicit status codes, `errorSchema` for errors, `DbBindings` composition, and the client-side `hc<AppType>` recipe with `PUBLIC_API_URL`. Verify: `saasaloy add api` in `.dev`, then `hc<AppType>` against the dev Worker infers `/health`.

### Phase 3: migrate the waitlist module (#86)

Rewrite `modules/waitlist/files/api/routes/waitlist.ts` chained, with explicit 201/400/409 responses shaped by `errorSchema` and `zValidator` over a schema that moves to `@repo/validators/waitlist` (waitlist's `dependsOn` gains `validators`). Add the `chained-route` patch to waitlist's descriptor. Rework `WaitlistForm.tsx` to use `hc<AppType>` with `PUBLIC_API_URL`, adding the type-only `@repo/api` devDependency to apps/web via the existing `package-json-dependency` patch kind. Verify in `.dev`: add waitlist, submit the form, then `remove waitlist` leaves a compiling api (the chained-route inverse at work).

### Phase 4: auth module follow-through, docs, and ADR (#86)

Update the auth module's descriptor to mount its handler via the pre-chain slot (its route file keeps working; the mount becomes explicit instead of glob-discovered). Record the drop-vs-patch convention change as an ADR; it reverses a defining convention, and `create-module`/`create-provider` must teach the patch instead of the drop. Update `modules/README.md` and the base template's `AGENTS.md` where they describe route drops. Verify: `pnpm test` (CLI), `pnpm deps:verify`.

## Non-goals

- No `packages/api-client`; consumers call `hc` themselves.
- No response-schema validation at runtime; types come from inference, not output parsing.
- No OpenAPI generation.
- No change to the CORS spine or the `Bindings` env conventions.
- No general patch-reversal mechanism; only `chained-route` gets an inverse here.
