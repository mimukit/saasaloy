# Plan: phone number sign-in over the sms capability (`auth-phone`)

Grilled: 2026-11-04

Issue: #308. Source: `docs/plans/0096-plan-primeshopr-findings-issues-2026-11-04.md`, "Issue 3". Reference implementation: PrimeShopr at `/home/dev/projects/primeshopr` (HEAD `21139b8`, better-auth 1.7.7).

## Context

PrimeShopr wired Better Auth's `phoneNumber()` plugin to `@repo/sms` by hand across about 15 agent sessions. Most of that time went to gaps the plugin leaves open: a reset for an unknown number answers success and sends nothing, an account with no password gets a wrong-password message, a wrong reset code fails only after the new password is typed, and the send limits blocked testers under the console provider. Every project that sells to phone-first users needs the same work, so Saasaloy ships it once as a module.

The user is a Saasaloy project owner whose customers sign in with a phone number, not an email. The customer signs up with an SMS code, sets a password, signs in with phone and password, and resets the password with an SMS code.

Goal: a project gets working phone sign-in from one `saasaloy add auth-phone`, with none of the gaps PrimeShopr hit.

Target: a fresh `.dev/playground` project with `auth-phone` and `sms-console` signs up, signs in, and resets a password by phone with no vendor account, checked by one e2e spec that passes. The repo gate (`pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:modules`) passes.

## What exists and is reused

| Part | Existing code | Use |
|---|---|---|
| Better Auth instances | `modules/auth/files/src/auth.ts`: `auth` (client, `/auth`) and `adminAuth` (admin, `/admin/auth`), each with a `plugins: [...]` patch point | `plugin-array` patch into `auth` only |
| Auth route | `modules/auth/files/api/routes/auth.ts`: `authRoute` is one `/*` catch-all on `base` | Gains the `authGuards` patch point (Phase 1) |
| Plugin pattern | `modules/auth/files/src/plugins/reset-password-mail.ts` (sets options through `init()`), `plugins/audience.ts` (hooks, `APIError.from`) | Same shape for the `phoneAccount()` plugin |
| Client plugins | `modules/auth/files/src/client.ts`: `authClientPlugins = definePlugins({ plugins: [] })` | `plugin-array` patch adds `phoneNumberClient()` |
| Users columns | `drizzle-column` patch kind; `modules/billing/registry-item.json` adds `users.billingCustomerId` | Add `phone_number` and `phone_number_verified` |
| SMS send | `modules/sms/files/src/index.ts` `createSms(env)`, `templates/verification-code.ts` | Send the code; reuse the template as is |
| Console SMS | `modules/sms-console/files/console.ts` prints a framed block with `to:` and the body | The e2e helper parses this block |
| Rate limit | `modules/ratelimit/files/api/middleware/ratelimit.ts` `rateLimit({ policy, key })`, `strict` = 10 per 10 s | Password sign-in limit by address and by phone |
| Request log | `modules/api/files/src/index.ts:128` sets `c.var.log` on every request | The `auth result` lines |
| Return path | `modules/app/files/src/lib/redirect.ts` `toInternalPath()`, `resolveDestination()`, the `redirect` search param | Replaces PrimeShopr's `safeNextPath()` and `?next=` |
| Auth blocks | `modules/auth/files/ui/blocks/auth/{auth-card,sign-in,sign-up}.tsx` (`onSubmit`, no IO) | Phone blocks follow the same contract |
| App screens | `modules/app/files/src/routes/{sign-in,sign-up}.tsx` | Phone routes follow the same shape |
| Admin screens | `modules/feature-flags` drops `@admin/routes/flags.tsx` plus a `nav-entry` patch | Same shape for both SMS screens |
| Config | `packages/config` sections (ADR 0052) | `auth-phone` section for code, limit and number rules |
| E2E | `modules/e2e/files/lib/fixtures.ts` (`uniqueEmail`), `playwright.config.ts` | `uniquePhone()` and the SMS log reader |

Nothing in Saasaloy holds an `sms_messages` table today, and no module counts sends.

## Design decisions (settled)

Each row names the grill question that settled it, and whether the owner answered it (asked) or took the default (defaulted).

