# Plan: user-owned API keys, with no organization

Grilled: 2026-10-22

Issue: #229. Stacked on #167 (PR #168), which renames the permission files `api-keys` reads.

## Context

`api-keys` makes every key organization-owned. `apiKeyPlugin()` runs with `references: "organization"`, the descriptor has `dependsOn: ["multitenant"]`, and `apiKeyTenant()` turns a bearer key into a `Tenant`. A project with no organizations cannot install it without `multitenant`, `teams` and `admin`, which bring four tables, the `/roles` screen and the admin app.

Mindaloy is the first consumer. It is a single-owner spaced repetition app on the Workers free tier with `base`, `api`, `database-d1` and `auth` installed. Its Phase 3 needs a key that belongs to one user, scoped to a few resource and action pairs Mindaloy defines, presented by a script as `Authorization: Bearer sk_...`. Mindaloy keeps its own per-collection checks. Saasaloy gets no collection concept.

Success: `saasaloy add api-keys-user` installs on a project with only `auth` and its prerequisites, a signed-in user mints a scoped key, and a route reads `{ userId, principal }` from either a session or that key. Organization mode behaves as it does today, and an existing `api-keys` project moves to `api-keys-organization` without losing a file or a table.

What stays the same in both modes: the `sk_` prefix and the 8-character `start`, revocation, the synchronous `lastRequest` write, no default expiry, `requireName`, and ADR 0036's rule that a scope travels as `metadata.scope` and stays fixed at issue time.

Facts checked against `@better-auth/api-key` 1.7.7 `dist/index.mjs` on 2026-10-22 (this branch pins 1.7.2, and the code paths below have the same shape). With `references: "user"`, a create that carries a request takes `referenceId` from the session user and refuses a body `userId` with `UNAUTHORIZED_SESSION`. `get`, `update` and `delete` answer `KEY_NOT_FOUND` when `referenceId` is not the session user, and `list` filters on the session user. So the plugin already owns "whose key is this". This plan adds the scope ceiling and the route gate.

Facts checked against this branch's CLI on 2026-10-22:

- `update` deletes a file the module's new descriptor no longer lists when the file is unchanged on disk (`packages/cli/src/lib/updater.ts:713-743`, `1195-1199`). It never re-checks `requiresOneOf` (`commands/update.ts:803-827` runs only the CLI-version and conflict checks).
- `add` of a module that depends on the current owner adopts a byte-identical file and moves its ownership (`lib/applier.ts:425-433`, `833-842`, `lib/collisions.ts:95-101`). An already-applied patch comes back `changed: false` and is not recorded for the new module (`lib/applier.ts:381`, `858-874`), so it stays under the old owner.
- `doctor` does not report an unmet `requiresOneOf` (`lib/doctor.ts:413-428`, `782-804`).
- `remove` plans files and patches by the manifest's `entry.module` (`lib/remover.ts:144-146`, `185-187`).

