# QA Plan: Provider contract guard

_Generated 2026-11-20 · against `647866a5` (clean) · covers issue #369: per-module tests for `email`, `sms`, `email-plunk`, `email-cloudflare`, and the table-driven guard `scripts/provider-selection.test.ts`_

## Summary
- The change adds tests that check the `<CAP>_PROVIDER` selection rule in all eight capability cores.
- Working means `pnpm test` passes, and a broken selector or a core with no table row fails it by name.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-369-guard-the-provider-contract-in-every-capability` at `647866a5`.
- No server, no credentials, no feature flags. The change adds tests and two doc paragraphs only.
- Screenshots: none. The change has no UI.

Install the dependencies with:

```sh
pnpm install --frozen-lockfile
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Clean checkout of the branch | A guard failure tells a contributor what to fix | 🟡 Normal |
| TC-1.2 | 1: Clean checkout of the branch | The new doc text tells a contributor where the row goes | 🟢 Low |

## Scenario 1: Clean checkout of the branch

**Setup.** Run once, for every case in this scenario.

1. Start from a clean tree on the branch.

```sh
git status --short
```

- [ ] Setup complete

### TC-1.1: A guard failure tells a contributor what to fix  ·  🟡 Normal

**Goal.** A contributor who adds a core can act on the guard's failure message with no other help.

**Steps**

1. Add a fake core with no table row.

   ```sh
   mkdir -p modules/zzz/files/src/providers && touch modules/zzz/files/src/define.ts
   ```

2. Run the guard.

   ```sh
   node --import ./scripts/ts-resolve-hook.ts --test scripts/provider-selection.test.ts
   ```

   - [ ] The failure message names `zzz` and says what the new row needs
     - the line that starts with `capability cores with no row in CORES`
     - whether "env key, define export and mode" is enough to write the row

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The new doc text tells a contributor where the row goes  ·  🟢 Low

**Goal.** The two new paragraphs explain the guard in words a module author understands.

**Steps**

1. Read the paragraph on `scripts/provider-selection.test.ts` in `CONTRIBUTING.md`, under "Unit tests over module payloads".
   - [ ] The paragraph reads clearly and names the file, the table and the three modes
2. Read the sentence on `CORES` in `docs/wiki/how-to/contribute-a-module.md`, in the testing paragraph.
   - [ ] The sentence fits the page and does not repeat CONTRIBUTING.md word for word

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above.

```sh
rm -r modules/zzz
```

## Automated verification (by AI agent)
_Checks the agent ran itself at `647866a5` (clean). No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

```sh
pnpm test
```

```sh
git diff --name-only main...HEAD
```

```sh
git worktree add --detach /tmp/qa-mut HEAD && cd /tmp/qa-mut
```

```sh
mkdir -p modules/zzz/files/src/providers && touch modules/zzz/files/src/define.ts && node --import ./scripts/ts-resolve-hook.ts --test scripts/provider-selection.test.ts
```

```sh
sed -i 's/throw new Error(`EMAIL_PROVIDER is not set/return providers[0]; throw new Error(`EMAIL_PROVIDER is not set/' modules/email/files/src/define.ts && node --import ./scripts/ts-resolve-hook.ts --test scripts/provider-selection.test.ts
```

The two mutations ran in a throwaway detached worktree, which the agent removed afterwards. The branch tree stayed clean.

- ✅ C1 · `modules/email/files/src/define.test.ts` → suite `defineEmail: provider selection` passes in `pnpm test`; it asserts unset, empty and unknown `EMAIL_PROVIDER` throw, a known name selects that provider, and an empty registry names `saasaloy add email-console`.
- ✅ C2 · `modules/sms/files/src/define.test.ts` → suite `defineSms: provider selection` passes; it asserts unset and unknown `SMS_PROVIDER` throw and a known name selects that provider.
- ✅ C3 · sms extras → suites `defineSms: recipient and body checks` (E.164 accept and three rejects, empty body), `defineSms: a raw provider throw`, `measureSegments: GSM-7` (160, 161, extension character = 2), `measureSegments: UCS-2` (70, 71) and `SmsError: retryable coercion` (8 codes) pass.
- ✅ C4 · vendor email tests → suites `plunk: status mapping`, `plunk: request failures`, `plunk: success`, `cloudflare: error mapping` and `cloudflare: binding` pass. `plunk.test.ts` replaces `globalThis.fetch` in `beforeEach` (line 38) and restores it in `afterEach`; `cloudflare.test.ts` uses no `fetch` and stubs the `EMAIL` binding on `env`. No test makes a live call.
- ✅ C5 · `pnpm test` → `test:modules` reports 1721 tests, 1721 pass, 0 fail. Each of the six new files shows its top-level suite in the output (Node 24 reporters print suite names, not file paths).
- ✅ C6 · `scripts/provider-selection.test.ts` → suite `provider selection: the table` passes (8 rows equal the 8 cores on disk), and one suite each passes for email, sms, queue, kv, storage, subscription (`required`), logger (`optional`) and payment (`list`).
- ✅ C7 · fake core `modules/zzz` → guard exit 1 with `capability cores with no row in CORES: zzz. Add a row with the core's env key, its define export and its mode.`
- ✅ C8 · `return providers[0]` in email's unset branch → guard exit 1, 1 failure: `Missing expected exception: email: an unset value must throw at construction, naming EMAIL_PROVIDER`.
- ✅ C9 · `pnpm test` → exit 0; turbo 2 of 2 tasks, `test:modules` 1721/1721, `test:base` 164/164, `test:scripts` 1061/1061 (1035 existing plus 26 guard cases).
- ✅ Scope · `git diff --name-only main...HEAD` lists 12 files: 7 test files, 2 test-only shims, `package.json`, `CONTRIBUTING.md` and one wiki page. No shipped source file under `modules/*/files/` changes. Neither descriptor lists the shims: `email-plunk` ships `files/plunk.ts` and `files/env.ts`, `email-cloudflare` ships `files/cloudflare.ts`.

## Not covered / needs human judgment
- Live vendor calls to Plunk or Cloudflare are out of scope by the plan. The tests pin today's mapping with stubs.
- Browser checks: the change has no UI, so no browser ran.
- The nightly contract suite (#245) and the `kv` contract (#172) are separate issues.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
