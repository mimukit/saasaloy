# Plan: Require a provider's env keys only when that provider is selected

Grilled: 2026-11-24

Issue: #390

## Context

Every provider preset marks its credentials required, whichever provider the `<CAP>_PROVIDER` key selects. With `email`, `email-console` and `email-plunk` installed and `EMAIL_PROVIDER=console`, a development env must still hold a real `PLUNK_API_KEY` and an `EMAIL_FROM`. Otherwise `env:setup` refuses the blank keys, and any route that runs the full `apiEnv()` gate answers 500 with `EnvValidationError`. The owner does not want a real Plunk key on every dev machine.

The issue reports the keys as `# Blank on purpose` in `.env.example`. That comes from the reporter's local edits. On `main` at `3c611751`, `modules/email-plunk/registry-item.json` lists only `PLUNK_API_URL` in `envOptional`, and `modules/email/registry-item.json` has no `envOptional`. So three checks refuse the blank keys today: `env:setup` and the deploy check (both through `incompleteKeys` in `packages/cli/templates/base/packages/env/src/check.ts`) and the runtime gate (`validate` in `packages/cli/templates/base/packages/env/src/define.ts`).

The issue also cites a `DEV_EMAIL_FROM` fallback in the auth mail code. That fallback is not upstream. On `main`, `resolve()` in `modules/email/files/src/define.ts:109` throws `invalid_message` when neither `message.from` nor `EMAIL_FROM` is set. A blank `EMAIL_FROM` under `console` therefore needs a sender from somewhere.

The same defect exists in five other provider presets: `sms-khudebarta`, `payment-bkash`, `payment-sslcommerz`, `kv-upstash` and `subscription-stripe`.

**Goal:** a project develops every capability on its local provider with no vendor secret in its env, and a production env that selects a vendor still stops before deploy when that vendor's key is blank.

**Target:** no number fits a correctness fix. These checks show it worked: (1) `pnpm env:setup` passes with `EMAIL_PROVIDER=console` and blank `EMAIL_FROM` and `PLUNK_API_KEY`; (2) the deploy check refuses `EMAIL_PROVIDER=plunk` with a blank `PLUNK_API_KEY`; (3) `apiEnv()` passes and fails in the same two cases; (4) the same three hold for each of the five other providers.

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the condition lives | Declarative data, read by all three checks. A descriptor field names the condition. The CLI writes it into `.env.example` as a comment line, `check.ts` evaluates it for `env:setup` and the deploy check, and the preset carries the same data for `createEnv`. Picked over the issue's runtime-only `when()` function, because a runtime-only check lets a blank production key through the deploy check and fails only on the first request. Picked over dropping provider keys from the gate, because that loses the one aggregate error. |
| Condition shape | Data, never a function: one controlling key and one operator, `is` or `isNot`, with a provider name. `{ "PLUNK_API_KEY": { "key": "EMAIL_PROVIDER", "is": "plunk" } }`. Data is what lets a comment in a text file and a runtime check agree. |
| List-valued provider keys | A controlling value splits on commas and trims each name, as `modules/payment/files/src/define.ts:586` does. `is: X` holds when X is in the list. `isNot: X` holds when X is absent. A single name is a list of one, so one rule covers `EMAIL_PROVIDER` and `PAYMENT_PROVIDER`. |
| `EMAIL_FROM` condition | `isNot: "console"`. A new sending provider then needs no edit to the email module. |
| Dev sender under `console` | The provider contract gains an optional `defaultFrom`. `email-console` sets it. `resolve()` takes `message.from`, then `EMAIL_FROM`, then `provider.defaultFrom`, and throws as today when all three are unset. The core stays vendor-blind and never names `console`. |
| Scope | The env mechanism, the email capability, and the five other provider presets, in one plan. The architecture rules give every capability one shape. |
| Field names | `envRequiredWhen` in the descriptor, `requiredWhen` in the preset, beside `envOptional`. Shape: `"envRequiredWhen": {"PLUNK_API_KEY": {"key": "EMAIL_PROVIDER", "is": "plunk"}}`. |
| Marker grammar | A directive, like `# @services`: `# @required-when EMAIL_PROVIDER=plunk` and `# @required-when EMAIL_PROVIDER!=console`. The descriptor's prose description stays above it. The renderer regenerates the marker on every render, so `saasaloy update` refreshes old files. |
| Merge across modules | The strictest rule wins, in `render.ts` and in `collect()` in `define.ts` alike: required beats conditional, conditional beats optional, and two conditions on one key mean required when either holds. This extends rule #249 at `render.ts:661`. |
| Console sender | `consoleEmail()` exposes `defaultFrom: "dev@localhost"`, and `consoleEmail({ from })` overrides it. |
| Condition scope in setup and deploy | A condition reads the service's own values. Doctor warns when the controlling key does not route to the same service. Every case found routes both keys to `api`. |
| A blank controlling key | `is` is false and `isNot` is true, so `EMAIL_FROM` stays required while `EMAIL_PROVIDER` is blank. The blank controlling key fails on its own as today. |
| `isNot` width | One name only. A list can come later without breaking the format. |
| Explicit declaration | Each module declares its conditions. The CLI does not derive them from provider rows, because it does not know provider names and `EMAIL_FROM` is a core key. |
| Error wording | Setup and deploy name the condition, for example `PLUNK_API_KEY (required: EMAIL_PROVIDER=plunk)`. The runtime gate reports `unset; required when EMAIL_PROVIDER=plunk` with the module. |
| Compat with older projects | No version gate: one render ships the env core and the presets together. The release adds a base update note (ADR 0058). |
| Outward actions | None beyond the implementation branch and its PR. |
| Test approach | No new kind of test. Env core cases go in the base template's existing `define.test.ts` and `check.test.ts`, the renderer cases in the CLI's existing env-example tests, and the descriptor/preset agreement in `scripts/env-presets.test.ts`. |

