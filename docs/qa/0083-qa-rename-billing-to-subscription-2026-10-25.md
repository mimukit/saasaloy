# QA plan: rename `billing` to `subscription` (#211)

Branch `issue-211-rename-billing-to-subscription`. Every automated result below ran against commit `19061126`. The fix commit `e1bfbd4a` changes one Markdown line in `packages/cli/templates/base/packages/ui/AGENTS.md` (`packages/billing` to `packages/subscription`), which no gate reads, so the results stand at `e1bfbd4a`; `rg -n "packages/billing|@repo/billing" packages/cli/templates/base` prints nothing there.

The change is a rename with no behaviour change. `billing`, `billing-console` and `billing-stripe` become `subscription`, `subscription-console` and `subscription-stripe`, along with their tables, env keys, routes, error type and skill. The Stripe provider drops its `modelName` override.

## Automated results

| ID | Check | How it ran | Result |
|---|---|---|---|
| C1 | `rg -i billing modules packages/cli/src scripts docs/wiki CONTEXT.md AGENTS.md README.md` prints only the runbook and history notes | ran the command in the worktree | ✅ The hits left are the runbook in `saasaloy-subscription`, the legacy `BILLING_APP_NAME` check in `doctor` and its tests, and `@better-auth/stripe`'s own `billingInterval` field (column `billing_interval`), which the rename keeps |
| C2 | `pnpm lint`, `pnpm test` and `pnpm test:modules` pass | ran each once in the worktree | ✅ lint exit 0; `test:modules` 997 pass, 0 fail; `pnpm test` exit 0 (CLI 70 files, base 91, tooling 147, scripts 462) |
| C3 | fresh `.dev` project: `saasaloy add subscription subscription-console`, then `db:generate`, produces `subscriptions` and `subscription_events` | `pnpm play:init`, `./saasaloy add database-d1 subscription subscription-console -y`, `pnpm --filter @repo/db db:generate` | ✅ the migration creates `subscriptions` (23 columns, indexes `subscriptions_reference_id_idx` and `subscriptions_provider_subscription_id_uidx`) and `subscription_events`, and adds `users.subscription_customer_id`. `pnpm typecheck` in the playground exits 0 |
| C4 | the console checkout flow works as it did under `billing` | playground with `email-console` and `queue-memory`, D1 migrated, api on port 4211; signed up a user and called the routes with `curl` | ✅ `GET /subscription/subscription` answers the `free` plan; `POST /subscription/checkout` for `pro` monthly answers the success URL; the read then answers `pro`, status `trialing`; D1 holds 1 `subscriptions` row and 1 `subscription_events` row; a second checkout answers `invalid_request` ("Already subscribed"); a `successUrl` off the `SUBSCRIPTION_APP_URL` origin answers `invalid_request` |
| C4 | the admin app wires the page | read the playground's generated files | ✅ `apps/admin/src/components/nav.ts` has `{ to: "/subscription", label: "Subscription" }`, `apps/admin/src/routes/subscription.tsx` exists and calls `api.subscription.subscription.$get()`, and the admin app typechecks |
| C5 | `CONTEXT.md`, both READMEs, `docs/wiki/`, AGENTS.md and the `create-provider` skill use the new names; ADR 0034 notes ADR 0045 | C1's grep covers the docs; read ADR 0034's Status section | ✅ ADR 0034 carries a "Renamed" note that links ADR 0045 and #211 |
| C6 | the skill carries the runbook for an installed `billing` project | read `modules/subscription/skills/saasaloy-subscription/SKILL.md` | ✅ section "Upgrading from `billing`": a rename table, 14 steps, and a rollback |

## Manual cases

These need a person. The admin page was not opened in a browser in this run, because ports 3001 and 4000 belonged to other runs on the box.

1. In a playground with `subscription subscription-console`, start the api and the admin app with `pnpm run dev`.
2. Sign in to the admin app.
3. Confirm the nav shows **Subscription** under Manage, with the card icon.
4. Open `/subscription`. Confirm it shows the Free plan and a way to start the Pro checkout.
5. Start the Pro checkout. Confirm the page returns to `/subscription` and shows Pro, trialing, with the trial end date.
6. Compare the page with the old `/billing` page on `main`. Only the names may differ.
7. Optional, with a Stripe test account: add `subscription-stripe`, set `SUBSCRIPTION_PROVIDER=stripe`, and run one checkout. Confirm the webhook writes a `subscriptions` row. This proves the plugin finds the table with no `modelName` override.
8. Optional: in a project with `billing` installed from `main`, follow "Upgrading from `billing`" in the skill. Confirm drizzle-kit offers the table and column renames, and that `/subscription` shows the old rows.