| Decision | Resolution |
|---|---|
| Module tier | `auth-phone` is a `saasaloy:feature`. It scaffolds no workspace. `dependsOn: ["auth", "sms", "ratelimit"]`. Stage `mvp`, `needs: []`. |
| Which instance (Q10, defaulted) | The `phoneNumber()` plugin goes on `auth` only. Admins keep email sign-in on `adminAuth`, as in PrimeShopr. |
| Flow | Sign-up proves the phone with a code (`send-otp`, then `verify`, which creates the account and a session), then the customer sets the first password. Sign-in is phone and password (`/sign-in/phone-number`). Set and reset use `request-password-reset`, `check-reset-code`, then `reset-password`. |
| `check-reset-code` | A custom endpoint in the `phoneAccount()` plugin. It reads the `<phone>-request-password-reset` verification row, keeps a right code for `reset-password`, and spends one try on a wrong code. Lifted from PrimeShopr `packages/auth/src/plugins/shopper-password.ts` L83-139. |
| Sign-up for a known number | The plugin's before hook answers 409 `PHONE_NUMBER_EXIST` on `send-otp` and `verify` for a number that has an account. |
| First user | A phone sign-up always writes role `user`, so the first-user superadmin rule in `auth.ts` applies only to an email sign-up. |
| Placeholder email | `<digits>@phone.invalid`, because `users.email` stays NOT NULL. `.invalid` is reserved (RFC 2606). `auth-phone` exports `placeholderEmail()`. |
| Send limits (Q1, asked) | Count `sms_messages` rows per phone: one code per 60 s and 5 per 3600 s, sign-up and reset in one budget. No long-window mode in `ratelimit`, because `kv-cloudflare` refuses any period other than 10 s or 60 s (`modules/kv-cloudflare/files/cloudflare.ts:41`) and a KV get-then-put counter is not atomic. The limit is off under `SMS_PROVIDER=console`. The skill records why. `ratelimit` stays a dependency for the password sign-in limit (`strict`, keyed by address and by phone). |
| `sms_messages` owner (Q2, asked) | `sms` ships `@db/schema/sms-messages.ts` (`.pg.ts` and `.sqlite.ts`), `@db/repositories/sms-messages.ts` (`logSms()`, `countSmsSince()`) and a seed slice under `when: { installed: ["database"] }`. `purpose` is free text, not an enum. `packages/sms` keeps zero runtime dependencies. Columns: `id, user_id, purpose, to_phone, template, provider, provider_ref, status, error, created_at`, no body. Indexes: `(to_phone, purpose, created_at)`, `(created_at)`. |
| Number rule (Q3, asked) | The server takes E.164 only. The `auth-phone` config section carries `allowedPrefixes: []`; an empty list allows every E.164 number. |
| Number input (Q16, asked) | The config section carries an optional `defaultCountryCode` (for example `"+880"`). When it is set, the screen turns a number with a leading `0` into E.164. When it is not set, the field asks for a number that starts with `+`. |
| Password length (Q4, asked) | Keep `auth`'s 12-character minimum for every account. No config value. A project that wants less edits `MIN_PASSWORD_LENGTH` in `auth.ts`. |
| Guard mount (Q7, asked) | `auth` gains a middleware patch point in `modules/auth/files/api/routes/auth.ts`: `export const authGuards = defineGuards({ guards: [] })`, spread ahead of the handler on `authRoute`. `auth-phone` adds its Hono middleware with a `plugin-array` patch. A second route on `/auth` cannot work, because `chained-route` appends after `auth`'s catch-all. |
| Guard scope (Q14, defaulted) | `authGuards` applies to `authRoute` only. `adminAuthRoute` gets no array now. |
| Clear results | The guard answers 404 `no_account` on a reset for an unknown number, 401 `no_account` and 401 `no_password` on sign-in, and keeps Better Auth's generic answer for a wrong password. A banned account keeps `BANNED_USER` from the `admin()` plugin, and the screen maps it to its own message. |
| Log lines (Q15, defaulted) | One `auth result` line per refusal (`no_account`, `no_password`, `rate_limited`, `send_failed`) through `c.var.log`. The phone is masked to its last 4 digits. |
| Customer screens (Q9, defaulted) | `apps/app` route files under `when: { installed: ["app"] }`. `apps/web` stays the marketing site. |
| Admin screens (Q13, asked) | Two screens with no shared file. `sms` ships `@admin/routes/sms.tsx` and its api route (the message log, provider error text through `maskCodes()`) under `when: { installed: ["admin", "database"] }`. `auth-phone` ships `@admin/routes/login-codes.tsx` and its api route (state and tries left from `verifications`) under `when: { installed: ["admin"] }`. Each has its own `nav-entry` row. |
| Code reveal (Q8, asked) | No admin reveal in this issue. The login codes screen never shows a code. A follow-up issue adds the reveal after #310's audit log lands. |
| #294 overlap (Q5, asked) | `admin` holds a pure `contactOf()` helper with the `.invalid` rule and no import from `auth-phone`. This plan ships it into `@admin/lib/contact.ts` if #294 has not landed, and the `auth-phone` login codes screen uses it. #294 then uses the same file for the other screens. |
| #230 overlap (Q6, asked) | `auth-phone` ships `@ui/blocks/auth/new-password.tsx` with no phone words, and #230 reuses it for the email reset. |
| E2E api log (Q12, defaulted) | `e2e`'s `playwright.config.ts` writes the api dev server output to `packages/e2e/logs/api.log` for every project. #303 uses the same log. |
| Admin-made phone accounts (Q11, defaulted) | Out of scope. |
| Tests (Q19, defaulted) | Route tests are Vitest `.vitest.ts` files gated `when: { testing: true }`, beside `auth`'s own route tests. Pure helpers (`maskPhone`, `maskCodes`, `loginCodeRefusal`, `toE164`, the e2e log parser) take `node --test` tests under `modules/*/files/**/*.test.ts`, run by `pnpm test:modules`. The journey is a Playwright spec gated `when: { installed: ["e2e"] }`. |
| Visual reference (Q18, asked) | The owner approved the PrimeShopr screens as the visual reference on 2026-11-04, in place of a mockup round (round 0). Reference files: `apps/web/src/components/auth-flow.tsx`, `packages/ui/src/blocks/auth-verify.tsx`, `auth-phone.tsx`, `auth-password-login.tsx`, `auth-password.tsx`, and `apps/admin/src/routes/messages.tsx` in PrimeShopr. The build adapts them to `AuthCard` and the shell primitives, and drops the Bangladesh formatting and the PrimeShopr onboarding steps. A layout change beyond that adaptation goes back through a mockup round. |
| UI house rules | Phone blocks use the shell primitives (`@repo/ui/components/shell/*`) and `AuthCard`, take `onSubmit` and do no IO. Admin pages follow the admin page frame rules in `create-module` Step 3: `PageHeader`, `DataTable` in `PageLayout`, no `<main>` or `h1`. |
| Outward actions (Q17, asked) | Approved: a comment on #230 (Q6), a comment on #294 (Q5), and one follow-up issue for the admin code reveal (Q8). They run after the grill, before the `ready` label. |

