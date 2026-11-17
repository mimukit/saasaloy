---
title: A known number may sign in by code, behind codeSignIn
---

## What update does

`packages/auth/src/plugins/phone-account.ts` lets a `send-otp` and a `verify` that carry `signIn: true` through for a number that has an account, so `verify` opens a session on it. A banned account gets 403 `BANNED_USER` before a code goes out. A request without the flag still answers 409 `PHONE_NUMBER_EXIST`, so the app's sign-up screen is unchanged. `packages/config/src/sections/auth-phone.ts` adds `codeSignIn`, `true` by default. `packages/auth/src/phone.ts` and `packages/auth/src/plugins/phone-number.ts` log the code with the template `sign-in-code`, in the one send budget sign-up and reset codes use. The admin login codes screen lists it with the purpose "Sign-in".

It reaches no account a reset code does not already reach: both send a code to the number and act on the account that owns it.

## What the merge plan gets

The files above, plus `packages/db/src/repositories/login-code-rules.ts` and `apps/admin/src/routes/login-codes.tsx`, if you edited them. Keep your edits and take the `signIn` exception in the 409 hook and the `sign_in` purpose.

## What you do

1. To keep the code for sign-up and reset only, set `"auth-phone": { codeSignIn: false }` in `packages/config/src/project.ts`.
2. Nothing else. The app screens send no flag and behave as before.

## Verify

```sh
pnpm test
```

The auth-phone route tests pass, including the "sign-in by code" group.
