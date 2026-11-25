# 0070: A provider's env key is required only while its provider is selected, and the condition is data

Every provider preset marked its credentials required, whichever provider the `<CAP>_PROVIDER` key selected. A project with `email`, `email-console` and `email-plunk` and `EMAIL_PROVIDER=console` still needed a real `PLUNK_API_KEY` and an `EMAIL_FROM`. Without them, `pnpm env:setup` refused the blank keys and the api's `createEnv` gate answered 500 (#390). `sms-khudebarta`, `payment-bkash`, `payment-sslcommerz`, `kv-upstash` and `subscription-stripe` had the same defect. Settled in the grill of plan [0124](../plans/0124-plan-conditional-provider-env-keys-2026-11-24.md) on 2026-11-24.

**A provider's key is a conditional key: it may stay blank unless the `<CAP>_PROVIDER` key holds a named value.** The condition is data, never a function: one controlling key and one operator, `is` or `isNot`, with one provider name. The descriptor declares it in `envRequiredWhen`, for example `{"PLUNK_API_KEY": {"key": "EMAIL_PROVIDER", "is": "plunk"}}`. The preset carries the same data in `requiredWhen`, and the key's schema is `.optional()`. The CLI writes it into `packages/env/.env.example` as a directive line above the key, `# @required-when EMAIL_PROVIDER=plunk` or `# @required-when EMAIL_PROVIDER!=console`. Three checks read the same condition: `pnpm env:setup`, the deploy check (`deploy.ts --check`), and `createEnv` at runtime.

A list-valued controlling key, such as `PAYMENT_PROVIDER=manual,sslcommerz`, is split on commas: `is` holds when the list names the provider, and `isNot` holds when it does not. A blank controlling key makes `is` false and `isNot` true. When two modules declare one key, the strictest rule wins: required beats conditional, conditional beats optional, and two conditions mean required when either holds. The core stays vendor-blind, so `EMAIL_FROM` is required while `EMAIL_PROVIDER!=console`, and `email-console` supplies a `defaultFrom` of `dev@localhost` through the provider contract.

## Status

accepted. It extends the env capability of ADRs 0039, 0040 and 0041, and it keeps their rule that `env` goes into a capability whole. `envRequiredWhen` is a new descriptor field, so under ADR 0044 the CLI moves to 0.13.0, and each descriptor that uses the field declares `requires.saasaloy: ">=0.13.0"`.

## Considered Options

- **The issue's `requires: [{ key, when(values), reason }]` on the preset.** Rejected. A function runs only at runtime, so the deploy check cannot read it. A blank production key then passes the deploy and fails on the first request.
- **A whole-object refine on `createEnv`.** Rejected. It is runtime-only for the same reason, and its error does not name the module that declared the key.
- **Plain `.optional()` provider keys, or `# Blank on purpose` on each one.** Rejected. It removes the gate: a production env that selects `plunk` with a blank `PLUNK_API_KEY` deploys, and the first send fails.
- **The CLI derives each condition from the provider rows.** Rejected. The CLI does not know a provider's `name`, and `EMAIL_FROM` is a core key that no provider row owns.

## Consequences

- A project develops each capability on its local provider (`console`, `memory`, `manual`) with every vendor key blank, and a production env that selects a vendor still stops at the deploy check when that vendor's key is blank.
- A new provider declares its vendor keys conditional on its own name in both places. `scripts/env-presets.test.ts` fails when a descriptor's `envRequiredWhen` and its preset's `requiredWhen` disagree, and `saasaloy doctor` reports a malformed condition.
- `saasaloy update` re-renders `.env.example`, so an older project gets the directive lines on its next update. Base update note `base/0011-conditional-env-keys` lists the keys that changed.
- A condition reads only the values of the service that reads the key. Doctor warns when a module's controlling key does not reach the same services as its conditional key.
- Only a `<CAP>_PROVIDER` selector controls a condition. An "all or none" group, such as the four R2 keys of `storage-cloudflare`, and boolean combinations stay out of scope.