## Approach

The chosen approach adds one concept, a **conditional key**: a key that may stay empty unless another key holds a named value. It reuses:

- the descriptor's `envVars` / `envOptional` fields (`packages/cli/src/lib/schema.ts:300`) and the doctor check that `envOptional` names a declared key (`packages/cli/src/lib/doctor.ts:403`);
- the `# Blank on purpose` comment mechanism: `renderEnvExample` in `packages/cli/src/lib/env-example.ts` writes a marker line, and `blankOnPurposeKeys` in `check.ts` reads it back from the comment block;
- `incompleteKeys` in `check.ts`, which both `setup.ts:162` and `deploy.ts:113` call, so one change reaches both checks;
- the aggregate `EnvValidationError` in `define.ts`, so a conditional failure arrives in the same throw as every other key;
- `scripts/env-presets.test.ts`, which already compares a descriptor's keys with its preset's keys as text.

Rejected alternatives, one line each: the issue's `requires: [{ key, when(values), reason }]` is runtime-only and leaves the deploy check blind; a whole-object refine on `createEnv` is runtime-only too and gives no per-key module in the error; plain `.optional()` provider keys lose the gate.

### Phase 1: Conditional keys in the env core and the CLI

1. Add the `envRequiredWhen` descriptor field to `packages/cli/src/lib/schema.ts` and the published descriptor JSON schema: key name to `{ key, is }` or `{ key, isNot }`.
2. Add doctor checks: each named key is in `envVars`, a key is not in both `envOptional` and `envRequiredWhen` of one module, exactly one of `is` and `isNot` is set, and the controlling key routes to the same service.
3. Pass the field through `packages/cli/src/engine/render.ts` (beside `envOptional` at line 565 and line 647) into `renderEnvExample`. Merge the rules across modules with the strictest-wins rule. Write one marker line above the key: `# @required-when EMAIL_PROVIDER=plunk` or `# @required-when EMAIL_PROVIDER!=console`.
4. In `check.ts`, parse the marker into a condition and make `incompleteKeys` skip a blank conditional key while its condition is false. Evaluate the condition against the service's values, and name the condition in the missing-key message.
5. In `define.ts`, add an optional `requiredWhen` map to `definePreset` and `EnvPreset`. After every key passes its own schema, `validate` reports each conditional key that is unset while its condition holds, as `unset; required when EMAIL_PROVIDER=plunk` with the preset's module. `collect()` merges a key's rules across presets with the strictest-wins rule. On the client, a condition on a server key is skipped.
6. Export the condition type from the env package index.
7. Extend `scripts/env-presets.test.ts`: a module's `envRequiredWhen` and its preset's `requiredWhen` name the same keys and the same conditions.

