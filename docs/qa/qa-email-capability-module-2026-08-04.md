# QA Plan: `email` capability module + `email-cloudflare` / `email-console` providers

_Generated 2026-08-04 · covers `issue-15-email-capability-module` vs `main` (11 commits, issue #15)_

## Summary

- `saasaloy add email` scaffolds `packages/email` (`@repo/email`, alias `@email`) — a
  provider-agnostic sender with a template convention, an escaping `html` tag, derived plaintext,
  a normalized `EmailError`, and a **provider registry** with zero runtime dependencies. Each
  provider ships as its own module: `email-cloudflare` (Worker `send_email` binding) and
  `email-console` (dev). Both drop one file into `packages/email/src/providers/` and append
  themselves to the `providers` array in `src/index.ts` via a `plugin-array` patch.
- "Working" means: the scaffold and both providers install and re-install idempotently; a caller
  imports `@repo/email`, calls `createEmail(env)`, and never learns which provider is active;
  `EMAIL_PROVIDER=console` renders a message with no Cloudflare account at all; and a real
  transactional email leaves a Worker through Cloudflare Email Sending.

**Split of work in this document.** Everything a script can decide — install, idempotency,
patches, provider selection, escaping, derived plaintext, error normalization, typecheck, build —
the agent already ran; see [Automated verification](#automated-verification-by-ai-agent) for the
observed output. What is left for a human is the part no CLI can reach: **[TC-1](#tc-1--real-cloudflare-send-operator-runbook----critical)**,
a real send through a dashboard-onboarded domain, plus the inbox and copy judgments that follow
from it.

> **Resolved 2026-08-05 — the binding now ships `remote: false`.** As originally written
> (`remote: true`) installing `email-cloudflare` broke `pnpm --filter @repo/api dev` on any machine
> without a Cloudflare API token, because `@cloudflare/vite-plugin` opens a remote proxy session at
> startup for any remote binding. The descriptor now ships `remote: false`, and the
> `saasaloy-email` skill documents flipping it to `true` for a live dev send — see
> [TC-4](#tc-4--the-remote-true-vite-dev-decision----critical) for the decision and
> [the finding](#finding-remote-true-breaks-the-vite-dev-loop) for the original evidence.

## Preconditions

- Branch `issue-15-email-capability-module`, checked out in a worktree of this repo. Every path
  below is relative to that worktree's root.
- Run all `saasaloy` commands from `.dev/playground` per `AGENTS.md` — never a globally linked CLI.
  The `./saasaloy` shim in that directory points the freshly built CLI at **this worktree's**
  `modules/` registry.
- **Start from a clean playground.** A leftover `apps/api/.dev.vars` from an earlier case carries
  an `EMAIL_PROVIDER` that silently invalidates the selection expectations below.

Reset to a clean, unlinked workspace:

```sh
pnpm run play:reset
```

Scaffold the capability plus the Cloudflare provider (pulls in `api` and `email` automatically):

```sh
cd .dev/playground && ./saasaloy add email-cloudflare --yes
```

Add the dev provider alongside it — both can be registered at once, `EMAIL_PROVIDER` picks:

```sh
cd .dev/playground && ./saasaloy add email-console --yes
```

Install:

```sh
cd .dev/playground && pnpm install
```

### Env vars

`add email` prints both. Put them in `apps/api/.dev.vars` for local runs:

```sh
printf 'EMAIL_PROVIDER=cloudflare\nEMAIL_FROM=hello@your-onboarded-domain.example\n' > .dev/playground/apps/api/.dev.vars
```

| Var | What | Required |
|---|---|---|
| `EMAIL_PROVIDER` | Which registered provider sends: `cloudflare`, `console` | **Always** — no default, by design |
| `EMAIL_FROM` | Default sender, on a domain the provider may send from | Unless every message passes its own `from` |

### A route to send from

Nothing in the repo sends mail yet — `waitlist` and `auth` wiring is deferred to the
optional-dependency issue. Drop this throwaway route into the playground so there is something to
`curl`; it is QA scaffolding, not part of any module. The file-based route registration in
`apps/api/src/index.ts` mounts it at `/qa-email` with no other edit.

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

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Test case | Priority |
|------|-----------|----------|
| TC-1 | Real Cloudflare send (operator runbook) | 🔴 Critical |
| TC-2 | The delivered message renders in real inboxes | 🟡 Normal |
| TC-3 | Sending from a non-onboarded domain fails as `sender_not_verified` | 🟡 Normal |
| TC-4 | The `remote: true` / Vite dev decision — **decided, verify it holds** | 🔴 Critical |
| TC-5 | The env panel and the `saasaloy-email` skill are usable without the plan | 🟢 Low |

Everything else — install ordering, both patch kinds, idempotency, provider selection and its two
error branches, sender/recipient validation, HTML escaping, derived plaintext, the missing-binding
`EmailError`, zero runtime deps, typecheck and build — is covered in
[Automated verification](#automated-verification-by-ai-agent) and needs nothing from you.

## Test cases

### TC-1 — Real Cloudflare send (operator runbook)  ·  🔴 Critical

This is issue #15's AC 2 and the one thing on this branch that **cannot** be automated here. It
needs a Workers **paid plan** and a sending domain onboarded through the Cloudflare **dashboard** —
a browser step, on a box that has no browser. The agent did not attempt it and has not guessed at
its result. Fill in the blanks at the bottom yourself.

**Pick a domain first.** `saasaloy.dev` **does not resolve in DNS** (#46), so it cannot be
onboarded and cannot be the sender. Use some other domain already on your Cloudflare account and
already using Cloudflare DNS. The module never hardcodes a domain, and it deliberately leaves
`allowed_sender_addresses` unset, so nothing here assumes a particular one.

**Steps**

1. **Confirm the plan.** Cloudflare dashboard → **Workers & Pages** → **Plans**. Email Sending is
   not on the free tier; the account must be on Workers Paid.
2. **Onboard the sending domain.** Dashboard → **Compute** → **Email Service** → **Email Sending**
   → **Add domain**. Pick the domain from above. Cloudflare adds SPF, DKIM and DMARC records plus
   a `cf-bounce` subdomain automatically. Wait until the domain shows as verified — DNS propagation
   is minutes, not instant.
3. **Authenticate the CLI** on the machine that will run the Worker:

```sh
cd .dev/playground/apps/api && pnpm exec wrangler login
```

   On a headless box, set a token instead — Workers Scripts:Edit is enough:

```sh
export CLOUDFLARE_API_TOKEN=<your token>
```

4. **Point `EMAIL_FROM` at the onboarded domain.** Any other domain fails
   `sender_not_verified` (that's TC-3).

```sh
printf 'EMAIL_PROVIDER=cloudflare\nEMAIL_FROM=hello@your-onboarded-domain.example\n' > .dev/playground/apps/api/.dev.vars
```

5. **Confirm the binding landed, then flip it to `remote: true`.** The module ships
   `remote: false` (TC-4), so out of the box `wrangler dev` uses miniflare's local stub and nothing
   is sent. `remote: true` is what makes it call the real Email Sending API, so mail genuinely
   leaves your machine — the only way to prove the path end to end.

```sh
cat .dev/playground/apps/api/wrangler.jsonc
```

   Expect a `send_email` array holding `{ "name": "EMAIL", "remote": false }`. Edit that one key
   to `true` for the rest of this test case, and set it back afterwards — leaving it on will stop
   `pnpm --filter @repo/api dev` from starting on any machine without Cloudflare credentials.

6. **Run the Worker under `wrangler dev`** — not the Vite loop, see TC-4:

```sh
cd .dev/playground/apps/api && pnpm exec wrangler dev --persist-to ./.wrangler/state
```

7. **Send to an inbox you control:**

```sh
curl -s -X POST "$BASE_URL/qa-email/send?to=you@example.com" -w '\n%{http_code}\n'
```

**Expected**

- The response is `200` with `{"provider":"cloudflare","messageId":"…"}` — a real Cloudflare
  message id, not the `console-<uuid>` shape the dev provider returns.
- The message arrives in the target inbox within a minute or two.
- The `From` header is the `EMAIL_FROM` address on the onboarded domain.
- No `EmailError` in the Worker log.

**Actual** — _operator fills in; do not pre-fill these:_

| Field | Value |
|---|---|
| Date of send | |
| Sending domain (onboarded) | |
| `EMAIL_FROM` | |
| Recipient inbox | |
| Returned `messageId` | |
| Received? (yes / no) | |
| Time to delivery | |
| Notes | |

- [ ] Pass
- [ ] Fail

### TC-2 — The delivered message renders in real inboxes  ·  🟡 Normal

Only possible once TC-1 has actually delivered something. The layout is hand-written inline-styled
HTML with no rendering framework behind it, and email clients are the only judge of that.

**Steps**

1. Open the message delivered in TC-1 in at least two clients — e.g. Gmail web and one mobile mail
   app.
2. Check the preview line in the inbox list before opening it.
3. Switch the client to dark mode if it has one.
4. View the plaintext alternative (Gmail: **Show original**, or read it on a text-only client).

**Expected**

- Single centred column, readable at mobile width, nothing overflowing horizontally.
- The inbox preview line reads "Your Acme account is ready." — the `preheader`, not the first
  line of the body repeated.
- The preheader span is **invisible** inside the opened message.
- The CTA renders as a dark button with white text and links to the `ctaUrl`.
- In dark mode the text stays legible (the layout sets a light background and dark text; judge
  whether any client inverts it into something unreadable).
- The plaintext part is present, is not the HTML source, and keeps the CTA's destination as
  `Open Acme (https://…)`.

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

### TC-3 — Sending from a non-onboarded domain fails as `sender_not_verified`  ·  🟡 Normal

The provider maps Cloudflare's runtime error codes onto the normalized `EmailErrorCode` union, and
those codes appear nowhere in `@cloudflare/workers-types` — the mapping table in
`modules/email-cloudflare/files/cloudflare.ts` was written from documentation, so a live rejection
is the only thing that confirms `E_SENDER_NOT_VERIFIED` is the string Cloudflare actually throws.

**Steps**

1. With `wrangler dev` still running from TC-1, change `EMAIL_FROM` to an address on a domain that
   is **not** onboarded, and restart the Worker:

```sh
printf 'EMAIL_PROVIDER=cloudflare\nEMAIL_FROM=hello@not-onboarded.example\n' > .dev/playground/apps/api/.dev.vars
```

2. Send again:

```sh
curl -s -X POST "$BASE_URL/qa-email/send?to=you@example.com" -w '\n%{http_code}\n'
```

3. Read the Worker log for the thrown error.

**Expected**

- The send fails rather than silently succeeding.
- The thrown error is an `EmailError` with `code: "sender_not_verified"` and `retryable: false`.
- `providerCode` holds Cloudflare's raw string. **Record it** — if it is not
  `E_SENDER_NOT_VERIFIED`, the mapping table needs a row and the error degrades to
  `provider_error` today.
- Nothing arrives in the recipient inbox.

**Actual:** _(tester fills in — include the observed `providerCode`)_

- [ ] Pass
- [ ] Fail

### TC-4 — The `remote: true` / Vite dev decision  ·  🔴 Critical

**Decided 2026-08-05: ship `remote: false` and document the flip.** What follows is the reasoning
and then a short check that the decision actually holds on your machine.

The problem, reproduced by the agent with output quoted in
[the finding below](#finding-remote-true-breaks-the-vite-dev-loop): with the binding written
`remote: true`, `pnpm --filter @repo/api dev` refused to start on a machine with no Cloudflare
credentials — even for a developer using `EMAIL_PROVIDER=console` who never touches the binding.
`@cloudflare/vite-plugin` opens a remote proxy session for any remote binding before provider
selection happens, so `console` offers no exemption. `wrangler dev` was unaffected.

The four options weighed, and why the second won:

- **Ship as-is** — the runbook already says to authenticate. Rejected: a module that breaks
  `pnpm dev` on install is a bad default, and the error names API tokens, never email.
- **Ship `remote: false`, document the flip** ✅ **chosen.** The dev loop works on install with no
  credentials. The live send stays reachable as a documented one-key edit.
- **Ship as-is + document the failure** — rejected as strictly worse than the above: it makes a
  broken default merely recognizable rather than fixing it.
- **File a follow-up** against #47 (`saasaloy doctor`) — rejected as the *only* action, since it
  ships the bad default anyway. Still worth doing on its own merits; see below.

**Cost accepted:** a real dev send is no longer the default path, so the plan's Phase 5 AC 2 (and
plan line 172) are amended to make the flip an explicit runbook step — TC-1 step 5 now carries it.
A weaker default was judged the right trade because the evidence for `remote: true`'s benefit is
itself unproven: under `wrangler dev` in local mode the agent observed the `EMAIL` binding **not
listed at all**, so TC-1 remains the only thing that can confirm the live path works either way.

**Applied in:** `modules/email-cloudflare/registry-item.json` (the binding) and
`modules/email/skills/saasaloy-email/SKILL.md` (§ Sending for real from dev — the flip, plus the
verbatim startup error so it is recognizable if someone leaves it on).

**Steps**

1. Install and start the Vite dev loop:

```sh
pnpm run play:reset && cd .dev/playground && ./saasaloy add email-cloudflare --yes && pnpm install && pnpm --filter @repo/api dev
```

2. Flip `"remote"` to `true` in `apps/api/wrangler.jsonc` and run the same dev command again.
   **Step 2's outcome depends on your credentials** — see below.

**Expected**

- **Step 1: the dev server starts, unconditionally** — `➜  Local: http://localhost:4000/`, with no
  `⎔ Establishing remote connection...` line. This holds whether or not you have Cloudflare
  credentials, and it is the entire point of the decision. Re-check it if the binding is ever
  changed back.
- **Step 2 depends on whether Cloudflare credentials are reachable**, which is the subtlety worth
  understanding:
  - **No credentials at all** — no `CLOUDFLARE_API_TOKEN` *and* no prior `wrangler login` — the
    dev server **fails** with the `Failed to start the remote proxy session` error quoted in the
    finding. This is the case the shipped default protects.
  - **Credentials present** — including a `wrangler login` performed at any time in the past,
    which persists in `~/.config/.wrangler/` and is easy to forget about — the dev server prints
    `⎔ Establishing remote connection...` and then **starts normally**, just slower (~14s vs ~3s
    observed).

  So a "it works fine for me" report on step 2 does not contradict the finding; it means the
  reporter is authenticated. `CLOUDFLARE_API_TOKEN` being unset is *not* sufficient to reproduce
  the failure.

**Actual (2026-08-05, on a machine with a prior `wrangler login`):**

- ✅ Step 1 — `VITE v8.1.5 ready in 2960 ms`, `➜  Local: http://localhost:4000/`, no remote
  connection attempted. The regression the decision buys is confirmed.
- ✅ Step 2 — `⎔ Establishing remote connection...` then `ready in 13847 ms` and served normally,
  i.e. the credentialed branch above. The uncredentialed failure branch was **not** re-run here;
  it remains as originally observed in the finding.

- [x] Pass
- [ ] Fail

**Follow-up, not blocking:** `saasaloy doctor` (#47) should flag a `remote: true` `send_email`
binding when no Cloudflare credentials are present, since the plugin's own error never mentions
email.

### TC-5 — The env panel and the `saasaloy-email` skill are usable without the plan  ·  🟢 Low

**Steps**

1. Read the **Env vars to set** panel `./saasaloy add email-cloudflare` prints (reproduced in
   [Automated verification](#install-scaffold-and-patches)).
2. Read `modules/email/skills/saasaloy-email/SKILL.md` end to end as someone who has never seen
   the plan or the issue.

**Expected**

- It is obvious that `EMAIL_PROVIDER` has no default and must be set even with one provider
  installed.
- The paid-plan and dashboard-onboarding prerequisites are impossible to miss before a first send.
- The `waitUntil()` vs `await`-with-catch guidance reads as a decision the caller makes per
  message, not as boilerplate to copy blindly.
- The "writing a custom provider in your own project" section is enough to write one without
  reading `define.ts`.
- Judge as a human: does anything in the panel or skill promise a free tier it doesn't have?

**Actual:** _(tester fills in)_

- [ ] Pass
- [ ] Fail

## Regression checks

- [x] `./saasaloy add email-console` alone into a clean playground scaffolds `packages/email`,
      registers `consoleEmail()`, and touches `wrangler.jsonc` **not at all** — verified by the
      agent, see below.
- [x] Installing the two providers in **either order** produces the same registered array —
      `[cloudflare(), consoleEmail()]` and `[consoleEmail(), cloudflare()]`, both valid.
- [x] `apps/api/wrangler.jsonc`'s existing `dev.port` block and both file comments survive the
      `send_email` patch.
- [x] `apps/api/package.json` keeps `hono`, `zod` and `@hono/zod-validator` after the
      `package-json-dependency` patch adds `@repo/email`.
- [x] `GET /health` still answers `200 {"status":"ok"}` with `email` installed — the base `api`
      capability is undisturbed.
- [x] `packages/cli` test suite: 83 tests green, including the new `matchOn: "name"` case.
- [ ] **Needs the operator:** no existing module sends mail, so nothing regressed *into* email.
      Re-check once the optional-dependency issue wires `waitlist`/`auth` to it.

## Automated verification (by AI agent)

_Checks the agent ran itself on 2026-08-04 — no action needed from the tester; listed here for
context and sign-off. The playground was reset afterwards, so none of this state is still on disk._

### Repo test suite and typecheck

```sh
npx turbo run test typecheck --force
```

- ✅ **83 tests passed** across 9 files, typecheck clean (`tsc --noEmit`). Includes the new
  `jsonc.test.ts` case, `"upserts a send_email binding idempotently under matchOn: 'name'"` —
  which pins the first non-default `matchOn` in the registry. Its third assertion is what gives
  the test teeth: `send_email` entries carry no `binding` key, so an implementation that ignored
  `matchOn` would compare `undefined === undefined`, see a false match, and silently swallow a
  second differently-named entry.

### Install, scaffold, and patches

```sh
pnpm run play:reset
```

```sh
cd .dev/playground && ./saasaloy add email-cloudflare --dry-run --yes
```

```sh
cd .dev/playground && ./saasaloy add email-cloudflare --yes
```

- ✅ **Resolution:** the dry run planned `api → email → email-cloudflare` from one command on a
  clean project — 17 files, no CLI or schema work needed, exactly as the plan predicted.
- ✅ **Aliases:** `@api → apps/api/src` and `@email → packages/email/src` both registered in the
  same run, which is what lets `email-cloudflare`'s `files[].target` of
  `@email/providers/cloudflare.ts` resolve even though the alias is contributed by a *different*
  module in the same install.
- ✅ **Env panel** printed all three vars — `CORS_ORIGINS` from `api`, plus:

  ```
  EMAIL_PROVIDER — Which installed provider sends: `cloudflare` (add
  email-cloudflare) or `console` (add email-console). Always required —
  there is no default, so nothing sends by accident and nothing stops
  sending silently.
  EMAIL_FROM — Default sender address (e.g. hello@x.com), on a domain the
  selected provider is allowed to send from. Overridable per message.
  ```

- ✅ **Skill symlinks:** `.claude/skills/saasaloy-email → .agents/skills/saasaloy-email` alongside
  the existing `saasaloy-api` one.
- ✅ **All three patches applied.** `apps/api/wrangler.jsonc` on disk afterwards:

  ```jsonc
  "dev": {
    "port": 4000
  },
  "send_email": [
    {
      "name": "EMAIL",
      "remote": true
    }
  ]
  ```

  Both of the file's comments — the `dev.port` rationale above and the "No bindings in the base
  `api` module" note below — survived verbatim.
- ✅ `apps/api/package.json` gained `"@repo/email": "workspace:*"` with `hono`, `zod` and
  `@hono/zod-validator` intact.
- ✅ `packages/email/src/index.ts` became
  `export const email = defineEmail({ providers: [cloudflare()] });` with the import prepended;
  every surrounding comment, including the "keep this line in exactly this shape" warning,
  unchanged.

### Idempotency

```sh
cd .dev/playground && ./saasaloy add email-cloudflare --yes --force
```

- ✅ **Byte-identical re-run.** `md5sum -c` over `apps/api/wrangler.jsonc`,
  `packages/email/src/index.ts` and `apps/api/package.json` after a forced second install: all
  three `OK`. The CLI reported `already installed (skipped): api, email` and
  `unchanged packages/email/src/providers/cloudflare.ts`.
- ✅ Counted on disk afterwards: exactly **one** `send_email` array, exactly **one** `@repo/email`
  entry. This is issue #15's AC 1 — "run twice, it leaves one of each with comments intact".

### Second provider, and both install orders

```sh
cd .dev/playground && ./saasaloy add email-console --yes
```

- ✅ **cloudflare first, then console** → `providers: [cloudflare(), consoleEmail()]`.
- ✅ **console first, then cloudflare** (fresh playground) →
  `providers: [consoleEmail(), cloudflare()]`. The `plugin-array` codemod appends rather than
  replaces, so both providers are registered simultaneously and `EMAIL_PROVIDER` picks per
  environment.
- ✅ **`email-console` alone touches no Cloudflare surface.** In a clean playground with only
  `email-console` installed, `apps/api/wrangler.jsonc` has **no `send_email` key at all** — the
  free-tier dev path really is free of Cloudflare setup.
- ℹ️ Cosmetic: the generated import lines come out unspaced — `import {cloudflare} from …` next to
  the hand-written `import { defineEmail } from …`. Pre-existing `plugin-array` codemod behavior,
  not introduced here, and a project formatter fixes it on first run.

### Install, typecheck, build

```sh
cd .dev/playground && pnpm install
```

```sh
cd .dev/playground && pnpm exec turbo run typecheck build --force
```

- ✅ `pnpm install` → 561 resolved, done in ~21s. `@repo/email` linked into the workspace.
- ✅ `turbo run typecheck build --force` (cache bypassed) → **4 tasks successful** across
  `@repo/api`, `@repo/email`, `@repo/web`. AC 5's typecheck half.
- ✅ **Zero runtime dependencies** — `packages/email/package.json` `dependencies` is `{}`;
  `@cloudflare/workers-types` is a devDependency only, which is what lets the Cloudflare provider
  use the ambient `SendEmail` global with no npm dep. AC 5's other half.

### Live Worker — `EMAIL_PROVIDER=console` rendering

`apps/api/.dev.vars` held `EMAIL_PROVIDER=console` and `EMAIL_FROM=qa-sender@example.test`. A
throwaway `apps/api/src/routes/qa-email.ts` (the one in Preconditions, plus probes for the error
branches) drove the capability from a real Worker.

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

```sh
curl -s -X POST "$BASE_URL/qa-email/send" -w '\n%{http_code}\n'
```

- ✅ **AC 3 — console renders with no Cloudflare setup, no paid plan, no domain.** Response:

  ```json
  {"provider":"console","messageId":"console-9fa2fbca-a8a6-4566-97ba-c719ebd734a6"}
  ```

  and this in the Worker log, verbatim:

  ```
  ───── email (console provider) ─────
  message-id: console-9fa2fbca-a8a6-4566-97ba-c719ebd734a6
  from:       qa-sender@example.test
  to:         qa-recipient@example.com
  subject:    Welcome to Acme

  Welcome, Ada <script>alert("xss")</script> & "Lovelace".

  Your Acme account is ready. There's nothing else to set up — pick up where you left off whenever you like.

  Open Acme (https://app.acme.test/start)

  If you didn't create this account, you can ignore this email.

  You're receiving this because someone signed up for Acme with this address.
  ────────────────────────────────────
  ```

- ✅ **`deriveText` behaves as documented.** The link kept its destination
  (`Open Acme (https://app.acme.test/start)`); the hidden preheader span was dropped rather than
  repeating the subject; source-file soft wraps were rejoined into single paragraphs; block
  elements became blank-line breaks.
- ✅ **The `html` tag escapes every interpolation.** The name
  `Ada <script>alert("xss")</script> & "Lovelace"` renders in the HTML body as
  `Ada &lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;Lovelace&quot;`. (The
  plaintext part shows the raw characters — correct: `deriveText` decodes entities, and plaintext
  is never parsed as markup.)
- ✅ **The template omits `text` and the core fills it in** — `welcome(...)` returns no `text` key
  at all, yet the provider received a full plaintext body. Multipart without authoring twice.

### Live Worker — provider selection and validation

```sh
curl -s -X POST "$BASE_URL/qa-email/select/unset" -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/qa-email/select/resend" -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/qa-email/no-from" -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/qa-email/no-to" -w '\n%{http_code}\n'
```

```sh
curl -s -X POST "$BASE_URL/qa-email/no-binding" -w '\n%{http_code}\n'
```

- ✅ **AC 4 — `EMAIL_PROVIDER` unset** → throws, naming what is registered:

  ```
  EMAIL_PROVIDER is not set. Registered providers: cloudflare, console.
  ```

- ✅ **AC 4 — `EMAIL_PROVIDER` unknown** (`resend`) → throws, quoting the bad value *and* naming
  the registered ones:

  ```
  EMAIL_PROVIDER is "resend", which is not registered. Registered providers: cloudflare, console.
  ```

  Both throw at `createEmail(env)`, before any transport is touched. No silent fallback in either
  direction.
- ✅ **No sender** (no `EMAIL_FROM`, no per-message `from`) → throws:

  ```
  No sender address: set EMAIL_FROM, or pass `from` on the message. It must be an address on a
  domain your provider is allowed to send from.
  ```

- ✅ **Empty recipient list** (`to: []`) → throws:

  ```
  No recipients: `to` must hold at least one address.
  ```

- ✅ **Cloudflare provider selected with the binding absent** → a real `EmailError`, not a
  `TypeError`:

  ```json
  {"name":"EmailError","code":"provider_error","retryable":false,
   "message":"No `EMAIL` Email Sending binding on this Worker's env. Check the send_email entry in apps/api/wrangler.jsonc, and that this account is on a Workers paid plan with a domain onboarded to Email Service."}
  ```

- ⚠️ **Not a real send:** with the binding present and forced to `remote: false`, selecting
  `cloudflare` returned `200` and a message id of the form
  `<w6hhuF10Oo2HvYwYVb9MdflBFyYS4PvIVe4x@example.test>`. That is **miniflare's local `send_email`
  stub** — it writes the rendered body to `.wrangler/tmp/email/…` and logs
  `send_email binding called with MessageBuilder:`. Nothing left the machine. It proves the
  binding wiring and the provider's happy path compile and run; it proves nothing about
  deliverability. **TC-1 is still required.**

### Finding: `remote: true` breaks the Vite dev loop

```sh
cd .dev/playground && pnpm --filter @repo/api dev
```

- ❌ **With `email-cloudflare` installed and no Cloudflare credentials, `vite dev` will not
  start.** Observed, on a shell with no `CLOUDFLARE_API_TOKEN` and no prior `wrangler login`:

  ```
  ⎔ Establishing remote connection...
  error when starting dev server:
  Error: Failed to start the remote proxy session. Error reloading remote server: In a
  non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN environment variable
  for wrangler to work.
  ```

  Stack frames: `startRemoteProxySession` → `maybeStartOrUpdateRemoteProxySession` →
  `getDevMiniflareOptions`, all inside `@cloudflare/vite-plugin@1.46.0`.
- ✅ **Isolated to that one key.** Flipping the binding to `"remote": false` and changing nothing
  else, the same command starts normally:

  ```
  Using secrets defined in .dev.vars
  ➜  Local:   http://localhost:4000/
  ```

- ✅ **`wrangler dev` is unaffected** — with `remote: true` restored and still no credentials:

  ```
  ⎔ Starting local server...
  [wrangler:info] Ready on http://localhost:4000
  ```

  Its bindings table listed only `EMAIL_PROVIDER` and `EMAIL_FROM` in `local` mode; the `EMAIL`
  binding was not listed at all. So the TC-1 runbook's `wrangler dev` instruction is sound, but
  the repo's documented api dev loop (`pnpm --filter @repo/api dev`) is not, for anyone who
  installs `email-cloudflare` and develops on `console`. **This is TC-4's decision.**
- ✅ **`email-console` alone is clean.** Fresh playground, `add email-console` only, no
  credentials: `vite dev` starts, `GET /health` → `200 {"status":"ok"}`, `turbo run typecheck
  build --force` → 4/4 successful.

> **Outcome.** TC-4 was decided on 2026-08-05 in favour of shipping `remote: false`, which makes
> the first bullet's failure no longer reachable from a default install. The evidence above is kept
> as the record of *why* — and as the reproduction to run if anyone proposes changing the default
> back. Everything above was observed with the binding written `remote: true`.

### Cleanup

```sh
pnpm run play:reset
```

- ✅ All dev servers and `workerd` processes stopped; playground reset to the bare template; no
  QA scaffolding, `.dev.vars`, or `.wrangler` state left behind. `git status` clean.

## Not covered / needs human judgment

- **A real Cloudflare send (TC-1).** Needs a Workers paid plan and a dashboard-onboarded domain —
  a browser step this box cannot perform. The `messageId` and inbox fields in TC-1 are
  deliberately blank; nothing in this document invents a result for them.
- **The error-code mapping table** in `modules/email-cloudflare/files/cloudflare.ts`. Cloudflare's
  runtime codes are typed nowhere in `@cloudflare/workers-types`, so
  `E_SENDER_NOT_VERIFIED` / `E_RATE_LIMIT_EXCEEDED` / `E_CONTENT_TOO_LARGE` are unverified against
  a live rejection. TC-3 checks the first; the other two are untested and would need a real rate
  limit and a >5 MiB message.
- **Inbox rendering and deliverability (TC-2).** Nothing here proves the hand-written inline-style
  layout survives Gmail, Outlook, or a dark-mode mobile client, or that SPF/DKIM/DMARC land the
  message out of spam.
- **Cloudflare's documented limits** — 50 recipients, 5 MiB, 32 attachments, 16 KB headers. The
  package doesn't enforce them and none were exercised.
- **`waitUntil()` and the retry guidance.** Documented in the `saasaloy-email` skill, never run: no
  module sends mail yet, so the non-critical vs critical shapes are prose, not code under test.
- **`waitlist` / `auth` wiring.** AC 3 is explicitly deferred to the optional-dependency issue —
  recipes only, no code path to test.
- **The `create-provider` authoring skill.** Reviewed as text; no provider has yet been authored
  through it end to end. `email-resend` is the natural first exercise.
- **Concurrency and volume.** No burst sending, no simultaneous `createEmail` calls, no rate-limit
  behavior.
- **`saasaloy doctor` checks** (#47) — `EMAIL_PROVIDER` set and matching a registered provider,
  and a `send_email` binding present when `email-cloudflare` is installed. Not built yet, so the
  misconfigurations above surface at first send rather than at install.
