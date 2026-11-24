---
title: A provider's env keys are required only while its provider is selected
version: 0.13.0
---

Saasaloy 0.13.0 adds the conditional key. A conditional key may stay blank unless a `<CAP>_PROVIDER` key holds a named value. `packages/env/.env.example` marks it with a directive line above the key, `# @required-when EMAIL_PROVIDER=plunk` or `# @required-when EMAIL_PROVIDER!=console`. `pnpm env:setup`, the deploy check and `createEnv` read the same condition (ADR 0070).

## What update does

- **It re-renders `packages/env/.env.example`.** Each conditional key gets its `# @required-when` line as the first comment line above it. The descriptor's description stays below the directive.
- **It updates the env core in `packages/env/src/`.** `check.ts` reads the directive. `setup.ts` and `deploy.ts` accept a blank conditional key while its condition is false, and name the condition when it holds, for example `PLUNK_API_KEY (required: EMAIL_PROVIDER=plunk)`. `define.ts` adds `requiredWhen` to `definePreset`, and `createEnv` reports `unset; required when EMAIL_PROVIDER=plunk` with the module.
- **It makes these keys conditional, when their module is installed:**
  - `email`: `EMAIL_FROM` while `EMAIL_PROVIDER!=console`.
  - `email-plunk`: `PLUNK_API_KEY` while `EMAIL_PROVIDER=plunk`.
  - `sms-khudebarta`: `KHUDEBARTA_API_KEY` and `KHUDEBARTA_SECRET_KEY` while `SMS_PROVIDER=khudebarta`.
  - `payment-bkash`: `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME` and `BKASH_PASSWORD` while `PAYMENT_PROVIDER` lists `bkash`.
  - `payment-sslcommerz`: `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` and `SSLCOMMERZ_RECEIPT_EMAIL` while `PAYMENT_PROVIDER` lists `sslcommerz`.
  - `kv-upstash`: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `KV_KEY_PREFIX` while `KV_PROVIDER=upstash`.
  - `subscription-stripe`: `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` while `SUBSCRIPTION_PROVIDER=stripe`.
- **It gives the `console` email provider a default sender.** `consoleEmail()` sends from `dev@localhost` when `EMAIL_FROM` is blank, and `consoleEmail({ from })` changes the address. So `EMAIL_FROM` may stay blank while `EMAIL_PROVIDER=console`.

## What update merges

The files under `packages/env/src/` that you edited, the env preset of each module above, and `packages/email/src/define.ts` and `packages/email/src/providers/console.ts` if you edited them. Keep your edits and take the `requiredWhen` blocks and the `.optional()` schemas.

## What you do

1. Run `pnpm env:setup` with your local provider selected, for example `EMAIL_PROVIDER=console`.
2. Clear a placeholder value that you typed into a vendor key only to pass the old check. A blank vendor key now passes while another provider is selected.
3. If you added `# Blank on purpose` above one of the keys above by hand, delete that line. It wins over the directive, so the check never asks for the key.
4. In a preset of your own that reads a provider's key, make the key `.optional()` and add `requiredWhen: { KEY: { key: "<CAP>_PROVIDER", is: "<provider>" } }`.

## Verify

```sh
grep -n '@required-when' packages/env/.env.example
pnpm env:setup
pnpm check
```

The first command prints one directive line above each conditional key of the installed modules. `pnpm env:setup` passes with each vendor key blank under the local provider. For a production env that selects a vendor, run `node packages/env/src/deploy.ts --check` and confirm that it names each blank vendor key with its condition.
