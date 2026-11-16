---
name: saasaloy-auth-phone
description: Runbook for the auth-phone module, phone number sign-up, sign-in and password reset by SMS code on Better Auth's client instance. Use when wiring phone sign-in, changing the code length, life, tries or the allowed number prefixes in the auth-phone config section, reading a login code from the console provider, or debugging send-otp, verify, check-reset-code or reset-password.
---

# auth-phone: phone sign-in by SMS code

`auth-phone` is a **feature module** (`saasaloy:feature`). It depends on auth, sms and ratelimit, which `add` resolves and installs first.

A customer signs up by phone with an SMS code, sets a password, signs in with phone and password, and resets the password with an SMS code. Admins keep email sign-in: the plugins go on `auth` only, never on `adminAuth`.

## What it installs

| File | Lands at |
| --- | --- |
| `files/auth/phone-rules.ts` | `packages/auth/src/phone-rules.ts`, the import-free number rules (`toE164`, `isAllowedPhone`, `placeholderEmail`, the path constants), at `@repo/auth/phone-rules` |
| `files/auth/phone.ts` | `packages/auth/src/phone.ts`, `sendLoginCode()` and the rules again, at `@repo/auth/phone` |
| `files/auth/plugins/phone-number.ts` | `packages/auth/src/plugins/phone-number.ts`, Better Auth's `phoneNumber()` with this project's options |
| `files/auth/plugins/phone-account.ts` | `packages/auth/src/plugins/phone-account.ts`, the 409 hook, `check-reset-code` and verify on reset |
| `files/config/auth-phone.ts` | `packages/config/src/sections/auth-phone.ts`, read as `config["auth-phone"]` |
| `files/db/seed/phone-accounts.ts` | `packages/db/src/seed/phone-accounts.ts`, two seeded phone accounts |
| `files/db/repositories/phone-logins.ts` | `packages/db/src/repositories/phone-logins.ts`, `findPhoneLogin()` and `hasPassword()` |
| `files/api/middleware/auth-phone.ts` | `apps/api/src/middleware/auth-phone.ts`, `phoneSendGuard()` and `phoneSignInGuard()` in `authGuards` |
| `files/api/middleware/auth-phone-rules.ts` | `apps/api/src/middleware/auth-phone-rules.ts`, the import-free send limit and `maskPhone()` |
| `files/api/routes/auth-phone.vitest.ts` | `apps/api/src/routes/auth-phone.test.ts`, with testing on |
| `files/api/routes/auth-phone-guards.vitest.ts` | `apps/api/src/routes/auth-phone-guards.test.ts`, with testing on |
| `files/ui/blocks/auth/phone-sign-in.tsx` | `packages/ui/src/blocks/auth/phone-sign-in.tsx`, `PhoneSignInCard` and the shared `PhoneAlert`, `PhoneAlertLine`, `usePhoneSubmit`, `PhoneNumberField`, with `shell` |
| `files/ui/blocks/auth/phone-sign-up.tsx` | `packages/ui/src/blocks/auth/phone-sign-up.tsx`, `PhoneSignUpCard`, the number step of a sign-up, with `shell` |
| `files/ui/blocks/auth/phone-reset.tsx` | `packages/ui/src/blocks/auth/phone-reset.tsx`, `PhoneResetCard`, the number step of a set or a reset, with `shell` |
| `files/ui/blocks/auth/code-input.tsx` | `packages/ui/src/blocks/auth/code-input.tsx`, `CodeInputCard`, the code field and the resend countdown, with `shell` |
| `files/ui/blocks/auth/new-password.tsx` | `packages/ui/src/blocks/auth/new-password.tsx`, `NewPasswordCard`, with no phone words, so an email reset can render it, with `shell` |
| `files/app/lib/phone-auth.ts` | `apps/app/src/lib/phone-auth.ts`, the call wrapper, the alerts and the one-request gate the phone routes share, with `app` |
| `files/app/lib/phone-results.ts` | `apps/app/src/lib/phone-results.ts`, the import-free map from an answer to its words, with `app` |
| `files/app/routes/phone/sign-in.tsx`, `sign-up.tsx`, `reset.tsx` | `apps/app/src/routes/phone/`, the routes `/phone/sign-in`, `/phone/sign-up` and `/phone/reset`, with `app` |
| `files/db/repositories/login-code-rules.ts` | `packages/db/src/repositories/login-code-rules.ts`, the import-free reading of a `verifications` row (purpose, identifier, tries, state), with `admin` |
| `files/db/repositories/login-codes.ts` | `packages/db/src/repositories/login-codes.ts`, `listLoginCodes()`, the codes of the last 30 minutes with their state, with `admin` |
| `files/api/routes/admin-login-codes.ts` | `apps/api/src/routes/admin-login-codes.ts`, `GET /admin/login-codes`, admin only, with `admin` |
| `files/api/routes/admin-login-codes.vitest.ts` | `apps/api/src/routes/admin-login-codes.test.ts`, with testing on and `admin` |
| `files/admin/lib/contact.ts` | `apps/admin/src/lib/contact.ts`, `contactOf()`, which names a phone account by its phone and not its placeholder email, with `admin` |
| `files/admin/routes/login-codes.tsx` | `apps/admin/src/routes/login-codes.tsx`, the login codes screen at `/login-codes`, with `admin` |
| `files/e2e/lib/sms-log.ts` | `packages/e2e/lib/sms-log.ts`, the import-free reader of the console provider's printed blocks, with `e2e` |
| `files/e2e/lib/sms.ts` | `packages/e2e/lib/sms.ts`, `uniquePhone()`, `smsMark()` and `smsCode()`, with `e2e` |
| `files/e2e/specs/auth-phone-journey.spec.ts` | `packages/e2e/specs/auth-phone-journey.spec.ts`, the phone account journey, with `e2e` |