Together these mean an existing `api-keys` project that runs `update` before it adds an owner loses `@db/schema/api-keys.ts`, and the next `db:generate` drops `api_keys`. Phase 2 closes that.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Owner choice (Q1, asked) | A driver-style split. `api-keys` declares `requiresOneOf: ["api-keys-organization", "api-keys-user"]`, and the two owners name each other in `conflictsWith`. The owner changes the table's column and every file that reads it, and a switch moves data, so ADRs 0026, 0033 and 0037 put the choice at `add` time. Rejected: a standalone sibling module (copies the option set, the scope transport and the bearer parsing, which drift), patch `onlyWith` keyed on `multitenant` (two new CLI features, and an unrelated module decides the owner), and a personal organization per user (needs the modules Mindaloy cannot carry). |
| Module names (Q7, asked) | `api-keys-organization` and `api-keys-user`, the two values of the plugin's `references` option. |
| What the core holds (Q1, Q9, asked) | `api-keys` holds the `@better-auth/api-key` dependency patch, `plugins/api-key-client.ts` and its `authClientPlugins` patch, the two `auth.ts` `plugin-array` patches for `apiKeyPlugin` and `apiKeyScopeGuard`, and a new `plugins/api-key-options.ts` with the shared plugin options, `scopeOf`, `GUARDED_PATHS`, the bearer header parsing and `INVALID_API_KEY`. Both owners ship `plugins/api-key.ts` at the same path, so the import line is the same in both modes and an owner switch keeps it. Each owner keeps only the patches that differ: `tenantResolvers` and `NAV_ITEMS` for organization, none for user. |
| Pure scope check (Q2, asked) | `api-keys-user` ships `api-key-rules.ts`, import-free, with `scopeDenial(scope, vocabulary)` for issue time and `keyAllows(principal, demand)` for request time. `can()` stays in `teams`. A test pins both refusal messages to the `permission required: <resource>:<action>` and `permission required` text of `permission-rules.ts`. |
| Session caller (Q3, asked) | `requireScope` lets a session user pass every demand. A scope narrows keys only. Data ownership is the route's job, for example a check on `userId`. |
| Empty demand (Q18, defaulted) | `requireScope` with an empty demand refuses with 403 `permission required`, the fail-closed rule of `can()`. |
| Route gate names (Q10, asked) | `requireCaller(c)` returns `{ userId, principal }`, and `requireScope(caller, demand)` throws 403. Imported from `@repo/auth/caller`. The principal kinds are `{ kind: "user" }` and `{ kind: "apiKey", keyId, statements }`. |
| Session mocking (Q4, defaulted) | `enableSessionForAPIKeys: false` in both modes, so `requireSession` never accepts a key. |
| Vocabulary check (Q6, defaulted) | The user-mode guard checks every create against `API_KEY_SCOPES`, with or without a session. |
| Vocabulary seed (Q13, defaulted) | `API_KEY_SCOPES` ships as an empty map, with Mindaloy's shape (`{ cards: ["read", "write"], reviews: ["read", "write"] }`) in a comment. A scoped create gets 403 until the project edits the file. |
| Deleting a user (Q11, asked) | `api_keys.user_id` references `users.id` with `onDelete: "cascade"`, so a deleted account leaves no live credential. |
| Key screen (Q5, defaulted) | None in this issue. `authClient.apiKey.create`, `list` and `delete` cover the flow. |
| Skill layout (Q12, defaulted) | One `saasaloy-api-keys` skill in the core covers both modes. The owner modules ship no skill. |
| Existing-project move (Q8, asked) | Two CLI fixes, then a breaking-change note. `update` refuses with exit 2 when an installed module's new descriptor has an unmet `requiresOneOf`, and names `saasaloy add <option>`. `add` re-records an already-applied patch under the new module when the patch's current owner is a module the new one depends on. `doctor` reports an unmet `requiresOneOf`. |
| Where the CLI fixes land (Q14, asked) | A phase in this plan, in the same PR as the split. |
| CLI version gate (Q17, defaulted) | The new `api-keys` descriptor declares `requires.saasaloy` at the first CLI version that carries the Phase 2 fixes, so an older CLI refuses before `update` deletes a file. The exact range is set at rebase time from the version on `main` (0.6.0 on 2026-10-22). |
| Records (Q16, asked) | ADR 0048, the ADR 0036 amendment and the `CONTEXT.md` entries are written right after the grill, before the build, as Phase 1. |
| Changelog | `packages/cli/CHANGELOG.md` is generated by release-it from commits. The migration note is a `BREAKING CHANGE:` footer on the split commit, drafted in Phase 5 for the owner to use when committing. |
| Plan and ADR serials | Plan 0075 and ADR 0048. `origin/main` holds plans up to 0074 and ADRs up to 0047, and this branch is 169 commits behind it. |
| Package pin | The module keeps the pin this branch carries. The bump comes with the rebase onto `main`. |
| Test approach | CLI changes: Vitest beside the source in `packages/cli/src/lib/*.test.ts`, run by `pnpm --filter saasaloy test`. Module rules: an import-free `.ts` file with a `node:test` file beside it, run by `pnpm test:modules`, as `permission-rules.test.ts` does. Descriptor and schema shape: text-level `node:test` files, as `schema-version.test.ts` does. End-to-end: a `.dev` project on each driver, with `wrangler dev` and `curl`. |
| Outward actions (build-stop) | Approved: edit the #229 body, promote its label through issuekit triage, and file one `needs-planning` follow-up issue for a user-mode key screen in `app`, blocked by #227 (Q15). Not approved: commit, push, PR. |

