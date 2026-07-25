# Plan — `infra` capability module (Pulumi, Cloudflare-only v1)

*Drafted 2026-07-25. Grilled: 2026-07-25.*

## Context

`infra` is the capability module that closes the deploy gap issue #29 tracks: every shipped
capability is deliberately deploy-agnostic — `api` ships `apps/api/wrangler.jsonc`, `database`
patches its D1 binding into it, and local `workerd` (`vite dev`) is their DoD — but nothing yet
takes a consumer repo to the real edge. `infra` centralizes that in one reviewable place: it
discovers installed services, provisions the Cloudflare resources their configs declare, and
deploys them via IaC.

The engine is **Pulumi** (`@pulumi/cloudflare`), chosen after a researched comparison
(wrangler-native, Alchemy, SST, Terraform, Pulumi — evidence summarized in the grill on #29) for
**provider optionality**: the roadmap may later add non-Cloudflare targets (containerized api on
Cloud Run/Lambda, Postgres on Neon/PlanetScale), and Pulumi is the one engine that extends there
instead of being replaced. The costs are accepted knowingly: its Cloudflare provider is bridged
from the Terraform v5 provider (lags upstream, documented Workers gaps), and Saasaloy owns a
`wrangler.jsonc → Pulumi` translation layer forever — on-brand cost, since absorbing vendor churn
in the tool repo is the product thesis (ADR 0020's rationale).

**The capability contract is preserved**: capabilities keep declaring resources in `wrangler.jsonc`
(the `wrangler-binding` patch kind is untouched); `infra` consumes those configs rather than
duplicating them. Adopting Pulumi requires **zero changes** to `api` or `database`.

Success = from `.dev/`, `saasaloy add infra` scaffolds the workspace, `pulumi up` puts `apps/api`
on a real `workers.dev` URL with a real provisioned D1 database, `GET /health` returns green on
the edge — closing the api plan's deferred "deploys to Workers" criterion — and `pulumi destroy`
tears it all down.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Shape | **Scaffolded capability workspace** (`infra/`), not a CLI command — deploy logic lives in the consumer repo, reviewable, per the copy-in model. |
| IaC engine | **Pulumi** (`@pulumi/pulumi` + `@pulumi/cloudflare`), for multi-provider future-proofing. Extends ADR 0001 (needs its own ADR): still **one runtime provider** (Cloudflare); the engine is chosen for optionality, multi-cloud remains a later explicit migration, never a config toggle. Alchemy rejected (self-declared alpha, mid v1→v2 Effect rewrite); SST rejected (forbids `wrangler.jsonc` — inverts the capability contract, retrofits shipped modules, owns the dev loop); Terraform rejected (HCL second language, duplicates config); wrangler-native passed over (no state/diff/teardown, dead end for multi-cloud). |
| Tier / graph | **Root capability** (`saasaloy:capability`, `dependsOn: []`) — peer of `api`/`database`. With nothing deployable installed, discovery no-ops gracefully. |
| Vendor encapsulation | ADR 0020 holds: `@pulumi/*` appears only in `infra/package.json`; no other workspace imports it. App code is untouched (bindings still arrive via `c.env`). |
| Declare/execute contract | Capabilities declare in **`wrangler.jsonc`** (unchanged, source of truth); `infra` discovers workspaces bearing one, translates via `src/translate.ts`, and deploys each service's built bundle (`cloudflare.WorkersScript` + `contentFile`). |
| Translation scope (v1) | **Ship-what-exists**: Workers (script, `vars`) + **D1** bindings — exactly what shipped capabilities declare today. Unknown binding types **fail loudly** ("infra doesn't support `<type>` yet"), never silently skip. R2/KV/Queues translation lands when a capability actually declares them. |
| State backend | **`file://` (DIY backend), state JSON committed in the consumer repo** — PR-reviewable, zero accounts, right for a starter. R2 backend (`pulumi login s3://` via R2's S3 API) documented as the team-scale upgrade. Known DIY tradeoff: no concurrency locking / transactional recovery. |
| Secrets | **Never enter Pulumi config/state** (state is committed, so this is load-bearing). Worker secrets flow from `.env` via the CF API/wrangler, outside Pulumi. `PULUMI_CONFIG_PASSPHRASE` still required by the engine — fixed dev value is acceptable since no secrets are encrypted with it. |
| Stacks / teardown | **Single default stack** in v1; multi-stage documented but untested. `pulumi destroy` included (comes free) — part of the DoD. |
| Escape hatch | Where the bridged provider is broken for a specific resource, `infra` may **shell out to `wrangler`** tactically — contained inside the workspace, invisible to capabilities. |
| Agent context | Ships `skills/saasaloy-infra/SKILL.md` (`saasaloy-` prefix, ADR 0014): credentials setup, deploy/preview/destroy runbook, how a capability's bindings reach the edge, what to do on "unsupported binding type". |
| Acceptance / DoD | **Real edge deploy from `.dev/`**: `pulumi preview` shows the plan, `pulumi up` provisions D1 + deploys `apps/api`, deployed `GET /health` green, `pulumi destroy` cleans up. Requires a real CF account/API token (first module to do so). |

## Approach

### Phase 1 — Descriptor (`modules/infra/registry-item.json`)
- `name: "infra"`, `type: "saasaloy:capability"`, `dependsOn: []`, empty `dependencies`/`patches`.
- `envVars`: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_DEFAULT_ACCOUNT_ID`, `PULUMI_CONFIG_PASSPHRASE`.
- One `scaffolds[]` entry: `workspace: "infra"`, files below; validate via `validateRegistryItem`.

### Phase 2 — Workspace files (`modules/infra/files/`)
- `package.json` — owns `@pulumi/pulumi` + `@pulumi/cloudflare` (exact-pinned); scripts:
  `preview`, `deploy` (`pulumi up`), `destroy`; `wrangler` as devDep for the secrets/escape-hatch path.
- `Pulumi.yaml` — project config, `backend: file://` relative to the repo (state dir committed).
- `index.ts` — program: `discoverServices()` → per service, `toResources()` + `WorkersScript`.
- `src/discover.ts` — glob `apps/*/wrangler.jsonc` + `packages/*/wrangler.jsonc`, parse (jsonc
  parser per ADR 0010 toolbox), return `{ name, dir, config }`.
- `src/translate.ts` — the maintained core: `d1_databases` → `cloudflare.D1Database` + binding
  entry; `vars` → plain bindings; anything else → loud error. Runs each service's build
  (`vite build`) and hands `contentFile`/`contentSha256` to `WorkersScript`.
- `src/secrets.ts` — push `.env` worker secrets via API/wrangler, outside Pulumi state.

### Phase 3 — Skill runbook (`modules/infra/skills/saasaloy-infra/SKILL.md`)
- Credentials + passphrase setup, the three scripts, state-in-repo expectations (commit the diff),
  R2 backend upgrade note, unsupported-binding-type playbook, escape-hatch policy.

### Phase 4 — Exercise in `.dev/` (the DoD)
- `saasaloy add infra` scaffolds the workspace into `.dev/`.
- `pulumi preview` → diff shows D1 + Worker; `pulumi up` → real `workers.dev` URL, real D1,
  `GET /health` green on the edge; commit shows state JSON; `pulumi destroy` removes both.
- This also closes the api plan's deferred edge-deploy criterion and exercises `database`'s
  placeholder-id → real-id flow.

### Phase 5 — Records
- ADR (domainkit): Pulumi as IaC engine, explicitly extending ADR 0001.
- Update issue #29: settled scope, drop "IaC tool choice is open", link this plan, promotable
  from `needs-planning`.

## Open questions

- **`database_id: "local"` placeholder** — when Pulumi provisions the real D1, does `infra` write
  the real id back into `wrangler.jsonc` (mirroring wrangler's own write-back behavior) or resolve
  it only in-memory at deploy time? Settle while building Phase 2.
- **Bundle handoff details** — exact `@cloudflare/vite-plugin` build output shape (single file vs
  chunks) vs `WorkersScript.contentFile`'s single-file expectation; fallback is the wrangler
  escape hatch. Verify hands-on in Phase 4.
- **Queues consumer model** — provider configures consumers on the queue resource, not as a worker
  binding; irrelevant to v1 scope but shapes the translation layer's future contract.
- **Migrations at deploy time** — should `infra` run `db:migrate:prod` as part of `deploy`, or
  leave it a separate manual step? Lean manual (matches database plan's "fully manual" stance).

## Non-goals

- **Any non-Cloudflare target** — no GCP/AWS/Neon/PlanetScale code ships in v1; the engine choice
  buys the option, v1 does not build the optionality (ADR 0001 still governs runtime).
- **R2/KV/Queues translation** — no capability declares them yet; loud-fail until one does.
- **Multi-stage environments** — documented, not tested; single stack in v1.
- **Secrets through Pulumi config/state** — explicitly excluded (state is committed).
- **CI/CD wiring** (deploy-on-push, PR previews) — later concern once manual deploy is proven.
- **Retrofitting `api`/`database`** — zero changes to shipped modules by design.
