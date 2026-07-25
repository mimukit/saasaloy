---
name: saasaloy-infra
description: Runbook for the infra capability — centralized Cloudflare deployment for every Saasaloy service via Pulumi. Use when setting up deploy credentials, running preview/deploy/destroy, adding a service so infra picks it up, debugging an "infra doesn't support '<type>' yet" error, or reasoning about state/secrets. Covers the discover → translate → deploy pipeline, the file:// state backend, and why secrets never enter Pulumi.
---

# infra — centralized deployment via Pulumi

`infra` is the capability that takes every other service from `vite dev` to the real
Cloudflare edge. It's a [Pulumi](https://www.pulumi.com) program (`@pulumi/cloudflare`)
that never duplicates a service's config: capabilities keep declaring their resources in
their own `wrangler.jsonc` (unchanged contract), and `infra` **discovers** those files,
**translates** their bindings into Cloudflare resources, and **deploys** the built
Worker. See [ADR 0021](../../../docs/adr/adr-0021-pulumi-iac-engine-for-infra-2026-07-25.md)
for why Pulumi (provider optionality) over wrangler-native, Alchemy, SST, or Terraform.

## Credentials setup (first run only)

`infra` needs three env vars — set them in your shell before `preview`/`deploy`:

```sh
export CLOUDFLARE_API_TOKEN=...              # Workers Scripts + D1 edit permissions
export CLOUDFLARE_DEFAULT_ACCOUNT_ID=...      # account resources are provisioned into
export PULUMI_CONFIG_PASSPHRASE=dev-passphrase # any fixed value — no secrets ever enter state
```

`saasaloy add infra` prints these as reminders; it never writes a `.env` for you.

## The three scripts

Run from inside `infra/` (or `pnpm --filter @repo/infra <script>` from the repo root):

```sh
pnpm run preview   # pulumi preview — shows the diff, no changes applied
pnpm run deploy     # pulumi up — builds every discovered service and deploys it
pnpm run destroy    # pulumi destroy — tears everything infra created back down
```

`deploy` builds each service (its own `package.json` "build" script) before deploying,
so it's always shipping what's actually on disk — never a stale `dist/`.

## Add a service: nothing to do here

Drop a new `apps/<name>/wrangler.jsonc` or `packages/<name>/wrangler.jsonc` (installing
a capability like `api` does this for you) and it shows up on the next `preview`/`deploy`
automatically — `index.ts` is never hand-edited to register a service. `src/discover.ts`
walks `apps/*` and `packages/*` for a `wrangler.jsonc`, parses it with `jsonc-parser`
(the same library the CLI's own config-patch engine uses, ADR 0010), and hands the result
to `src/translate.ts`.

## Unsupported binding type: fail loud, not silent

`src/translate.ts` only understands what shipped capabilities declare today — `vars` and
`d1_databases`. A service that declares anything else (an `r2_buckets` entry, say) makes
`deploy`/`preview` **throw**: `infra doesn't support 'r2_buckets' yet`. That's
deliberate — silently skipping a binding would ship a Worker missing a resource its code
expects. When you hit this:

1. Confirm the binding is genuinely new (not a typo in `wrangler.jsonc`).
2. Extend the `switch` in `toResources` (`src/translate.ts`) with a case that maps the
   binding to its Cloudflare Pulumi resource, pushing a matching entry onto `bindings`.
3. If the bridged Cloudflare provider can't express the resource directly (it lags the
   native Cloudflare API — see ADR 0021's known gaps), shell out to `wrangler` for that
   one resource instead — contained inside `infra`, invisible to the capability that
   declared it.

## State: committed in this workspace, never a Pulumi Cloud account

`Pulumi.yaml` points the backend at `file://./state` — state lives at `infra/state/` and
is **committed to the consumer repo**, PR-reviewable like everything else Saasaloy scaffolds.
Known trade-off: no concurrency locking, so don't run `deploy` from two machines at once.
Outgrowing this is a one-line change (swap the backend URL for an R2 bucket over its S3
API via `pulumi login s3://...`) — nothing else about `infra` changes.

## Secrets never enter Pulumi

Worker secrets (API keys, tokens your Worker reads via `env.SOME_SECRET`) are **never**
passed through Pulumi config or resources — Pulumi state is committed, so that would
leak them into git history. `src/secrets.ts` pushes `.env` values straight to Cloudflare
via `wrangler secret put` (stdin, never a CLI arg), skipping any key already declared as
a plain `vars` binding (those are non-secret and already flow through `translate.ts`).
`index.ts` calls this after deploying each service — nothing extra to run by hand.

## Scope: Cloudflare only, v1

`infra` deploys to Cloudflare exclusively. The IaC engine (Pulumi) was chosen for future
provider optionality, but v1 builds none of it — no GCP/AWS/Neon/PlanetScale code ships
here (ADR 0021, extending [ADR 0001](../../../docs/adr/adr-0001-all-in-on-cloudflare-2026-07-22.md)).
Multi-cloud, if it ever happens, is a deliberate later migration — never a config toggle.

## Conventions to honor

- **Never hand-edit `index.ts` to add a service** — drop a `wrangler.jsonc`; discovery
  finds it.
- **A new binding kind is a `translate.ts` change, not a silent skip.** Loud failure is
  the contract.
- **Secrets go through `src/secrets.ts` / `wrangler`, never through Pulumi resources or
  config.**
- **`infra` consumes `wrangler.jsonc`, never edits it** — the capability contract stays
  with the capability that owns the file.