It also adds `users.phone_number` and `users.phone_number_verified` to `packages/db/src/schema/auth.ts`. Run `pnpm --filter @repo/db db:generate` after `add`.

With `app` installed, it adds the three phone paths to `AUTH_SCREENS` in `apps/app/src/lib/redirect.ts` with `const-array` patches, so the root guard lets an anonymous visitor open them and `resolveDestination()` never returns to one. `apps/app`'s `typecheck` script runs `tsr generate` first, so the committed `src/routeTree.gen.ts` picks up the new route files. `pnpm dev` and `pnpm build` rewrite it too.

## The flow

Every path below sits under `/auth`, on the client instance.

1. Sign-up: `POST /phone-number/send-otp` with `{ phoneNumber }`, then `POST /phone-number/verify` with `{ phoneNumber, code }`. `verify` creates the account with the placeholder email `<digits>@phone.invalid`, role `user` and `phone_number_verified` true, and opens a session. A number that has an account answers 409 `PHONE_NUMBER_EXIST` on both calls.
2. First password: `POST /phone-number/set-password` with `{ newPassword }`, on the session `verify` opened.
3. Sign-in: `POST /sign-in/phone-number` with `{ phoneNumber, password }`.
4. Set or reset: `POST /phone-number/request-password-reset` with `{ phoneNumber }`, then `POST /phone-number/check-reset-code` with `{ phoneNumber, otp }`, then `POST /phone-number/reset-password` with `{ phoneNumber, otp, newPassword }`. `check-reset-code` exists because Better Auth checks a reset code only together with the new password. It keeps a right code for `reset-password` and spends one try on a wrong one. `reset-password` also sets a first password, and it marks the phone verified.

A phone sign-up never becomes the superadmin. The first-user rule in `packages/auth/src/auth.ts` skips the `/phone-number/verify` path, so only an email sign-up can take that role.

## Better Auth facts this module depends on

These hold on better-auth 1.7.7. Check them again after a Better Auth upgrade, because `check-reset-code` and the login codes screen read the rows directly.

- Better Auth writes the code to `verifications` before it calls the sender. A failed send leaves a live row and a `failed` `sms_messages` row.
- The row value is `<code>:<wrong tries>`. A wrong try deletes the row and writes it again with the same code and expiry and one more try.
- A right code deletes every row for its identifier.
- Every lookup deletes every expired row in the table.
- Without the `no_account` guard, a reset for an unknown number answers success, writes a row, and sends nothing. The guard is what stops a customer from waiting for a code that never comes.

## Admin login codes screen

With `admin` installed, `auth-phone` mounts `GET /admin/login-codes` with a `chained-route` patch and adds a "Login codes" row under "SMS" in the admin nav with a `nav-entry` patch. The screen lists every `login_code` SMS of the last 30 minutes, newest first: the phone, the account it belongs to, the purpose, the state, the tries left, the send result, and the send error through `maskCodes()`.

The state comes from Better Auth's `verifications` row for the code. A sign-up code sits under the identifier `<phone>`, a reset code under `<phone>-request-password-reset`, and the value is `<code>:<wrong tries>`. A request is `live` when it is the newest for its identifier and its row has tries left before `expiresAt`. A gone code is `ended` inside `codeTtlSeconds` (used, out of tries, or replaced by a newer code) and `expired` after it.