## Approach

### The modules

- **`api-keys`** (core). `dependsOn: ["auth"]`, `requiresOneOf: ["api-keys-organization", "api-keys-user"]`, `requires.saasaloy` per Q17. It holds the shared files and patches listed in the table, and the skill.
- **`api-keys-organization`**. `dependsOn: ["api-keys", "multitenant"]`, `conflictsWith: ["api-keys-user"]`. It holds `plugins/api-key.ts` (shared options plus `references: "organization"`, the `organizationId` rename, and the member-statement guard), `resolvers/api-key.ts`, both schema variants with `tenantColumn()`, the admin route and workspace, and the `tenantResolvers` and `NAV_ITEMS` patches. Every file that does not import the new options file moves byte for byte, so an existing project's hashes still match.
- **`api-keys-user`**. `dependsOn: ["api-keys", "auth"]`, `conflictsWith: ["api-keys-organization"]`. It holds `plugins/api-key.ts` (shared options plus `references: "user"`, a `userId` rename and the vocabulary guard), `api-key-scopes.ts`, `api-key-rules.ts`, `caller.ts`, and both schema variants with `user_id`.

### The user mode

**Vocabulary.** `packages/auth/src/api-key-scopes.ts` exports `API_KEY_SCOPES`, a `Record<string, readonly string[]>` the project edits.

**Issue-time guard.** `apiKeyScopeGuard()` runs on `/api-key/create`, reads the scope with the shared `scopeOf`, and throws 403 with the `scopeDenial` message before the row is written when a pair is outside `API_KEY_SCOPES`.

**Route gate.** `requireCaller(c)` claims a bearer header first and never falls back to the cookie. A key verifies through `auth.api.verifyApiKey` inside `withAuthScope`, and every failure answers 401 `invalid api key`. A session gives `{ kind: "user" }`, and no credential gives 401. `requireScope(caller, demand)` passes a user, checks a key with `keyAllows`, and throws the `Denial` as an `HTTPException`. `auth`'s `package.json` gains a pre-declared `./caller` export, the same arrangement its `//exports` note describes for `./tenant`.

### Phase 1: records (built 2026-10-22)

Attended: the owner accepts the ADR text and the `CONTEXT.md` wording through domainkit, right after the grill.

- Write ADR 0048: the owner split, the user principal, the vocabulary ceiling, and the CLI fixes that make the split safe for an existing project.
- Amend ADR 0036 (`adr-0036-an-api-key-scope-travels-as-metadata`): in user mode the guard checks against the vocabulary, not role statements.
- `CONTEXT.md`: define the user principal and the key vocabulary, and state that the user principal is outside tenancy. Update `Principal`, `Credential resolver`, `Driver module` and `Feature module` where they name `api-keys`.

Done when: `docs/adr/0048-adr-*.md` exists with status accepted, ADR 0036 carries a dated amendment, and `grep -n "User principal" CONTEXT.md` prints the new entry.

### Phase 2: make a module split safe for an installed project (built 2026-10-22)

- `update` refuses with exit 2 when an installed module's new descriptor has an unmet `requiresOneOf`, before it plans any delete. The message names each option as `saasaloy add <option>`.
- `add` re-records an already-applied patch under the module being added when the manifest records that patch under a module the new one depends on.
- `doctor` reports an installed module whose `requiresOneOf` is unmet.
- Bump nothing in `packages/cli/package.json`. release-it owns the version.

Done when: new Vitest cases pass for each fix. One case runs `update` on a fixture where `api-keys` gains an unmet `requiresOneOf`, and it exits 2 and leaves every file on disk. One case runs `add` on a fixture where a patch is already applied under a dependency, and the manifest then records it under the new module. One case runs `doctor` and gets the unmet-requirement finding. `pnpm --filter saasaloy test` and `pnpm lint` pass.

### Phase 3: split the core from the organization owner (built 2026-10-22)

