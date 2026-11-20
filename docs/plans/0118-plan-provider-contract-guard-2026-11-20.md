# Plan: guard the provider contract in every capability core

Grilled: 2026-11-20

Issue: [#369](https://github.com/mimukit/saasaloy/issues/369). Source: [`docs/refactor/0003-refactor-full-project-2026-11-11.md`](../refactor/0003-refactor-full-project-2026-11-11.md) (candidate 19).

## Context

`AGENTS.md` states one rule for every capability: `<CAP>_PROVIDER` is required, and an unset or unknown value throws at construction. Eight cores each hold their own copy of the selector in `modules/<cap>/files/src/define.ts`: `email`, `sms`, `logger`, `payment`, `queue`, `kv`, `storage` and `subscription`. A project owns its copy, so the copies stay. Two copies differ on purpose. `logger` is optional: unset selects the first provider, and only an unknown name throws. `payment` takes a comma list: an unset value, an empty list or one unknown name throws.

Nothing checks that all eight still follow the rule. On `main` at `17c4da66`, six cores have a selector test (`define.test.ts`) and `email` and `sms` have none. `email-plunk` and `email-cloudflare` have no test file. No test covers the E.164 check, the segment count or the `retryable` coercion of `sms`.

Goal: a change that breaks the provider selection rule in any core, or adds a core outside the rule, fails `pnpm test` on the pull request.

Target: 8 of 8 cores under one table-driven guard (baseline 0), and 0 vendor email providers with no test (baseline 2).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Test runner | `node:test` with `node:assert/strict`, the runner every module test and script test uses today. No new dependency. |
| Where a module test lives | Beside the file it tests, under `modules/<module>/files/`, run by `pnpm test:modules`. The descriptor does not list it, so `saasaloy add` never copies it (the `sms-khudebarta` pattern). |
| How a vendor provider test resolves `../provider` | A test-only shim `modules/<provider>/provider.ts` that re-exports the core's real `provider.ts`, copied from `modules/sms-khudebarta/provider.ts`. Not shipped. |
| What counts as a capability core | A module with both `files/src/define.ts` and a `files/src/providers/` folder. The guard finds the set from disk, so a new core with no table row fails. |
| Where the guard lives | `scripts/provider-selection.test.ts`. It imports each core's `define.ts` and calls `define<Cap>({ providers: [stub] }).create(env)` with a stub provider, so it tests the selector, not the installed providers. |
| How the guard resolves extensionless imports | `test:scripts` gains `--import ./scripts/ts-resolve-hook.ts`, the hook `test:modules` already uses. If that flag breaks an existing script test, move the guard to a new `test:contracts` script that the root `test` script runs, and leave `test:scripts` as it was. |
| Table modes | `required` (unset throws, unknown throws, known selects): `email`, `sms`, `queue`, `kv`, `storage`, `subscription`. `optional` (unset selects the first, unknown throws): `logger`. `list` (unset throws, empty throws, one unknown name throws, two known names select in the listed order): `payment`. |
| Thrown message | Every throw the guard expects must name the row's env key (`EMAIL_PROVIDER`, `PAYMENT_PROVIDER`, ...). All eight cores do so today. |
| Stub provider | Each row carries its own stub factory. The default is `{ name }`, and a row adds fields only when its core reads them at construction. |
| A test finds a real bug | Fix it in the same PR only when the fix makes the code follow the `AGENTS.md` provider rule, and name the fix under **Assumptions** in the PR body, with an update note when a project sees a change. Any other change of behaviour escalates the issue to `needs-planning`. |
| Dependencies | None. The guard calls `define<Cap>` directly and touches no descriptor, so it is independent of #365 and #366. |
| Outward actions | Only the afkkit authorization: commits on the issue branch, one push, one PR. Nothing else is approved. |
| Wiki pages | Run `pnpm docs:freshness`. Use the `docs: none` PR label when no covering page needs a change. |
| Vendor network | Every vendor test stubs `globalThis.fetch` or the binding. No test makes a live call. |
| Plunk status table source | The mapping in `modules/email-plunk/files/plunk.ts` as it stands. The test pins today's behaviour; it does not change the mapping. |

## Approach

Write the missing per-module tests first, then the guard that reads all eight cores. Each test follows the style of `modules/queue/files/src/define.test.ts` and `modules/sms-khudebarta/files/khudebarta.test.ts`. No source file under `modules/*/files/` changes, unless a test finds a real bug; record such a fix in the PR body.

Rejected: a shared `@repo/capability` package or a selector generator (out of scope in #369, and a project owns its copy); a guard that reads `define.ts` as text and greps for `throw` (it passes on dead code and misses a changed condition).

### Phase 1: per-module tests

- `modules/email/files/src/define.test.ts`: unset `EMAIL_PROVIDER` throws, an unknown name throws, a known name selects that provider, and an empty registry names the install command.
- `modules/sms/files/src/define.test.ts`: the same three selector cases for `SMS_PROVIDER`; E.164 accepts `+14155550123` and rejects a number with no `+`, a country code that starts with `0`, and 16 digits; an empty body throws `invalid_message`; a provider that throws a raw `Error` reaches the caller as `provider_error` with `retryable: false`.
- `modules/sms/files/src/segments.test.ts`: GSM-7 at 160 and 161 characters, UCS-2 at 70 and 71 characters, and a GSM-7 extension character counted as two.
- `modules/sms/files/src/provider.test.ts`: `new SmsError(code, msg, { retryable: true })` keeps `true` only for a code in `RETRYABLE_CODES` and gives `false` for every other code.
- `modules/email-plunk/provider.ts` (shim) and `modules/email-plunk/files/plunk.test.ts`: each status branch of `mapStatus` (429, 413, 422 with a size code, 401, 403, 404, 422 without one, 500, an unlisted 4xx), a body `code` that overrides the status, and a `fetch` that rejects (`retryable: true`).
- `modules/email-cloudflare/provider.ts` (shim) and `modules/email-cloudflare/files/cloudflare.test.ts`: each code in the map, an unknown code (`provider_error`, `retryable: false`, raw code in `providerCode`), and a thrown value with no `code`.

Done when: `pnpm test:modules` passes and its output lists each of the six new test files.

### Phase 2: the table-driven guard

- Add `--import ./scripts/ts-resolve-hook.ts` to `test:scripts` in the root `package.json`.
- Write `scripts/provider-selection.test.ts` with one row for each core: module, env key, factory export name, mode.
- One test asserts that the set of rows equals the set of cores the guard finds on disk, and names the missing or extra module in its failure message.
- One test for each row runs the cases of its mode.

Done when: `pnpm test` passes; the guard reports 8 cores; adding an empty `modules/zzz/files/src/define.ts` and `modules/zzz/files/src/providers/` makes `pnpm test:scripts` fail with a message that names `zzz`; and changing `email`'s unset branch to return the first provider makes it fail with a message that names `EMAIL_PROVIDER`. The two mutations are reverted before commit.

## Open questions

None. The grill on 2026-11-20 settled them: the hook fallback, the message check, the stub factory and the wiki check are rows in Design decisions.

## Non-goals

- A shared `@repo/capability` package, a selector generator, live vendor calls, and the nightly contract suite of #245.
- The `kv` contract changes of #172.
- Tests for providers other than `email-plunk` and `email-cloudflare`.
- Any change to a selector's behaviour.