## Approach

Lift PrimeShopr's server half nearly as is, behind a config section for the numbers and the number rule, and rebuild the screens on Saasaloy's `app` and `admin` conventions. Two small changes land in other modules first: the `authGuards` patch point in `auth`, and the `sms_messages` log in `sms`.

Rejected alternatives:

- Minimal: the plugin wiring and the guards only, no screens. The acceptance needs a person to sign up in a browser, and the screens hold half of PrimeShopr's fixes (code input guards, the no-password path to reset).
- Lateral: passwordless sign-in by code only. PrimeShopr ran that first and moved to phone and password in its plan 0027, because every sign-in cost an SMS.

### Phase 1: `auth` guard point and the `sms` message log (built 2026-11-05)

- Add `authGuards` to `modules/auth/files/api/routes/auth.ts` and spread its `guards` ahead of the handler on `authRoute`. Update the `saasaloy-auth` skill.
- Add the `sms_messages` schema (both dialects), repository, and seed slice to `modules/sms`, under `when: { installed: ["database"] }`.
- Add `maskCodes()` (4 to 8 digit runs, lifted from PrimeShopr `apps/api/src/lib/mask-code.ts`) with its `node --test` test.
- Add the `sms` admin log screen and its api route under `when: { installed: ["admin", "database"] }`, with a `nav-entry` patch.
- Update the `saasaloy-sms` skill: the log table, `logSms()`, the admin screen.

