# 0021 — Pulumi is the IaC engine for the `infra` capability

The `infra` capability module (issue #29) centralizes deployment of all Saasaloy services and uses
**Pulumi** (`@pulumi/pulumi` + `@pulumi/cloudflare`) as its engine, scoped to **Cloudflare-only in
v1**. The engine is chosen for **provider optionality** — the roadmap may later add non-Cloudflare
targets (containerized api on Cloud Run/Lambda, Postgres on Neon/PlanetScale), and Pulumi is the
one credible engine that extends there instead of being replaced. This **extends ADR 0001, it does
not reverse it**: Cloudflare remains the only *runtime* provider, and multi-cloud stays a later
explicit migration, never a config toggle. Capabilities keep declaring resources in their own
`wrangler.jsonc` (the existing contract is untouched); `infra` discovers those configs and
translates them into Pulumi resources. Settled while grilling issue #29, backed by a
primary-source comparison of the field (2026-07-25).

## Status
accepted

## Considered Options
- **Wrangler-native** (thin orchestrator over `wrangler deploy` + auto-provisioning) — the
  cheapest fit for today's contract, but no state/diff/teardown story and a dead end for any
  future non-Cloudflare target; passed over for engine continuity.
- **Alchemy** — TS-native and Cloudflare-first, but self-declared alpha ("expect breaking
  changes") and mid v1→v2 rewrite onto Effect; scaffolding it into consumer repos ships that
  churn to every user. Revisit at its first stable v2 release.
- **SST v3** — mature Cloudflare components, but it forbids `wrangler.jsonc` files and generates
  its own: adopting it inverts the capability contract, retrofits shipped modules (`api`,
  `database`), spreads its `Resource` SDK into app code (against ADR 0020), and takes over the
  `vite dev` loop. Rejected on architecture, not maturity.
- **Terraform/OpenTofu** — Cloudflare's officially recommended IaC, but HCL is a second language
  in an all-TS monorepo and every binding would be re-declared, duplicating `wrangler.jsonc`.

## Consequences
- Saasaloy owns a `wrangler.jsonc → Pulumi` translation layer (`infra`'s `src/translate.ts`)
  permanently — deliberate: absorbing vendor churn in the tool repo is the product thesis
  (ADR 0020's rationale). v1 translates only what shipped capabilities declare (Workers + D1);
  unknown binding types fail loudly.
- The Cloudflare provider is bridged from the Terraform v5 provider: it lags upstream and has
  documented Workers gaps. Where broken, `infra` may tactically shell out to `wrangler` —
  contained inside the workspace, invisible to capabilities.
- Pulumi state uses the DIY `file://` backend, committed in the consumer repo (PR-reviewable,
  no accounts); secrets never enter Pulumi config/state and flow via the CF API/wrangler instead.
- ADR 0020 holds: `@pulumi/*` lives only in the scaffolded `infra` workspace's `package.json`.

## References
Issue #29. Plan: `docs/plans/plan-infra-capability-module-2026-07-25.md`. Prior:
[ADR 0001](adr-0001-all-in-on-cloudflare-2026-07-22.md),
[ADR 0020](adr-0020-capability-owns-its-vendor-packages-2026-07-24.md).
