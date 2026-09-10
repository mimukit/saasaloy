# QA Plan: `sms` capability module + `sms-console` provider

_Generated 2026-08-09 · against `d25ab57` · covers `issue-67-sms-capability-module-with-a-console-provider` vs `main` (5 commits, issue #67)_

## Summary

- `saasaloy add sms` scaffolds `packages/sms` (`@repo/sms`, alias `@sms`) — a provider-agnostic
  text sender with a template convention, E.164 recipient validation, a GSM-7/UCS-2 **segment
  estimator**, a normalized `SmsError`, and a **provider registry** with zero runtime
  dependencies. `saasaloy add sms-console` drops one file into `packages/sms/src/providers/` and
  appends `consoleSms()` to the `providers` array in `src/index.ts` through a `plugin-array` patch.
- "Working" means: the capability and the provider install and re-install idempotently; a caller
  imports `@repo/sms`, calls `createSms(env)`, and never learns which provider is active;
  `SMS_PROVIDER=console` logs a message with no account and no purchased number; a non-E.164
  recipient is refused before any provider is reached; and `estimatedSegments` reports the real
  GSM 03.38 arithmetic instead of a length divided by 160.

**Split of work in this document.** The agent already ran everything a script can decide: install,
idempotency, the patch, provider selection and both of its error branches, E.164 validation,
empty-body validation, alphanumeric-sender passthrough, the segment arithmetic including both
straddle cases, the `retryable` coercion on all eight error codes, zero runtime dependencies,
typecheck and build. See [Automated verification](#automated-verification-by-ai-agent).

What is left is the part no script on this branch can reach. **There is no real provider in this
issue** — `sms-twilio` is the follow-up — so, unlike the `email` QA plan, there is no "send it for
real" case. What remains is judgment: does the segment estimate match a vendor's own billing, is
the compliance section enough to keep a project out of legal trouble, and is the interface right
*before* a real provider builds on it.

## Run log

| Field | Value |
|---|---|
| Tester | |
| Date run | |
| Build / commit | `d25ab57` |

**Overall**

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-67-sms-capability-module-with-a-console-provider`.
- Run every command from the worktree root unless a step says otherwise. Every path is relative to
  the worktree root.
- Node 24+ and pnpm 11, per the repo's toolchain.
- Scenario 3 needs an account with a provider that reports its own segment count. Scenarios 1 and 2
  need no account.
- The CLI is already built at `packages/cli/dist/index.js`. Scenario 2's setup rebuilds it anyway.

Run every `saasaloy` command from `.dev/playground`, per `AGENTS.md`. Never use a globally linked
CLI. The `./saasaloy` shim in that directory points the freshly built CLI at **this worktree's**
`modules/` registry.

Scenario 2 sends HTTP requests to the local Worker. Set the base URL once:

```sh
export BASE_URL=http://localhost:4000
```

- [ ] Environment ready

### Known states — do not report these as failures

- **`saasaloy add` takes one module per invocation.** `./saasaloy add sms sms-console` — the
  shorthand the plan document uses — is rejected with `Unknown argument(s): sms-console`. Run two
  commands, or run `./saasaloy add sms-console` alone and let it pull `api` and `sms` in first.
- **The plan document's segment example at line 132 is wrong, and the code is right.** The plan
  says "160 tildes → 2". A tilde costs two septets, so 160 tildes is 320 septets, which is 3
  segments of 153. The shipped counter reports 3. The case the plan meant — 160 characters, one of
  them a tilde, so 161 septets → 2 segments — is also verified.
- **`pnpm deps:check` fails, and it fails the same way on `main`** (17 pending rows before this
  branch, 18 after). The one added row is `@cloudflare/workers-types 5.20260723.1 → 5.20260804.1`
  in `modules/sms/files/package.json`. `modules/email/files/package.json` carries the same stale
  pin, because `sms`'s devDependencies copy email's verbatim. `pnpm deps:update` owns that row.

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — Source and docs only, nothing installed | The three unexercised contracts are the right shape | 🔴 Critical |
| TC-1.2 | 1 — Source and docs only, nothing installed | The compliance section is enough to act on | 🟡 Normal |
| TC-2.1 | 2 — A fresh playground with `sms` and `sms-console` installed | The console log block reads right to an operator | 🟡 Normal |
| TC-2.2 | 2 — A fresh playground with `sms` and `sms-console` installed | The env panel and the `saasaloy-sms` skill are usable without the plan | 🟢 Low |
| TC-3.1 | 3 — An account with a provider that reports its own segment count | Segment estimates match a real provider's own count | 🔴 Critical |

## Scenario 1 — Source and docs only, nothing installed

A design review of the shipped interface and its documentation. Nothing runs. This scenario costs
no setup, so run it first.

**Setup** — once, for every case in this scenario.

1. Open these four files in the worktree. Read no other document first — a reviewer who has read
   the plan cannot judge whether the shipped text stands on its own.
   - `modules/sms/files/src/provider.ts`
   - `modules/sms/skills/saasaloy-sms/SKILL.md`
   - `.agents/skills/create-provider/SKILL.md`, section `Mode: sms` (line 157)
   - `modules/sms-console/files/console.ts`

- [ ] Setup complete

### TC-1.1 — The three unexercised contracts are the right shape  ·  🔴 Critical

**Goal** — the three interface decisions that nothing installed today can raise are still the
decisions you want, before `sms-twilio` and project code build on them.

`sms-console` needs no sender, has no account, and accepts any body length. Three contracts
therefore ship untested:

- **optional `from`** — nothing shipped ever says "I need a sender"
- **`account_error`** — no shipped provider has an account to fail
- **`message_too_long`** — no shipped provider has a cap

**Steps**

1. Read the `SmsErrorCode` union and the `ResolvedSmsMessage.from` comment in
   `modules/sms/files/src/provider.ts`.

   - [ ] The eight error codes cover the failures a real provider reports, and none of them
     overlaps another
     - `invalid_number` and `unroutable` are two different carrier answers, not one
     - `account_error` collapses sender-not-owned, empty balance and missing geo permission — check
       that a caller's request handler really would not branch between them
     - `providerCode` is enough for whoever has to fix an `account_error`

2. Read the `Mode: sms` section of `.agents/skills/create-provider/SKILL.md`. Write the
   `sms-twilio` code that would use each of the three contracts. On paper is enough.

   - [ ] A provider that needs a sender can raise `invalid_message` from its own `send()` without
     fighting the core
   - [ ] `message_too_long` sitting unused in the union still beats a core-side 1600-character cap
     (1600 is Twilio's channel limit, not the protocol's)

3. Ask the question the union cannot answer for you: would a provider author reach for a code that
   is not in the union?

   - [ ] No missing code. Name any you would add.

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _name anything you would change now rather than after `sms-twilio` ships_

### TC-1.2 — The compliance section is enough to act on  ·  🟡 Normal

**Goal** — a developer about to send marketing texts learns from the skill alone what they still
owe, and does not mistake the capability for protection it does not give.

Consent, STOP handling and quiet hours are legal exposure, and this capability builds none of them.
"Surfaced, not built" only protects a project if the surfacing works.

**Steps**

1. Read `modules/sms/skills/saasaloy-sms/SKILL.md`, section `Compliance: what the provider handles
   and what you owe` (line 215). Read it as someone about to send a marketing blast who has never
   seen the plan or the issue.

   - [ ] The split of duty is unmistakable
     - the **project** owes consent capture, quiet hours, its own opt-out record, and A2P 10DLC
       registration
     - the **provider and carrier** own STOP, UNSTOP, HELP and the opt-out list itself
   - [ ] `opted_out` reads as a standing instruction — never retried, never re-attempted — and not
     as one more transient failure
   - [ ] The transactional-versus-marketing line is clear enough to self-classify, including "if
     you are unsure, you're sending marketing"

2. Write down what you would go and build before sending.

   - [ ] Your list matches the "Yours, and not built here" list. Record anything the section made
     you miss.

3. Judge the wording as a human.

   - [ ] Nothing here reads as legal advice it is not, and nothing promises a protection the code
     does not provide

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes**

## Scenario 2 — A fresh playground with `sms` and `sms-console` installed

**Setup** — once, for every case in this scenario.

> This setup destroys and re-scaffolds `.dev/playground`. Anything you added there by hand is
> gone. That is by design; `.dev` is scratch.

1. Reset the playground. **Keep this terminal open** — TC-2.2 reads the output of step 3.

   ```sh
   pnpm run play:reset
   ```

   - [ ] The command exits 0 and `.dev/playground/saasaloy` exists

2. Change into the playground. Every command below runs from there.

   ```sh
   cd .dev/playground
   ```

3. Add the capability. This pulls `api` in first, because the base scaffold has no `apps/api` yet.

   ```sh
   ./saasaloy add sms --yes
   ```

   - [ ] The run reports 16 files and scaffolds `packages/sms`
   - [ ] An **Env vars to set** panel prints `SMS_PROVIDER` and `SMS_FROM`. Leave it on screen for
     TC-2.2.

4. Add the provider. This is a second command on purpose — see
   [Known states](#known-states--do-not-report-these-as-failures).

   ```sh
   ./saasaloy add sms-console --yes
   ```

   - [ ] `packages/sms/src/providers/console.ts` exists, and `packages/sms/src/index.ts` now reads
     `export const sms = defineSms({ providers: [consoleSms()] });`

5. Write the local environment file.

   ```sh
   printf 'SMS_PROVIDER=console\nSMS_FROM=ACME\n' > apps/api/.dev.vars
   ```

6. Add a throwaway route to send from. Nothing in the repo texts anyone — `sms` ships with zero
   consumers — so this route exists only to give you something to `curl`. It is QA scaffolding and
   not part of any module. File-based route registration in `apps/api/src/index.ts` mounts it at
   `/qa-sms` with no other edit. Copy the whole block below, and keep the closing `EOF` at the
   start of its line — an indented `EOF` never ends the heredoc.

```sh
cat > apps/api/src/routes/qa-sms.ts <<'EOF'
import { Hono } from "hono";
import { createSms, measureSegments, SmsError } from "@repo/sms";
import { verificationCode } from "@repo/sms/templates/verification-code";

const qaSms = new Hono();

qaSms.post("/send", async (c) => {
  const texts = createSms(c.env as Record<string, unknown>);
  const result = await texts.send({
    to: c.req.query("to") ?? "+14155550123",
    ...verificationCode({ code: "123456", appName: "Acme", expiresInMinutes: 10 }),
  });
  return c.json({ provider: texts.provider, ...result });
});

qaSms.post("/bad-number", async (c) => {
  try {
    await createSms(c.env as Record<string, unknown>).send({ to: "415-555-0123", body: "hi" });
    return c.json({ threw: false });
  } catch (e) {
    const err = e as SmsError;
    return c.json({ name: err.name, code: err.code, retryable: err.retryable, message: err.message });
  }
});

qaSms.post("/alpha-from", async (c) => {
  const texts = createSms(c.env as Record<string, unknown>);
  return c.json(await texts.send({ to: "+447700900123", from: "ACME-UK", body: "Total: 12€ and a 🙂" }));
});

qaSms.get("/segments", (c) =>
  c.json({
    "160 plain": measureSegments("a".repeat(160)),
    "161 plain": measureSegments("a".repeat(161)),
    "80 tildes": measureSegments("~".repeat(80)),
    "81 tildes": measureSegments("~".repeat(81)),
    "160 tildes": measureSegments("~".repeat(160)),
    "escape straddle (152a + 20~)": measureSegments("a".repeat(152) + "~".repeat(20)),
    "one emoji": measureSegments("a".repeat(69) + "🙂"),
    "surrogate straddle (66a + 10 emoji)": measureSegments("a".repeat(66) + "🙂".repeat(10)),
  }),
);

export default qaSms;
EOF
```

7. Link the new workspace.

   ```sh
   pnpm install
   ```

8. Start the Worker. Leave it running for every case in this scenario.

   ```sh
   pnpm --filter @repo/api dev
   ```

   - [ ] The dev server starts and serves `$BASE_URL`. It needs no credentials of any kind.

- [ ] Setup complete

### TC-2.1 — The console log block reads right to an operator  ·  🟡 Normal

**Goal** — a developer tailing the Worker's log can read a sent message at a glance, and the
never-in-production warning lands hard enough to be obeyed.

**Steps**

1. Send the worked template.

   ```sh
   curl -s -X POST "$BASE_URL/qa-sms/send"
   ```

   - [ ] The response carries `"provider":"console"` and a `console-<uuid>` message id

2. Read the log block the Worker printed. Read it as if you were tailing production logs.

   - [ ] The block is scannable next to `email-console`'s — the same box-drawing shape, with a
     `segments:` row added
     - `message-id:`, `to:` and `segments:` each read at a glance
     - `from:` shows `ACME`, resolved from `SMS_FROM`
     - the body sits on its own line below a blank line
   - [ ] The `segments:` row is where someone would actually notice a body that quietly became
     three parts

3. Send a message with an alphanumeric sender and a non-GSM-7 body.

   ```sh
   curl -s -X POST "$BASE_URL/qa-sms/alpha-from"
   ```

   - [ ] The log shows `from: ACME-UK` untouched. The core validates `to` and never rewrites
     `from`.

4. Remove the default sender, then send again with no `from` anywhere.

   ```sh
   printf 'SMS_PROVIDER=console\n' > apps/api/.dev.vars
   ```

   ```sh
   curl -s -X POST "$BASE_URL/qa-sms/send"
   ```

   - [ ] The send succeeds and the log block omits the `from:` row entirely. Judge whether an
     absent `from:` reads as confusing or as correctly quiet for a pool-routed provider.

5. Restore the sender for the rest of the scenario.

   ```sh
   printf 'SMS_PROVIDER=console\nSMS_FROM=ACME\n' > apps/api/.dev.vars
   ```

6. Read `modules/sms/skills/saasaloy-sms/SKILL.md`, section `Local development` (line 197), and the
   header comment in `modules/sms-console/files/console.ts`.

   - [ ] The one-time-code-in-your-logs risk lands harder than email's equivalent warning, because
     the payload is a live second factor and not a link

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes**

### TC-2.2 — The env panel and the `saasaloy-sms` skill are usable without the plan  ·  🟢 Low

**Goal** — someone who has read only `saasaloy-email` can configure `sms` and write a provider for
it without getting `retryable` or the `from` asymmetry wrong.

**Steps**

1. Scroll back to the **Env vars to set** panel that setup step 3 printed.

   - [ ] The panel alone makes both facts obvious
     - `SMS_PROVIDER` has no default and must be set even with one provider installed
     - `SMS_FROM` is optional, *and why* — the requirement is per-provider configuration, not a
       property of the message

2. Read `modules/sms/skills/saasaloy-sms/SKILL.md` end to end, cold.

   - [ ] The `to` validated / `from` unvalidated asymmetry reads as a choice and not an oversight
   - [ ] Section `Segment counting` gives the real thresholds — 160/153 GSM-7 and 70/67 UCS-2 —
     and names the toll-free 152/66 inaccuracy
   - [ ] Section `Templates` explains why there is no `render.ts` counterpart to email's
   - [ ] Section `Not proven yet` names the same three contracts TC-1.1 reviewed

3. Read section `Writing a custom provider in your own project` (line 254) as someone about to
   write one.

   - [ ] The `retryable` inversion versus `@repo/email` is impossible to miss. It leads the section
     for that reason.
   - [ ] The section is enough to write a provider without opening `define.ts`

4. Judge as a human.

   - [ ] Someone who has read only `saasaloy-email` could not write an `sms` provider from this and
     still get `retryable` wrong

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes**

**Reset** — after every case above, before moving to Scenario 3.

1. Stop the Worker with Ctrl-C. Confirm no `workerd` process still holds port 4000.

2. Discard the playground, including the throwaway route and `.dev.vars`.

   ```sh
   pnpm run play:reset
   ```

## Scenario 3 — An account with a provider that reports its own segment count

You need a provider account that returns its own segment count. Twilio's
[test credentials](https://www.twilio.com/docs/iam/test-credentials) are free, need no purchased
number, and return `num_segments` on the Messages resource. The magic `From` and `To` are both
`+15005550006`.

Skip this scenario if you have no account, and record the skip in TC-3.1's **Notes**. It is the
one case on this branch that can be silently wrong in production and cost money.

**Setup** — once, for every case in this scenario.

1. Bring the playground and the Worker back up. Repeat Scenario 2's setup steps 1 through 8.

2. Export your Twilio test credentials.

   ```sh
   export TWILIO_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx && export TWILIO_TOKEN=your_test_auth_token
   ```

- [ ] Setup complete

### TC-3.1 — Segment estimates match a real provider's own count  ·  🔴 Critical

**Goal** — `estimatedSegments` agrees with the number a vendor actually bills from, for every case
except the documented toll-free one.

The arithmetic is verified against the GSM 03.38 specification, not against a vendor, and no
shipped provider reports a count to compare with. `sms-console` prints the estimate, so a wrong
estimate looks exactly like a right one.

**Steps**

1. Read this branch's own numbers.

   ```sh
   curl -s "$BASE_URL/qa-sms/segments"
   ```

   - [ ] Every row matches the table below

   | Body | Encoding | Units | Segments |
   |---|---|---|---|
   | 160 × `a` | `gsm-7` | 160 | 1 |
   | 161 × `a` | `gsm-7` | 161 | 2 |
   | 80 × `~` (160 septets — an extension character costs two) | `gsm-7` | 160 | 1 |
   | 81 × `~` | `gsm-7` | 162 | 2 |
   | 160 × `~` (320 septets) | `gsm-7` | 320 | **3** |
   | 152 × `a` then 20 × `~` (the escape pair cannot straddle 153) | `gsm-7` | 192 | 2 |
   | 69 × `a` + one emoji (UCS-2, 71 units) | `ucs-2` | 71 | 2 |
   | 66 × `a` + 10 emoji (a surrogate pair cannot straddle 67) | `ucs-2` | 86 | 2 |

2. Send the same body through the vendor and read back its own count. Run this once per row,
   replacing the `Body` value each time. The example below is the 81-tilde row.

   ```sh
   curl -s -X POST "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/Messages.json" -u "$TWILIO_SID:$TWILIO_TOKEN" --data-urlencode "From=+15005550006" --data-urlencode "To=+15005550006" --data-urlencode "Body=$(printf '~%.0s' $(seq 81))" | grep -o '"num_segments": *"[0-9]*"'
   ```

   - [ ] Every **non**-toll-free row's `num_segments` equals this branch's `segments`. Record any
     row that disagrees, with the body and both numbers, in **Notes**.

3. Repeat the longest row from a **toll-free** US or CA sender, if you have one.

   - [ ] The toll-free result differs by at most one segment on a long message, and it differs
     upward. A toll-free sender gets 152/66 per part instead of 153/67, and the core cannot know
     the sender type because it deliberately never parses `from`.

4. Confirm that difference is documented where someone would look for it.

   - [ ] Both places state the toll-free 152/66 caveat
     - `modules/sms/skills/saasaloy-sms/SKILL.md`, section `Segment counting`
     - the comment above `GSM7_PART` in `modules/sms/files/src/segments.ts`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _which provider you used, how many rows matched, and whether you tested toll-free_

**Reset** — after the case above.

1. Stop the Worker with Ctrl-C.

2. Discard the playground.

   ```sh
   pnpm run play:reset
   ```

## Automated verification (by AI agent)

_Checks the agent ran itself on 2026-08-09. No action is needed from the tester; they are listed
here for context and sign-off. Two sets are recorded below: the checks the implementation step ran
against a live playground and a live `wrangler dev` session, and the checks the QA step re-ran
against the shipped source. The playground was reset afterwards, so none of that state is on disk._

### Repo gate — recorded, not re-run

The gate ran green on this exact tree minutes before this plan was written. Re-running it produces
the same answer at full price, so the QA step did not repeat it.

```sh
pnpm test && pnpm typecheck && pnpm build && pnpm lint
```

- ✅ `pnpm test` — **121 tests** across 10 files, green.
- ✅ `pnpm typecheck` — `typecheck:scripts` plus `turbo run typecheck`, clean.
- ✅ `pnpm build` — `tsup` in `packages/cli`, success. `packages/cli/dist/index.js` is on disk.
- ✅ `pnpm lint` — no package declares a `lint` script (linter adoption is #71); vacuously green.
- ✅ `pnpm deps:verify` — `play:init` → install → build → `verify-css` → typecheck, clean.
- ⚠️ `pnpm deps:check` fails, and fails identically on `main` — see
  [Known states](#known-states--do-not-report-these-as-failures).

### Install, scaffold, and the patch

```sh
pnpm run play:reset && cd .dev/playground && ./saasaloy add sms --yes
```

- ✅ **Resolution:** `api → sms` from one command on a clean project — 16 files.
- ✅ **Scaffold:** `packages/sms/{package.json,tsconfig.json}` and
  `src/{index,define,provider,segments}.ts`, `src/templates/verification-code.ts`,
  `src/providers/.gitkeep`. The alias `@sms → packages/sms/src` is registered.
- ✅ **Env panel** printed both variables with their prose descriptions.
- ✅ **Skill:** `.agents/skills/saasaloy-sms/SKILL.md` created, and symlinked at
  `.claude/skills/saasaloy-sms` next to the existing `saasaloy-api` one.
- ✅ `apps/api/package.json` gained `"@repo/sms": "workspace:*"`, with `hono`, `zod` and
  `@hono/zod-validator` intact.
- ❗ `./saasaloy add sms sms-console` is **rejected**: `Unknown argument(s): sms-console`. The CLI
  takes one module per invocation. This is the plan document's shorthand, not a defect in this
  branch.

```sh
cd .dev/playground && ./saasaloy add sms-console --yes
```

- ✅ `packages/sms/src/providers/console.ts` written. `packages/sms/src/index.ts` patched to
  `export const sms = defineSms({ providers: [consoleSms()] });`, with the import prepended and
  every surrounding comment — including the "keep this line in exactly this shape" warning —
  unchanged.

### Idempotency

```sh
cd .dev/playground && ./saasaloy add sms-console --yes
```

```sh
cd .dev/playground && ./saasaloy add sms-console --yes --force
```

- ✅ Second run: `Nothing to do — sms-console and its dependencies are already installed.`
- ✅ Third run, forced: `unchanged packages/sms/src/providers/console.ts`, and `md5sum -c` over
  `packages/sms/src/index.ts` reports `OK` — byte-identical. Exactly one `consoleSms()` sits in the
  array. This is issue #67's idempotency acceptance criterion.

### Install, typecheck, build in the playground

```sh
cd .dev/playground && pnpm install && pnpm exec turbo run typecheck build --force
```

- ✅ `pnpm install` linked `@repo/sms` into the workspace.
- ✅ `turbo run typecheck build --force` → **5 tasks successful** across `@repo/api`, `@repo/sms`,
  `@repo/ui` and `@repo/web`.
- ✅ **Zero runtime dependencies** — `packages/sms/package.json` `dependencies` is `{}`, and
  `@cloudflare/workers-types` is a devDependency only.
- ✅ The throwaway `qa-sms.ts` route typechecks against the package's public exports (`createSms`,
  `measureSegments`, `SmsError`, and `@repo/sms/templates/verification-code`), which is what proves
  the `exports` map covers the `./templates/*` subpath.
- ✅ Re-verified by the QA step against the shipped `provider.ts`: passing
  `c.env as Record<string, unknown>` into `createSms(env: SmsEnv)` typechecks under `--strict`, so
  Scenario 2's setup step 6 compiles as written.

### Live Worker — `SMS_PROVIDER=console`

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

```sh
curl -s -X POST "$BASE_URL/qa-sms/send"
```

- ✅ Response: `{"provider":"console","messageId":"console-0ceb4c1e-1c5a-41bf-85d7-ba3508cab662"}`,
  and this in the Worker log, verbatim:

  ```text
  ───── sms (console provider) ─────
  message-id: console-0ceb4c1e-1c5a-41bf-85d7-ba3508cab662
  from:       ACME
  to:         +14155550123
  segments:   1

  123456 is your Acme verification code. It expires in 10 minutes. Never share it with anyone.
  ──────────────────────────────────
  ```

- ✅ The worked template fits **one GSM-7 segment** with a real app name in it — 92 septets,
  re-measured by the QA step — which was the point of choosing a verification code as the example.

### Live Worker — validation, selection, and the sender asymmetry

```sh
curl -s -X POST "$BASE_URL/qa-sms/bad-number"
```

```sh
curl -s -X POST "$BASE_URL/qa-sms/alpha-from"
```

- ✅ **Non-E.164 recipient** (`415-555-0123`) → an `SmsError` thrown before any provider is
  reached, `code: "invalid_message"`, `retryable: false`:

  ```text
  "415-555-0123" is not an E.164 number. Recipients must be written as a "+", the country code
  and the national number, digits only — e.g. "+14155550123". This package validates the shape
  and never rewrites it; normalize before you call it.
  ```

- ✅ **Alphanumeric `from`** (`ACME-UK`) passed through untouched to the provider and reached the
  log. The `to`-validated / `from`-unvalidated asymmetry works as designed.
- ✅ **`from` absent entirely** (no `SMS_FROM`, no per-message `from`) → the send succeeds and the
  `from:` row is omitted from the log block. This is the optional-sender contract; nothing shipped
  raises "I need a sender" (TC-1.1).
- ✅ **`SMS_PROVIDER` unset** → `SMS_PROVIDER is not set. Registered providers: console.`
- ✅ **`SMS_PROVIDER` unknown** (`twilio`) →
  `SMS_PROVIDER is "twilio", which is not registered. Registered providers: console.` Both throw at
  `createSms(env)`, before any transport is touched. There is no silent fallback in either
  direction.
- ✅ **Empty body** → `SmsError` `invalid_message`: `Empty body: there is nothing to send.`

### Segment arithmetic

Measured through `/qa-sms/segments` on the live Worker, then re-measured by the QA step by
executing the shipped `modules/sms/files/src/segments.ts` directly. Both runs agree.

```sh
curl -s "$BASE_URL/qa-sms/segments"
```

| Body | Encoding | Units | Segments |
|---|---|---|---|
| 160 × `a` | `gsm-7` | 160 | **1** |
| 161 × `a` | `gsm-7` | 161 | **2** |
| 80 × `~` | `gsm-7` | 160 | **1** |
| 81 × `~` | `gsm-7` | 162 | **2** |
| 160 × `~` | `gsm-7` | 320 | **3** |
| 152 × `a` + 20 × `~` | `gsm-7` | 192 | **2** |
| 69 × `a` + one emoji | `ucs-2` | 71 | **2** |
| 66 × `a` + 10 emoji | `ucs-2` | 86 | **2** |

- ✅ **Extension characters cost two septets.** 80 tildes is 160 septets and still one segment; 81
  is two. A length-only estimate would have said one for both.
- ✅ **`€` stays GSM-7.** Measured directly: `Total: 12€` → `gsm-7`, 11 units (the euro sign costs
  two), 1 segment.
- ✅ **One emoji re-encodes the whole message.** 69 × `a` plus one emoji → `ucs-2`, 71 units, 2
  segments — one past the 70-character single-message budget.
- ✅ **Neither pair straddles a boundary.** 152 × `a` + 20 × `~` is 192 septets: the escape pair
  that would start at septet 153 moves whole into segment 2 and leaves one septet unused. 153
  tildes is 306 septets and **3** segments, which `ceil(306/153) = 2` would have got wrong — that
  case is the one the packing loop exists for.
- ✅ **The doc examples in `segments.ts` are correct as shipped.** `measureSegments("Your code is
  123456 ✅")` returns `ucs-2`, **21** units, 1 segment. Commit `d25ab57` corrected an earlier
  `22 units` in that comment; the QA step re-measured and confirms 21.
- ⚠️ **The plan document's "160 tildes → 2"** (plan line 132) is an arithmetic slip in the plan's
  example, not a threshold disagreement. 160 tildes is 320 septets, which is 3 segments of 153
  under the plan's own stated thresholds. The implementation follows the thresholds and reports 3.
  The case most likely intended — 160 characters, one of them a tilde → 161 septets → 2 segments —
  is verified too.

### `retryable` coercion

Re-run by the QA step against the shipped `modules/sms/files/src/provider.ts`, over the whole error
union rather than a sample:

- ✅ `new SmsError(code, "x", { retryable: true }).retryable` is `true` for **`rate_limited`** and
  **`provider_error`** only.
- ✅ It is coerced to `false` for `invalid_number`, `unroutable`, `opted_out`, `account_error`,
  `message_too_long` and `invalid_message`.
- ✅ Omitting the option defaults to `false`, and `name` is `"SmsError"` on every code.
- ✅ No code throws. A constructor that threw would replace a provider's real failure with a second
  error about the error constructor, which is why the coercion is silent and commented.

### Regression

- ✅ `./saasaloy add sms-console` alone into a clean playground pulls `api → sms` in first,
  scaffolds `packages/sms`, and registers `consoleSms()`. The alias `@sms` is contributed by a
  *different* module in the same run, and the provider's file target still resolves.
- ✅ `apps/api/package.json` keeps `hono`, `zod` and `@hono/zod-validator` after the
  `package-json-dependency` patch adds `@repo/sms`.
- ✅ `apps/api/wrangler.jsonc` is untouched. `sms` patches no binding, because there is no
  Cloudflare SMS product to bind to.
- ✅ `GET /health` still answers `200 {"status":"ok"}` with `sms` installed.
- ✅ `packages/cli` test suite: 121 tests green, unchanged. This issue ships no CLI, schema or
  patch-engine change.
- ✅ `pnpm --filter @repo/api dev` starts with no credentials of any kind (`VITE ready in 5079 ms`).
  Nothing in this capability opens a remote proxy session, unlike `email-cloudflare`.
- ✅ `@repo/email` is unaffected: no shared file, no shared type, no import in either direction.

### Cleanup

```sh
pnpm run play:reset
```

- ✅ Every dev server and `workerd` process stopped, port 4000 closed, playground reset. No QA
  scaffolding, `.dev.vars` or `.wrangler` state was left behind. The QA step ran no destructive
  command of its own and left the playground as it found it — scaffolded, with no module added.

## Not covered / needs human judgment

- **A real send.** There is no real provider in this issue; `sms-twilio` is the follow-up. Nothing
  here proves a message reaches a handset, and nothing here claims to.
- **Segment counts against a vendor's billing (TC-3.1).** The arithmetic is verified against the
  specification, not against an invoice. The agent has no provider account, so this is the one
  critical case it could not touch.
- **Whether Twilio's test credentials report an accurate `num_segments`.** TC-3.1 assumes they do.
  If a test-credential response returns `num_segments: 0` or omits it, repeat the case against live
  credentials and record that in **Notes**.
- **Toll-free senders.** The 152/66 case needs sender-type knowledge the core does not have. It is
  documented as a known inaccuracy and deliberately not modelled.
- **The three unexercised contracts (TC-1.1)** — optional `from`, `account_error`,
  `message_too_long`. Named in the plan and in the skill; the first real provider exercises them.
- **The error-code union against real vendor errors.** `invalid_number`, `unroutable`, `opted_out`
  and `account_error` are shaped from Twilio's documented codes (21211, 21612, 21610, 21408), but
  no mapping table exists yet to be wrong.
- **`waitUntil()` and the retry guidance.** Documented in `saasaloy-sms` and never run: nothing in
  the repo sends an SMS, so the critical-versus-non-critical shapes are prose and not code under
  test.
- **Consent, STOP and quiet hours.** Explicit non-goals. TC-1.2 checks the documentation, not a
  behavior.
- **Concurrency and volume.** No burst sending, no simultaneous `createSms` calls, no rate-limit
  behavior. `rate_limited` is unexercised for the same reason `account_error` is.
- **Accessibility, compatibility and performance dimensions.** This change ships no UI and no user
  input path. `packages/sms` is a Worker-side library with zero runtime dependencies, so there is
  no browser, no layout and no realistic volume to measure. Skipped on purpose.
- **`saasaloy doctor` checks** (#47) for `SMS_PROVIDER` set and matching a registered provider. Not
  built, so a misconfiguration surfaces at first send rather than at install.
- **Wiring `auth` for phone 2FA.** Needs a Better Auth plugin this repo does not install. Its own
  issue.