Done when: `pnpm test` passes `scripts/table-names.test.ts` and `scripts/seed-slices.test.ts` with the new table, `pnpm test:modules` passes the `maskCodes` test, `saasaloy doctor modules/sms` and `saasaloy doctor modules/auth` report no findings, and the existing `auth` route tests still pass in a playground.

### Phase 2: `auth-phone` skeleton, schema and plugin (built 2026-11-05)

- Run `saasaloy new module auth-phone --type saasaloy:feature --depends-on auth,sms,ratelimit`.
- Add `users.phone_number` (text, unique, nullable) and `users.phone_number_verified` (boolean, not null, default false) with `drizzle-column` patches, one per dialect under `when: { installed: [...] }`.
- Ship `@auth/phone.ts` (`placeholderEmail`, `toE164`, `isAllowedPhone`, `sendLoginCode` with `logSms()`, the path constants) and `@auth/plugins/phone-account.ts` (`phoneAccount()`: the 409 hook, `check-reset-code`, verify-on-reset, the role hook).
- Patch `auth`'s `plugins` with `phoneNumber({...})` and `phoneAccount()`, and `authClientPlugins` with `phoneNumberClient()`.
- Add the `auth-phone` config section: code length 6, life 300 s, 3 tries, resend wait 60 s, 5 codes per hour, `allowedPrefixes: []`, optional `defaultCountryCode`.
- Seed one phone account with a password and one without.

Done when: `saasaloy doctor modules/auth-phone` reports no findings, `pnpm test` passes `scripts/table-names.test.ts`, `scripts/seed-slices.test.ts` and `scripts/env-presets.test.ts`, and `pnpm db:generate` in a playground with the module writes one migration with both columns.

### Phase 3: guards, results and limits (built 2026-11-05)

- Ship `@api/middleware/auth-phone.ts` and register it in `authGuards`. It acts on `/phone-number/send-otp`, `/phone-number/request-password-reset` and `/sign-in/phone-number`, and calls `next()` on every other path.
- Send limits from `countSmsSince()`, refused with 429 `rate_limited` and `Retry-After`, skipped under `console`.
- Password sign-in: `rateLimit({ policy: "strict" })` keyed by address, and a second one keyed by phone.
- Results: `no_account`, `no_password`, the banned code pass-through, and the masked `auth result` lines.
- Route tests lifted from PrimeShopr `shopper-login.test.ts`, `auth.test.ts` and `accounts.test.ts`, minus the PrimeShopr cases (orders claim, profile, Bangladesh numbers).

Done when: the route tests pass in a playground with `testing: tests-after`, and each of these has a passing test: a 6th code in an hour answers 429, a resend inside 60 s answers 429, both pass under `console`, a reset for an unknown number answers 404 `no_account` with no SMS, sign-in with no password answers 401 `no_password`, a wrong `check-reset-code` spends one try, a number outside `allowedPrefixes` answers 400, and no log line holds a full phone number.

### Phase 4: app screens (built 2026-11-05)