The screen never shows a code, and the api answer holds none: `parseLoginCodeValue()` reads the tries and drops the digits. A reveal for support waits on the admin audit log (#310) and is a follow-up issue. Do not add a code field to the route.

`apps/admin/src/lib/contact.ts` belongs to `admin` once issue #294 lands. Until then `auth-phone` ships it. It imports nothing from `auth-phone`, because `admin` can be installed without it. Use `contactOf(email)` wherever a screen names an account.

## E2E journey

With `e2e` installed, `auth-phone` ships one Playwright spec, `specs/auth-phone-journey.spec.ts`, tagged `@app`, `@auth-phone` and `@sms-console`, so it is collected only when all three modules are installed. It signs up a new number with the code, sets the first password, signs out, signs in, signs out, resets the password with a code, and checks that the old password is refused and the new one signs in. `pnpm e2e` runs it with the rest of the suite.

The codes come from the api's log, not from a test-only provider. The `e2e` module writes the api dev server's output to `packages/e2e/logs/api.log`, and `smsCode(phone, mark)` reads the newest code sent to the number after `mark`, the log size `smsMark()` took before the send. `smsMark()` throws unless `apps/api/.env` sets `SMS_PROVIDER=console`, so the spec never texts a real handset. A reused api writes no log: see "The api log" in the `saasaloy-e2e` skill.

`uniquePhone()` returns `+1202555` and four digits from the clock, never `0100` to `0199`, where the seed numbers live. Every number the suite made stays in a kept dev database, so two runs collide only when they start a multiple of 9,800 seconds apart. `pnpm db:drop` clears them. A project whose `allowedPrefixes` leaves out `+1` changes `uniquePhone()` to its own range.

## Settings

The module declares no env keys. `sms` needs `SMS_PROVIDER`; use `console` in development, never in a deployed environment, because the console provider prints every code to the log.

The `auth-phone` config section holds `codeLength`, `codeTtlSeconds`, `codeAttempts`, `resendSeconds`, `codesPerHour`, `allowedPrefixes` and `defaultCountryCode`. Change them in `packages/config/src/project.ts`.

## Guards and results

Two guards run ahead of Better Auth on `/auth`, through `authGuards` in `apps/api/src/routes/auth.ts`. Each acts on its own POST paths and calls `next()` on every other path.

| Path | Answer |
| --- | --- |
| `/phone-number/send-otp`, `/phone-number/request-password-reset` | 429 `rate_limited` with `Retry-After` for a second code inside `resendSeconds`, or past `codesPerHour` in an hour. Sign-up and reset codes share one budget. |
| `/phone-number/request-password-reset` | 404 `no_account` for a number with no account. No code is stored and no SMS goes out. |
| `/sign-in/phone-number` | 429 `rate_limited` from the `strict` policy, once per client address and once per number. Then 401 `no_account` or 401 `no_password`. A wrong password keeps Better Auth's `INVALID_PHONE_NUMBER_OR_PASSWORD`, and a banned account keeps `BANNED_USER`. |

`phoneAccount()` adds one endpoint of its own beside `check-reset-code`. `POST /auth/phone-number/set-password` with `{ newPassword }` gives the signed-in account its first password. It is the sign-up step after `verify`, which opens a session on an account with no password. Better Auth's own `setPassword` is server-only, so the browser has no other way to it. It needs a fresh session (Better Auth's `sensitiveSessionMiddleware`) and answers 401 without one, 400 `PASSWORD_TOO_SHORT` under 12 characters, and 409 `PASSWORD_ALREADY_SET` for an account that has one. The client calls it with `auth.$fetch("/phone-number/set-password", { method: "POST", body })`.

A number that fails `isAllowedPhone` goes on to Better Auth, which answers its own 400 `INVALID_PHONE_NUMBER`.

The send limits count `sms_messages` rows with `countSmsSince()`, failed sends included. They do not use `ratelimit`, because `kv-cloudflare` counts in 10 s or 60 s windows only and an hour needs more. They are off under `SMS_PROVIDER=console`, where a send costs nothing and a limit only blocks a tester.

Each refusal writes one `auth result` line through `c.var.log`: `no_account`, `no_password`, `rate_limited`, or `send_failed` when a send answers 5xx. The line holds the path and the phone masked to its last 4 digits, never the full number.

## Wire-up

`add` ships the screens but links none of them. `/sign-in` and `/sign-up` in `apps/app` stay the email screens, and nothing on them points at the phone ones. Pick one of the two set-ups below.

**Phone beside email.** Link the phone screens from the email ones. In `apps/app/src/routes/sign-in.tsx`, render a link under the card. The anchor text below is a suggestion:

```tsx
import { AUTH_LINK_CLASS } from "@repo/ui/blocks/auth/auth-card";
import { PHONE_PATHS, phoneHref } from "@app/lib/phone-auth";

return (
  <div className="flex w-full max-w-sm flex-col items-center gap-4">
    <SignInCard onSubmit={handleSignIn} signUpHref="/sign-up" />
    <a
      href={phoneHref(PHONE_PATHS.signIn, { redirect: search.redirect })}
      className={`${AUTH_LINK_CLASS} text-sm`}
    >
      Sign in with your phone number
    </a>
  </div>
);
```

Do the same in `sign-up.tsx` with `PHONE_PATHS.signUp` and "Sign up with your phone number".

**Phone only.** Send the email paths to the phone ones. Replace `apps/app/src/routes/sign-in.tsx` with a redirect that keeps the return path, and do the same in `sign-up.tsx` with `PHONE_PATHS.signUp` and no search:

```tsx
import { createFileRoute, redirect } from "@tanstack/react-router";
import { PHONE_PATHS, phoneHref } from "@app/lib/phone-auth";
import { toInternalPath } from "@app/lib/redirect";

export const Route = createFileRoute("/sign-in")({
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: toInternalPath(search.redirect),
  }),
  beforeLoad: ({ search }) => {
    throw redirect({
      href: phoneHref(PHONE_PATHS.signIn, { redirect: search.redirect }),
    });
  },
});
```

The root guard sends an anonymous visitor to `/sign-in`, so this redirect is the only change the guard needs. An email account (such as the seeded `member@example.test`) then has no sign-in screen in `apps/app`. Admins keep theirs in `apps/admin`.

What the screens do, so a change keeps it:

- **One request at a time.** `useRequestGate()` in `src/lib/phone-auth.ts` refuses a second call while one runs. Each step change calls `move()`, so a late answer to an old step is dropped and never replaces the step the customer is on.
- **No session check during sign-up.** `verify` opens a session before the password step. The sign-up route does not call `forgetSession()` or `router.invalidate()` until the password is saved, because the root guard sends a signed-in visitor off `/phone/sign-up` to `/`. A reload on the password step lands on `/` with a session and no password. The root guard keeps a signed-in visitor off `/phone/reset`, so that customer signs out first and then sets one there.
- **The number goes through `toE164()`** with `config["auth-phone"].defaultCountryCode`, the rule the server checks. The blocks never read config: the route passes the country code for the field's hint.
- **Each answer has its alert.** `phoneResultOf()` in `src/lib/phone-results.ts` reads the client's error, and `phoneAlert()` adds the link: no account opens `/phone/sign-up` with the number, no password opens `/phone/reset?reason=no_password` with the number, a known number on sign-up opens `/phone/sign-in`. A 429 names the wait from `Retry-After`, which the api's CORS spine exposes to the browser.
- **The reset signs in at the end** with the new password and goes where `/phone/sign-in` would (`resolveDestination()`). If that sign-in fails, the password is saved and the code is spent, so the screen opens `/phone/sign-in` with the number.

## Seed accounts

`pnpm db:seed` writes `+12025550101`, which signs in with `saasaloy-dev-password`, and `+12025550102`, which has no password and an unproven phone.

## What `remove` leaves behind

Phone accounts lose their sign-in path. Run `pnpm --filter @repo/db db:generate` and review the migration that drops the two columns.

`remove` deletes the blocks, the two `src/lib/phone-*.ts` files and the three phone routes, and takes the three rows back out of `AUTH_SCREENS`. It does not undo your Wire-up edits: a link or a redirect to `/phone/...` in `sign-in.tsx` or `sign-up.tsx` stays and then names no route. Take it out by hand. `src/routeTree.gen.ts` still lists the phone routes until the next `pnpm typecheck`, `pnpm dev` or `pnpm build` rewrites it.

With `e2e` installed, `remove` also deletes `lib/sms-log.ts`, `lib/sms.ts` and the journey spec from `packages/e2e`.

With `admin` installed, `remove` also deletes the login codes screen, its route, its repositories and `apps/admin/src/lib/contact.ts`, and takes the nav row and the route mount back out. Until #294 lands, nothing else imports `contact.ts`.

`remove` does not take the `@repo/sms` dependency back out of `packages/auth/package.json`, because no `remove` reverses a `package-json-dependency` patch. Delete the line by hand if nothing else in `packages/auth` imports `@repo/sms`.

## Next

Run `saasaloy-sms` to pick the provider that sends the codes, and never select `console` in a deployed environment.