Done when: `pnpm test` passes with new cases in `define.test.ts` (optional while false, fails with module and reason while true, passes once set, checked after every key parses, skipped on the client, list value matched by name), in `check.test.ts` (setup and deploy skip or report by condition), and in the env-example renderer tests (marker line written and stable on regeneration).

### Phase 2: Email

1. In `modules/email/files/src/env-preset.ts`, make `EMAIL_FROM` `.optional()` and add `requiredWhen: { EMAIL_FROM: { key: "EMAIL_PROVIDER", isNot: "console" } }`. Add the matching `envRequiredWhen` row to `modules/email/registry-item.json`.
2. In `modules/email-plunk/files/env.ts`, make `PLUNK_API_KEY` `.optional()` with `requiredWhen` on `EMAIL_PROVIDER` `is: "plunk"`, and fix the comment that says installing the provider makes its keys required. Add the descriptor row.
3. Add `defaultFrom?: string` to the provider contract in `modules/email/files/src/provider.ts`. Set it to `dev@localhost` in `modules/email-console/files/console.ts`, overridable by `consoleEmail({ from })`. Make `resolve()` fall back to it.
4. Add an api test that composes `emailEnv()` alone: `console` with both keys blank passes; `plunk` with both blank fails on both; `cloudflare` fails on `EMAIL_FROM` only; `plunk` with both set passes.
5. Update the `saasaloy-email` skill and the `envVars` wording for both keys.

Done when: in a `.dev` project with `email`, `email-console` and `email-plunk`, `pnpm env:setup` passes with `EMAIL_PROVIDER=console` and both keys blank, a console send logs a mail from the default sender, and the deploy check refuses `EMAIL_PROVIDER=plunk` with a blank `PLUNK_API_KEY`.

### Phase 3: The five other provider presets

Apply the Phase 2 shape to each preset and descriptor:

- `sms-khudebarta`: `KHUDEBARTA_API_KEY`, `KHUDEBARTA_SECRET_KEY` when `SMS_PROVIDER` is `khudebarta`.
- `payment-bkash`: `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `BKASH_USERNAME`, `BKASH_PASSWORD` when `PAYMENT_PROVIDER` lists `bkash`.
- `payment-sslcommerz`: `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASSWORD` when `PAYMENT_PROVIDER` lists `sslcommerz`.
- `kv-upstash`: `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` and `KV_KEY_PREFIX` when `KV_PROVIDER` is `upstash`. Remove the descriptor note that says `KV_KEY_PREFIX` stays required.
- `subscription-stripe`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` when `SUBSCRIPTION_PROVIDER` is `stripe`.

The provider names are checked against each provider's registered `name`: `khudebarta`, `bkash`, `sslcommerz`, `upstash`, `stripe`.

Done when: `pnpm test:scripts` passes, and each provider's existing tests plus one gate case (blank keys pass under the local provider, fail under the vendor) pass.

### Phase 4: Docs, ADR and skills

1. Record an ADR: a provider key is conditional on the `<CAP>_PROVIDER` value, declared as data and checked at setup, deploy and runtime.
2. Update the `saasaloy-env` skill in the base template with a "Required when" section beside "Blank on purpose", and the `create-provider` skill so a new provider declares its keys conditional.
3. Run `pnpm docs:generate` and add a "Required when" column or note to the env reference it writes (`scripts/docs-generate.ts:545`).
4. Run `pnpm docs:stale` and update the covering wiki pages.
5. Add a base update note for the release that explains the new marker and the newly optional keys.

Done when: `pnpm docs:check`, `pnpm docs:stale` and `pnpm lint` pass, and the four target checks in Context pass in a `.dev` project.

## Open questions

None. The grill on 2026-11-24 settled every point the draft listed. The settled answers are in Design decisions.

## Non-goals

- `storage-cloudflare`: its four R2 keys are optional together by design. An "all or none" rule is a different condition and stays out.
- Conditions on any key other than a `<CAP>_PROVIDER` selector, and boolean combinations of conditions.
- A default provider. An unset or unknown `<CAP>_PROVIDER` still throws.
- Changing the reporter's project. `saasaloy update` replaces their local edit once this ships.