- Ship presentational blocks under `@ui/blocks/auth/`: `phone-sign-in.tsx`, `phone-sign-up.tsx`, `code-input.tsx` (6 digits, numeric, `autocomplete="one-time-code"`, a submit guard for fewer than 6 digits, error hidden on edit, resend countdown), `new-password.tsx` (no phone words, for #230 too), `phone-reset.tsx`.
- Ship `apps/app` route files under `when: { installed: ["app"] }` for sign-in, sign-up and reset by phone. The return path goes through `toInternalPath()` and `resolveDestination()`. One request runs at a time, and a late session check never replaces a step the customer already moved to.
- The skill's `## Wire-up` section names how the owner swaps the email routes for the phone routes.

Done when: in the playground, with `pnpm dev` up, a person signs up, signs out, signs in, and resets a password by phone with the console codes, and each alert (`no_account`, `no_password` with its reset link, banned, rate limited) shows for its case.

### Phase 5: admin login codes screen (built 2026-11-05)

- Ship `@admin/routes/login-codes.tsx` under `when: { installed: ["admin"] }` with a `nav-entry` patch, and its api route.
- Read `verifications` for the last 30 minutes. Show the phone, the purpose, the state (`live`, `expired`, `ended`) and the tries left. Never show the code.
- Ship `@admin/lib/contact.ts` (`contactOf()`) when #294 has not landed, and name a phone account by its phone.

Done when: an admin in the playground opens the login codes screen and the SMS log screen, sees the codes the Phase 4 flows sent, and no row shows a code or a raw digit run from an error.

### Phase 6: e2e helper and journey spec (built 2026-11-05)

- Change `modules/e2e/files/playwright.config.ts` so the api dev server writes its output to `packages/e2e/logs/api.log`, and gitignore the folder.
- Ship `@e2e/lib/sms.ts` under `when: { installed: ["e2e"] }`: `uniquePhone()`, `smsMark()`, `smsCode(phone, mark)`, which parse the console provider's framed block from that log.
- Ship `@e2e/specs/auth-phone-journey.spec.ts`: sign-up, sign-out, sign-in, reset, sign-in with the new password.

Done when: `pnpm test:e2e` in a fresh playground with `auth-phone`, `sms-console`, `app` and `e2e` passes the journey spec with no vendor account. This is the plan's target.

### Phase 7: skill and docs (built 2026-11-05)

- Write `modules/auth-phone/skills/saasaloy-auth-phone/SKILL.md`: the flow, the endpoints and their results, the limits and why they count rows, the config section, the number rule, the `## Wire-up` section, the never-console-in-production rule, and the Better Auth facts from PrimeShopr plan 0041 (the code is stored before the send, the `<code>:<tries>` value, a wrong try recreates the row).
- Add `auth-phone` to `modules/README.md` and to the `llms.txt` module list.

Done when: `saasaloy doctor modules/auth-phone` reports no findings and the repo gate passes.

## Migration and rollback

The plan adds two nullable or defaulted columns to `users` and one new table, `sms_messages`, so existing rows need no backfill. `pnpm db:generate` writes the migration in the project, in Phases 1 and 2. `saasaloy remove auth-phone` reverses the `drizzle-column` and `plugin-array` patches, and the project then generates a migration that drops the two columns. `sms_messages` stays while `sms` and `database` are installed. Phone accounts lose their sign-in path on remove, and the skill states this.

## Open questions

None. The grill on 2026-11-04 settled Q1 to Q19.

## Non-goals

- Phone sign-in on the admin instance.
- An admin code reveal (follow-up after #310).
- PrimeShopr's product hooks: customer profiles, the welcome notification, the orders claim, the onboarding details step.
- Admin-made phone accounts.
- Any vendor SMS provider. `sms-khudebarta` exists already; others are separate provider modules.
- Phone number change for a signed-in account (`updatePhoneNumber`).
- A long-window mode in `ratelimit`.
- The email reset screens (#230) and the placeholder fix on every admin screen (#294), beyond the shared `new-password.tsx` block and `contactOf()` helper.

## Build notes

Written on 2026-11-05, after the build. These notes record where the build differs from the phase text above. No settled decision changed.

- Phase 2: the first-user rule lives in `modules/auth/files/src/auth.ts`, not in `phoneAccount()`. The instance's own `databaseHooks` run after every plugin hook in better-auth 1.7.7, so a plugin cannot keep role `user`. The superadmin hook skips the `/phone-number/verify` path.
- Phase 2: `auth`'s seed slices gained `extraUsers` and `extraAccounts` patch points for the two seeded phone accounts.
- Phase 4: `phoneAccount()` adds `POST /phone-number/set-password` for the first password after a code sign-up, because Better Auth's `setPassword` is server-only. `app` gained an `AUTH_SCREENS` patch point, and its `typecheck` runs `tsr generate` first, as `admin` does. `api` exposes `Retry-After` through CORS.
- Phase 4: the rate-limit alert is not checked in a browser. The limits are off under `SMS_PROVIDER=console`, and no second provider is installed. The 429 answer and its words have route and unit tests.
- Phase 5: #294 had not landed, so `auth-phone` ships `apps/admin/src/lib/contact.ts`.
- Phase 6: the e2e command is `pnpm e2e`, not `pnpm test:e2e`. `e2e` gained `E2E_<APP>_PORT` overrides and `lib/tee-log.ts`. A new project runs `pnpm --filter @repo/db db:generate` before the first `pnpm e2e`.
- Target check: a fresh `.dev/playground` with `auth-phone`, `sms-console`, `app`, `e2e`, `database-d1` and `kv-memory` passed `pnpm e2e` (2 passed: the phone journey and health).