- Create `modules/api-keys-organization/` and move the organization files and patches into it.
- Extract the shared options into `api-key-options.ts` in the core, and build the organization `apiKeyPlugin()` from it.
- Change `api-keys` to `dependsOn: ["auth"]`, add `requiresOneOf` and `requires.saasaloy`, and keep the two `auth.ts` patches in it.
- Move `schema-version.test.ts` next to the schema files it guards, and point it at the descriptor that pins the package.
- Update `modules/README.md` and every test or catalog that names `api-keys` files by path.

Done when, in `.dev`:

- `saasaloy add api-keys-organization` on a fresh project installs on `database-d1` and on `database-postgres`, and `pnpm typecheck` passes.
- `db:generate` produces the same `api_keys` SQL as `api-keys` on this branch before the change.
- On a project that has the old `api-keys`, `saasaloy update` with the new registry exits 2 and changes no file. `saasaloy add api-keys-organization` then changes no file content, `.saasaloy/manifest.json` records the moved files and the `tenantResolvers` and `NAV_ITEMS` patches under `api-keys-organization`, and a second `update` exits 0 with no delete.
- `pnpm test:modules` and `pnpm lint` pass.

### Phase 4: the user owner (built 2026-10-22)

- Create `modules/api-keys-user/` with the files above.
- Add the `./caller` export to `modules/auth/files/package.json` and its `//exports` note.
- Write `api-key-rules.test.ts` and a schema test that asserts `user_id`, the cascading foreign key to `users` and `api_keys_user_id_idx` in both variants.

Done when, in a `.dev` project with only `base`, `api`, `database-d1` and `auth`, and again with `database-postgres`:

- `saasaloy add api-keys-user` installs and pulls in nothing from `multitenant`, `teams` or `admin`, and `saasaloy.json` lists `api-keys` and `api-keys-user`.
- The generated migration creates `api_keys` with `user_id` referencing `users` on delete cascade, and the index `api_keys_user_id_idx`.
- With `API_KEY_SCOPES` edited to `{ cards: ["read", "write"] }`, a signed-in user creates a key with `metadata.scope` `{ cards: ["read"] }`, and the stored `permissions` equals that map.
- A create with `{ reviews: ["read"] }` answers 403 `permission required: reviews:read`, and no row is written.
- A test route that calls `requireCaller` and `requireScope(caller, { cards: ["read"] })` returns the key's user id to a bearer request, and answers 403 for `{ cards: ["write"] }`.
- After revocation the same key answers 401 `invalid api key`, also when a valid session cookie rides along.
- Deleting the user removes the key row.
- `pnpm test:modules` and `pnpm lint` pass, and Phase 3's organization checks still pass.

### Phase 5: skill and release note (built 2026-10-22)

- `saasaloy-api-keys` covers both modes, how to pick one, the vocabulary file, `requireCaller` and `requireScope`, the switch procedure, removal, and the failure modes.
- Draft the `BREAKING CHANGE:` footer for the split commit: an existing `api-keys` project upgrades the CLI, runs `saasaloy add api-keys-organization`, then runs `saasaloy update`.

Done when: the skill names both owner modules and both gates, `pnpm lint` passes, and the footer text is in the hand-off with the exact commands.

## Migration and rollback

An existing `api-keys` project upgrades the CLI to the version from Phase 2 and runs `saasaloy add api-keys-organization`. The files keep their bytes, so `add` adopts them and moves their ownership, and it re-records the two organization patches. No table changes. If it runs `update` first, `update` refuses and names the `add` command, so no file is deleted. An older CLI refuses the new descriptor through `requires.saasaloy`. Rollback is the previous registry and CLI version, and the files on disk are unchanged.

User mode has no existing data. Switching an installed project from one owner to the other moves no keys: the skill says to revoke every key, remove one owner, and add the other. The `auth.ts` patches stay in the core across the switch.

## Open questions

None. Every decision from the grill is settled.

## Non-goals

- A key screen for user mode. A follow-up issue tracks it, blocked by #227.
- Patch `onlyWith`, a negated condition, or any CLI feature beyond Phase 2's three fixes.
- Mindaloy's `disableSignUp` change and its per-collection checks.
- Moving a project from one owner mode to the other with its keys.
- Bumping `@better-auth/api-key`.
