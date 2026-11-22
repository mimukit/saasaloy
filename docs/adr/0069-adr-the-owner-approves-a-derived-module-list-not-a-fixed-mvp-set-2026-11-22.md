# 0069: The owner approves a derived module list, not a fixed MVP set

Plan [0074](../plans/0074-plan-agent-native-mvp-build-2026-10-21.md) set a fixed "MVP bar": every agent build installed `auth`, `app`, `admin`, `email` with `email-console`, and later the agent set (`agent`, `api-keys`, `api-keys-user`). `saasaloy-setup` left that set out of the interview, and `saasaloy-build` installed every module whose `stage` was `validate` or `mvp`. An owner who wanted one account and no admin app could only keep the set or deviate from it. Settled in the grill of plan [0123](../plans/0123-plan-derived-mvp-modules-2026-11-22.md) on 2026-11-22.

**No module is fixed. The floor is the base template's landing page.** The interview proposes each module from the owner's answers with the rules in `saasaloy-setup/module-triggers.md`, gives a reason for each one, and resolves the list with `saasaloy add <picks> --dry-run --json`. The owner approves the list in the product read-back, and the spec hash in `docs/product-approvals.json` covers it. **The build installs the spec's `## Modules` table and no others.** A module's `stage` is a hint for grouping and for build order, never a reason to install it. When a rule is unclear, the agent asks the owner. With `autonomy: afk` and no spec, the build derives the list from the brief, logs each reason, and leaves an unclear module under `## Left for a human`.

## Status

accepted. Replaces the fixed module set of plan 0074's "MVP bar". The bar's checks stay, and a check of a module applies only when the approved spec lists that module.

## Considered Options

- **Drop only `admin` from the fixed set.** Rejected. It fixes the reported case, but a landing-page-only MVP stays impossible.
- **Named presets ("landing", "SaaS", "team SaaS") that the owner picks.** Rejected. A preset hides the reason for each module and brings back fixed lists under more names.
- **Keep a technical floor of `database`, `api`, `auth`, `app` and `shell` in every build.** Rejected. A product with no signed-in part does not need them. The trigger table adds them as one group when the product has an entity, because `saasaloy-feature` cannot build one without them.

## Consequences

- `admin` comes in only for staff work or as a dependency. `teams`, `payment`, `subscription`, `cms`, `feature-flags`, `file-uploads`, `multitenant` and `ecommerce` depend on it. A build without `admin` seeds no superadmin and builds no admin list.
- The owner may drop `email` from a product with sign-in. Users then cannot reset a password, and the handover names the `saasaloy add` command.
- The agent benchmark (`scripts/agent-bench/score.ts`) and the CI scaffold set (`MVP_MODULES` in `scripts/scaffold-check.ts`) no longer mirror one build. Plan 0123 phase 3 makes the score follow the spec and renames the set to `SCAFFOLD_MODULES`.
