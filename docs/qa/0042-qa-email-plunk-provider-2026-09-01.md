# QA Plan: `email-plunk` provider module

_Generated 2026-09-01 · against `108886e` · covers branch `issue-65-plunk-provider-module` (issue #65)_

## Summary

- `saasaloy add email-plunk` drops one provider file into `packages/email/src/providers/` and registers `plunk()` in the `providers` array. The provider sends through Plunk's HTTP API with the `sk_` secret key. It adds no npm dependency.
- "Working" means: a real transactional email leaves the playground through Plunk, the response carries a message id, and every misconfiguration surfaces as a clear `EmailError` with no leaked key.

**Split of work in this document.** Install, idempotency, the registration patch, and the typecheck are already verified; see [Automated verification](#automated-verification-by-ai-agent). What is left for a human needs a real Plunk account: the end-to-end send, the unverified-sender probe, the inbox and dashboard judgments, and the misconfiguration errors.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch `issue-65-plunk-provider-module`, checked out in this worktree. Every path is relative to the worktree root.
- Run all `saasaloy` commands from `.dev/playground` per `AGENTS.md`.
- A Plunk account with one verified sender identity and its `sk_...` secret key. Get both from the Plunk dashboard under Project settings → API keys and Verified senders.
- The agent already built the playground and installed `email-plunk` (see Automated verification). Reset only if you want a fresh start:

```sh
pnpm run play:reset && cd .dev/playground && ./saasaloy add email-plunk --yes && pnpm install
```

Drop a throwaway send route into the playground. It is QA scaffolding, not part of the module. The file-based route registration mounts it at `/qa-email`:

```sh
cat > .dev/playground/apps/api/src/routes/qa-email.ts <<'EOF'
import { Hono } from "hono";
import { createEmail } from "@repo/email";
import { welcome } from "@repo/email/templates/welcome";

const qaEmail = new Hono();

qaEmail.post("/send", async (c) => {
  const mail = createEmail(c.env as Record<string, unknown>);
  const result = await mail.send({
    to: c.req.query("to") ?? "you@example.com",
    ...(c.req.query("from") ? { from: c.req.query("from") } : {}),
    ...(c.req.query("replyTo") ? { replyTo: c.req.query("replyTo") } : {}),
    ...welcome({ name: "Ada", appName: "Acme", ctaUrl: "https://app.acme.test/start" }),
  });
  return c.json({ provider: mail.provider, ...result });
});

export default qaEmail;
EOF
```

Export the base URL the rest of this document uses:

```sh
export BASE_URL=http://localhost:4000
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: real `sk_` key, verified sender | End-to-end send returns a message id | 🔴 Critical |
| TC-1.2 | 1: real `sk_` key, verified sender | The delivered message reads correctly in a real inbox | 🟡 Normal |
| TC-1.3 | 1: real `sk_` key, verified sender | Every send upserts the recipient as a Plunk contact | 🟡 Normal |
| TC-1.4 | 1: real `sk_` key, verified sender | Unverified-sender probe: record the real rejection | 🔴 Critical |
| TC-2.1 | 2: broken configuration | The `pk_` public key fails as a clear, non-retryable error | 🟡 Normal |
| TC-2.2 | 2: broken configuration | A missing key throws before any request leaves | 🟡 Normal |
| TC-2.3 | 2: broken configuration | A wrong `PLUNK_API_URL` fails as a clear error | 🟢 Low |

## Scenario 1: real `sk_` key, verified sender

**Setup.** Run once, for every case in this scenario.

1. Write the env vars with your real values. Use your verified sender for `EMAIL_FROM` and your real `sk_` key:

```sh
printf 'EMAIL_PROVIDER=plunk\nEMAIL_FROM=you@your-verified-domain.example\nPLUNK_API_KEY=sk_your_real_key\n' > .dev/playground/apps/api/.dev.vars
```

2. Start the API dev server in a second terminal:

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

- [ ] Setup complete

### TC-1.1: End-to-end send returns a message id  ·  🔴 Critical

**Goal.** A real email leaves through Plunk's hosted API, which also proves the base URL `https://next-api.useplunk.com` and the response shape are right.

**Steps**

1. Send to an inbox you own:

   ```sh
   curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/qa-email/send?to=you@example.com"
   ```

   - [ ] The status is 200, the body carries `"provider": "plunk"` and a non-empty `messageId` string

2. Open the Plunk dashboard and find the send in the email log.
   - [ ] The dashboard lists the send with the same recipient

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The delivered message reads correctly in a real inbox  ·  🟡 Normal

**Goal.** The HTML body survives delivery. Plunk has no plaintext field, so the message is HTML-only.

**Steps**

1. Open the message from TC-1.1 in your inbox.
   - [ ] The welcome template renders: the name, the app name, and the CTA link all show and the link points at the CTA URL
   - [ ] The sender and subject are the expected ones, and the message is not in spam

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: Every send upserts the recipient as a Plunk contact  ·  🟡 Normal

**Goal.** The documented contact upsert happens, and the new contact is not subscribed. The payload omits `subscribed` on purpose.

**Steps**

1. Open the Plunk dashboard → Contacts and find the recipient from TC-1.1.
   - [ ] The recipient exists as a contact and shows as not subscribed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.4: Unverified-sender probe: record the real rejection  ·  🔴 Critical

**Goal.** Capture the status and provider code Plunk returns for an unverified sender. Issue #65 needs this recorded on the PR, and the code's `ERROR_CODES` table waits for this row.

**Steps**

1. Send with a `from` on a domain you have not verified in Plunk:

   ```sh
   curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/qa-email/send?to=you@example.com&from=nobody@unverified-domain.example"
   ```

   - [ ] The send fails, and the error message names the sender problem clearly
2. Copy the full response body into **Notes**, including the HTTP status and any `providerCode`.
   - [ ] The status and provider code are recorded in Notes for the PR

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _paste the rejection body, status, and provider code here_

**Reset.** Stop the dev server before Scenario 2. No data reset is needed; Scenario 2 only edits `.dev.vars`.

## Scenario 2: broken configuration

**Setup.** Run once, for every case in this scenario. Each case rewrites `.dev.vars` and restarts the dev server, so keep the server terminal at hand.

- [ ] Setup complete

### TC-2.1: The `pk_` public key fails as a clear, non-retryable error  ·  🟡 Normal

**Goal.** The most likely operator mistake, the public key in place of the secret key, produces a message that names the fix.

**Steps**

1. Put the `pk_` public key in `.dev.vars` and restart the dev server:

   ```sh
   printf 'EMAIL_PROVIDER=plunk\nEMAIL_FROM=you@your-verified-domain.example\nPLUNK_API_KEY=pk_your_public_key\n' > .dev/playground/apps/api/.dev.vars
   ```

2. Send:

   ```sh
   curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/qa-email/send?to=you@example.com"
   ```

   - [ ] The send fails with a `provider_error`, and the message is readable, not a raw stack trace
   - [ ] No part of the key appears in the response or in the server log

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.2: A missing key throws before any request leaves  ·  🟡 Normal

**Goal.** With no `PLUNK_API_KEY`, the provider throws its own guidance and never calls the network.

**Steps**

1. Remove the key and restart the dev server:

   ```sh
   printf 'EMAIL_PROVIDER=plunk\nEMAIL_FROM=you@your-verified-domain.example\n' > .dev/playground/apps/api/.dev.vars
   ```

2. Send:

   ```sh
   curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/qa-email/send?to=you@example.com"
   ```

   - [ ] The error message names `PLUNK_API_KEY`, `.dev.vars`, `wrangler secret put`, and the `sk_` vs `pk_` distinction

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-2.3: A wrong `PLUNK_API_URL` fails as a clear error  ·  🟢 Low

**Goal.** A bad base URL for a self-hosted instance surfaces as an `EmailError`, not a hang or a crash.

**Steps**

1. Point the URL at a wrong host, restore the real key, and restart the dev server:

   ```sh
   printf 'EMAIL_PROVIDER=plunk\nEMAIL_FROM=you@your-verified-domain.example\nPLUNK_API_KEY=sk_your_real_key\nPLUNK_API_URL=https://plunk.invalid\n' > .dev/playground/apps/api/.dev.vars
   ```

2. Send:

   ```sh
   curl -s -w '\n%{http_code}\n' -X POST "$BASE_URL/qa-email/send?to=you@example.com"
   ```

   - [ ] The send fails within about 10 seconds with a readable `provider_error`, not an unbounded hang

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Stop the dev server. Restore `.dev.vars` to the Scenario 1 values if you keep testing.

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block):

```sh
pnpm lint
```

```sh
pnpm test
```

```sh
pnpm build
```

```sh
pnpm run play:reset
```

```sh
cd .dev/playground && ./saasaloy add email-plunk --yes
```

```sh
cd .dev/playground && ./saasaloy add email-plunk --yes   # second run, idempotency
```

```sh
cd .dev/playground && pnpm install && pnpm --filter @repo/email exec tsc --noEmit
```

- ✅ `pnpm lint` → all four passes green (oxlint type-aware, oxlint plain, Stylelint, Prettier)
- ✅ `pnpm test` → 15 tests, 0 failures
- ✅ `pnpm build` → turbo build green
- ✅ `saasaloy add email-plunk` → applied `logger, logger-console, api, email, email-plunk` (26 files); `packages/email/src/providers/plunk.ts` exists; `src/index.ts` carries one `plunk` import and one `plunk()` call in `providers`
- ✅ second `saasaloy add email-plunk` → no-op, prints `use --force to re-apply`; still one import and one call, no duplicate file
- ✅ `tsc --noEmit` on `@repo/email` in the playground → clean

The playground is left in place with `email-plunk` installed, ready for Scenario 1.

## Not covered / needs human judgment

- Everything behind a real Plunk account: the send, the inbox rendering, the contact upsert, and the unverified-sender code. This box has no browser and no Plunk credentials.
- The `429` and `413` mappings. Provoking a real rate limit or an oversized payload against the hosted API is not practical here; the mapping logic is covered by the module's unit-level behavior only.
- Concurrency and double-send. Plunk takes no idempotency key, and the code documents that a retry can double-send; there is no observable to test beyond that documentation.
- Compatibility, accessibility, and performance do not apply. The module has no UI and one bounded HTTP call.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
