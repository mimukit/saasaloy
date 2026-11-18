# Plan: move three env keys and two leaf tunables into config sections

Grilled: 2026-11-18

## Context

Issue [#162](https://github.com/mimukit/saasaloy/issues/162), the follow-up that plan 0059 and ADR 0052 left open. #154 moved the duplicated values into `config`. It left values that live in one place but in the wrong place: env keys that cannot differ between two deployments of one project, and literals inside the file that reads them.

The issue listed four env keys and seven tunables. The grill on 2026-11-18 cut that list against the code:

- `BILLING_APP_NAME` is already gone from `envVars`, and `doctor` already reports it (`packages/cli/src/lib/doctor.ts`, `DEPRECATED_APP_NAME`). Only its doctor row moves.
- After #211 the lockout key is `SUBSCRIPTION_LOCKOUT_DAYS`. The env key and the "lockout default" tunable are one number, so they become one leaf.
- The lockout cron stays a literal. A config cron would pass `typecheck` and then throw on every tick.
- The three ratelimit policies stay in `packages/kv/src/policies/ratelimit.ts`. On `kv-cloudflare` the numbers that apply live in `apps/api/wrangler.jsonc`, so a config leaf would change nothing on the default provider.
- `MAX_EXPIRY_DAYS = 365` now lives in `modules/api-keys-organization/files/admin/components/api-key-workspace.tsx`. The server ceiling is Better Auth's default `keyExpiration.maxExpiresIn` (365 days), set nowhere in our code.

Goal: three env keys and two tunables become section leaves, and an older project that still sets a retired key learns it from `doctor` and from an update note. Done when the acceptance check in Phase 4 passes.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Lockout (Q1, asked) | One leaf, `config.subscription.lockoutDays = 14`, in `modules/subscription/files/config/subscription.ts`. `packages/subscription` reads it directly. `setSubscriptionConfig`, `subscriptionConfig()`, `readLockoutDays`, `SubscriptionConfigValues` and the env read in `apps/api/src/subscription-store.ts` go away. `src/config.ts` and `src/config.test.ts` go away if nothing else remains in them. `SUBSCRIPTION_LOCKOUT_DAYS` leaves `envVars`, `envOptional` and `src/env-preset.ts`. |
| Lockout cron (Q2, asked) | Stays the literal `SUBSCRIPTION_PAST_DUE_LOCKOUT_CRON`. Rewrite its comment to say why it is not a config leaf: a bad override passes `typecheck` and throws on every tick, and no owner needs to move a daily sweep. |
| Ratelimit policies (Q3, asked) | Out of scope. No section. See Non-goals. |
| `BILLING_APP_NAME` doctor check (Q4, asked) | Kept, as one row of the retired-key table. |
| An old env value after the update (Q5, defaulted) | The code ignores it. No runtime fallback and no runtime warning. `doctor` reports it, and the module's update note says to move the value to `packages/config/src/project.ts`. |
| API key expiry (Q6, defaulted) | New `api-keys` section: `config["api-keys"].maxExpiryDays = 365`. `modules/api-keys/files/auth/plugins/api-key-options.ts` sets `keyExpiration.maxExpiresIn` from it, and the `api-keys-organization` workspace reads it for the form `max` and the hint text. The value stays 365, so behaviour does not change. |
| Admin users page size (Q7, defaulted) | New `admin` section: `config.admin.userListLimit = 100`. `modules/admin/files/api/routes/admin-users.ts` uses it for both `.max()` and `.default()`. |
| Leaf names (Q8, defaulted) | `config.subscription.lockoutDays`, `config["feature-flags"].isolateTtlSeconds = 10`, `config.storage.maxUploadBytes = 104_857_600`, `config["api-keys"].maxExpiryDays`, `config.admin.userListLimit`. The key is the module name (ADR 0052). A hyphenated key uses the bracket form, as `auth-phone` does. |
| Comment on each leaf | Each leaf carries a doc comment that says what a change costs: more KV reads, a longer wait for a toggle, a larger body through the Worker, a longer-lived bearer credential, a heavier admin query, and so on. |
| Readers of the upload limit | `storage` reads `config.storage.maxUploadBytes` in place of `resolveMaxUploadBytes(env)`. `client.maxUploadBytes` stays on the storage client, so `file-uploads` keeps reading it there. The browser copies of the default in `modules/file-uploads/files/ui/blocks/file-uploads.tsx` and `modules/cms/files/admin/components/cms/media-picker.tsx` read the leaf in place of their own literal, and every comment that names `STORAGE_MAX_UPLOAD_BYTES` names the leaf. |
| Reader of the flag TTL | `modules/feature-flags/files/src/define.ts` reads `config["feature-flags"].isolateTtlSeconds` in place of `env.FLAGS_ISOLATE_TTL_SECONDS`. `0` still skips the isolate cache. `DEFAULT_ISOLATE_TTL_SECONDS` and the env parse go away. |
| Validation | `typecheck` only, per ADR 0052. The env parsers that guarded a non-numeric string (`readLockoutDays`, `resolveMaxUploadBytes`, `isolateTtlSeconds`) go away with the env keys. |
| Release note (Q9, defaulted) | One update note for each module that retires a key, in `modules/<name>/update-notes/` with the next serial: `subscription`, `feature-flags`, `storage`. Each uses the four sections of plan 0093 and names the env key, the leaf, and the `project.ts` override that keeps a custom value. `api-keys` and `admin` change no behaviour and get no note. |
| `doctor` shape (Q10, defaulted) | `checkConfigValues` reads one table of retired key → owning module → replacement leaf, with four rows: `BILLING_APP_NAME`, `SUBSCRIPTION_LOCKOUT_DAYS`, `FLAGS_ISOLATE_TTL_SECONDS`, `STORAGE_MAX_UPLOAD_BYTES`. The existing rule stays: report `packages/env/.env` when it sets the key, otherwise each service `.env` that does. Each finding names the leaf and `packages/config/src/project.ts`. |
| `<CAP>_PROVIDER` keys | Untouched (ADR 0033). |
| Ratelimit follow-up (Q11, asked) | No follow-up issue. |
| Where this grill lands (Q12, asked) | This plan, committed to `main`. The #162 body links it. |
| Outward actions (Q13, asked) | afkkit may commit on `issue-162-move-the-four-misplaced-env-keys-and-the-seven`, push it to `origin`, and open one PR. No merge. |
| Test approach (Q14, defaulted) | Vitest beside the source, no new runner. `packages/cli/src/lib/doctor.test.ts` covers the four table rows. `past-due-lockout.test.ts`, the storage and feature-flags `define.test.ts` files read the leaves through `scripts/config-shim.ts`. `scripts/env-presets.test.ts` keeps each preset equal to its `envVars`. |
| Attended phases (Q15, defaulted) | None. No visible UI change: the api-keys form still shows 365, and the upload pickers show the same 100 MiB. |
| Issue title (Q16, defaulted) | Retitle #162 to `refactor(config): move three env keys and two leaf tunables into sections`. |

## Approach

### Phase 1: the retired-key table and the lockout leaf

- `packages/cli/src/lib/doctor.ts`: replace `DEPRECATED_APP_NAME` with the retired-key table and loop over it in `checkConfigValues`. Update the `commands/doctor.ts` comment that describes the check.
- `modules/subscription`: add `lockoutDays` to the section, make the job read it, remove the port and the env key as the Design decisions say. Update `src/index.ts` exports, `registry-item.json`, `src/env-preset.ts`, the skill, and the comments in `subscription-store.ts`, `provider.ts`, `subscription.ts`, the routes, the schemas and the `payment-failed` template that name the key.
- Rewrite the cron comment in `src/jobs/past-due-lockout.ts`.
- Add `modules/subscription/update-notes/0001-lockout-days-in-config.md`.

Done when: `doctor.test.ts` passes with one case for each of the four keys, `past-due-lockout.test.ts` passes on the leaf, and `grep -r SUBSCRIPTION_LOCKOUT_DAYS modules packages/cli/src` finds only the doctor table, its test and the update note.

### Phase 2: the flag TTL and the upload limit

- `modules/feature-flags`: new section file `files/config/feature-flags.ts` with its `plugin-array` patch, the reader change in `src/define.ts` and `src/cache.ts`, the key out of `envVars` and `src/env-preset.ts`, the skill, and `update-notes/0002-isolate-ttl-in-config.md`.
- `modules/storage`: new section file `files/config/storage.ts` with its patch, the reader change in `src/define.ts`, the key out of `envVars`, `src/env-preset.ts` and `src/provider.ts` comments, the skill, and `update-notes/0001-max-upload-bytes-in-config.md`.
- `modules/file-uploads` and `modules/cms`: the browser copies and comments read or name the leaf.
- `modules/README.md`: drop the three keys from the env tables.

Done when: the storage and feature-flags tests pass on the leaves, and `grep -r "FLAGS_ISOLATE_TTL_SECONDS\|STORAGE_MAX_UPLOAD_BYTES" modules packages/cli/src` finds only the doctor table, its test and the update notes.

### Phase 3: the two leaf tunables

- `modules/api-keys`: new section file `files/config/api-keys.ts` with its patch. `api-key-options.ts` sets `keyExpiration.maxExpiresIn`.
- `modules/api-keys-organization`: the workspace reads `config["api-keys"].maxExpiryDays`.
- `modules/admin`: new section file `files/config/admin.ts` with its patch. `admin-users.ts` uses `config.admin.userListLimit` for `max` and `default`.

Done when: `pnpm typecheck` passes and no `365` or page-size `100` literal remains at those call sites.

### Phase 4: the acceptance check

- `pnpm lint`, `pnpm typecheck` and `pnpm test` pass.
- In `.dev`, scaffold a project with `subscription`, `feature-flags`, `storage`, `file-uploads`, `cms`, `api-keys`, `api-keys-organization` and `admin`. `saasaloy add` refuses no section key, the project typechecks, and the api and admin dev servers boot.
- In the same project, set `STORAGE_MAX_UPLOAD_BYTES=1` in `packages/env/.env`. `saasaloy doctor` reports it and names `config.storage.maxUploadBytes`.

Done when: every item above holds, and the PR body records the commands and their results.

## Non-goals

- The ratelimit policies. On `kv-cloudflare` the numbers that apply live in `apps/api/wrangler.jsonc`, which cannot read a TS section, so a leaf would change only `kv-memory`. The existing comment in the policies file warns about the two copies. No follow-up issue.
- The lockout cron. It stays a literal.
- Issue #216's scope in `subscription`: `PlanConfig.price` and `renewal`.
- The dev origins and the port trio, a runtime override channel, schema validation, and a `saasaloy config` command. All four stay non-goals of ADR 0052.

## Open questions

None. The grill on 2026-11-18 settled every question. See the Q rows in Design decisions.
