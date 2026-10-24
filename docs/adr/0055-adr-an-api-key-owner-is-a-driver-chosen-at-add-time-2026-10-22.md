# 0055: An API-key owner is a driver chosen at `add` time

`api-keys` made every key organization-owned, so a project with no organizations could not install it without `multitenant`, `teams` and `admin`. The owner now splits the way `database` splits by driver: `api-keys` declares `requiresOneOf: ["api-keys-organization", "api-keys-user"]`, the two owners name each other in `conflictsWith`, and the core keeps what both share (the dependency, the client plugin, the shared plugin options and the two `auth.ts` patches). The owner changes the table's column and every file that reads it, and a switch moves data, so ADRs 0026, 0033 and 0037 put the choice at `add` time and never in an env var. In user mode a key belongs to one user and is checked against a key vocabulary the project edits, not against role statements, and a route reads `{ userId, principal }` through `requireCaller`. Settled on 2026-10-22 in the grill of `docs/plans/0083-plan-user-owned-api-keys-2026-10-22.md`.

## Status

accepted

## Considered Options

- A standalone `api-keys-user` module that conflicts with `api-keys`. Rejected: it copies the option set, the scope transport and the bearer parsing, and the copies drift, the reason ADR 0047 gives against a copied shell.
- Pick the owner from whether `multitenant` is installed. Rejected: it needs patch `onlyWith` and a negated condition, and an unrelated module would decide the owner.
- A personal organization per user, so every key stays organization-owned. Rejected: it needs the modules a single-owner project cannot carry, and a membership read on every request.
- Move `can()` from `teams` into `auth` so both modes share one rule. Rejected for now: it moves a file in every `teams` project. `api-key-rules.ts` ships in `api-keys-user`, and a test pins its refusal text to the `permission required: <resource>:<action>` format.

## Consequences

- A signed-in user passes every `requireScope` demand. A scope narrows a key and never a person, so data ownership stays the route's job.
- `API_KEY_SCOPES` ships empty. A scoped create answers 403 until the project declares its pairs, and the guard checks every create, with or without a session.
- `api_keys.user_id` cascades on user delete, so a deleted account leaves no live key.
- A split is only safe for an installed project if the CLI knows about it. `update` now refuses with exit 2 on an unmet `requiresOneOf` before it plans a delete, `add` re-records an already-applied patch under the module that depends on its owner, and `doctor` reports the unmet requirement. Without the first fix, an `api-keys` project that ran `update` would lose its schema file and the next migration would drop `api_keys`. That CLI is 0.7.0. `api-keys`, `api-keys-organization` and `api-keys-user` declare `requires.saasaloy: ">=0.7.0"`, and every released CLI from 0.5.1 checks that range in `add` and `update` and refuses with an upgrade line, so an older CLI cannot run the delete or record the moved patches under the wrong module.
- Switching owners moves no keys. Revoke every key, remove one owner, add the other.
