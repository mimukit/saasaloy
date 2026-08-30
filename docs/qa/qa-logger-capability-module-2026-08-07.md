# QA Plan: `logger` capability module + `logger-console` provider

_Generated 2026-08-07 · covers `issue-66-add-the-logger-capability-with-a-console-provider` vs `main` (4 commits — `0f4018e`, `405bb46`, `469c7d7`, `c78fcba`, issue #66)_

## Summary

- `saasaloy add logger` scaffolds `packages/logger` (`@repo/logger`, alias `@logger`) — a
  provider-agnostic structured logger with six levels, a `LOG_LEVEL` threshold, `child()`
  correlation, `Error` serialization, default-on key redaction, and a **provider registry** with
  **zero runtime dependencies**. `logger-console` is the one provider today: one file into
  `src/providers/`, one `plugin-array` patch appending `consoleLogger()` to the array in
  `src/index.ts`.
- The direction is reversed from every other capability: **`api` declares
  `dependsOn: ["logger", "logger-console"]`** (ADR 0023), because `apps/api/src/index.ts` now
  *imports* `@repo/logger` for its `cf-ray` correlation middleware. `saasaloy add api` therefore
  installs three modules.
- "Working" means: `saasaloy add api` on a clean playground resolves logger → logger-console → api
  and lands exactly one `consoleLogger()` registration; a re-run and a `--force` re-apply leave it
  at exactly one; every line from one request carries the same `requestId`; `LOG_LEVEL` filters at
  the source and a garbage value (including a `Object.prototype` key) falls back to `info` instead
  of opening the floodgates; `authorization`/`token` come out `[redacted]`; and a `LOGGER_PROVIDER`
  naming an uninstalled provider is the only thing in the whole capability that throws.

**Split of work in this document.** Everything a script can decide — the level threshold and its
fallbacks, redaction at both depths and its documented misses, `child()` merge precedence, error
serialization and the one-level `cause` bound, provider selection and its two branches, the
swallowed `write` throw, the console level→method mapping, and the shape of the patched files,
descriptors, lock and built bundle already on disk — the agent already ran; see
[Automated verification](#automated-verification-by-ai-agent) for the observed output. What is left
for a human is the part no static check reaches: **[TC-1.1](#tc-11--saasaloy-add-api-installs-three-modules-in-topological-order----critical)**
(a clean install of three modules through the confirmation prompt) and
**[Scenario 2](#scenario-2--the-worker-running-locally-with-a-qa-route)** (a live `workerd` under
`vite dev`, where correlation and redaction either hold or don't), plus the docs judgment in
Scenario 3.

> **Read this before you start.** The `.dev/playground` currently on disk was scaffolded from an
> **earlier commit on this branch** — its `packages/logger/src/define.ts` predates `c78fcba` and
> still carries the `LEVELS[normalized] === undefined` guard that `LOG_LEVEL=constructor` walks
> straight through. The agent confirmed the bug reproduces in that stale copy and is fixed in the
> module source at HEAD (see
> [Automated verification](#the-stale-playground-copy-and-what-it-proves)). Scenario 1 opens with
> `pnpm play:reset` for exactly this reason — **do not test against the playground as you found
> it.**

## Run log

_Fill in when you run the plan._

| Field | Value |
|---|---|
| Tester | |
| Date run | |
| Build / commit | |

**Overall**

- [ ] Pass — every case passed
- [ ] Fail — at least one case failed
- [ ] Partial — cases were skipped or not reached

## Environment

True for the whole plan — do this once, before Scenario 1.

- Branch `issue-66-add-the-logger-capability-with-a-console-provider`, checked out in a worktree of
  this repo. Every path below is relative to that worktree's root.
- Run all `saasaloy` commands from `.dev/playground` per `AGENTS.md` — never a globally linked CLI.
  The `./saasaloy` shim in that directory points the freshly built CLI at **this worktree's**
  `modules/` registry.
- No Cloudflare account, token, or paid plan is needed anywhere in this plan. `logger` and
  `logger-console` carry no binding and no secret; everything runs on local `workerd`.
- A stray `apps/api/.dev.vars` from an earlier case carries a `LOG_LEVEL` or `LOGGER_PROVIDER` that
  silently invalidates the expectations below. Scenario 2 rewrites it before every case that
  depends on it.

Make sure the CLI's `dist/` is current before the first `./saasaloy` call:

```sh
pnpm build
```

Export the base URL the rest of this document uses:

```sh
export BASE_URL=http://localhost:4000
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|---|---|---|---|
| TC-1.1 | 1 — clean playground, nothing installed | `saasaloy add api` installs three modules in topological order | 🔴 Critical |
| TC-1.2 | 1 — clean playground, nothing installed | Idempotent re-run and `--force` re-apply leave exactly one registration | 🔴 Critical |
| TC-1.3 | 1 — clean playground, nothing installed | Install, typecheck and build with `logger` in the graph | 🔴 Critical |
| TC-2.1 | 2 — Worker running locally with a QA route | One request, one `requestId`; `cf-ray` wins, `x-request-id` is ignored | 🔴 Critical |
| TC-2.2 | 2 — Worker running locally with a QA route | `LOG_LEVEL` filters at the source, and a garbage value falls back to `info` | 🔴 Critical |
| TC-2.3 | 2 — Worker running locally with a QA route | Redaction and error serialization in a real Worker | 🔴 Critical |
| TC-2.4 | 2 — Worker running locally with a QA route | `LOGGER_PROVIDER`: unset works, a typo throws | 🟡 Normal |
| TC-3.1 | 3 — docs read cold | The env panel, `saasaloy-logger`, `create-provider` and ADR 0023 stand on their own | 🟡 Normal |
| TC-4.1 | 4 — a project that installed `api` before this branch | An existing project upgrades into the logger with `add api --force` | 🟡 Normal |
| TC-4.2 | 4 — a project that installed `api` before this branch | `saasaloy list` and the removal path read sensibly with the new edge | 🟢 Low |

Everything else — the threshold arithmetic, the prototype-key regression, redaction at both depths
and its four documented misses, `child()` precedence, `cause` depth, the no-provider no-op, the
unregistered-provider throw text, the swallowed `write` failure, the console level→method mapping,
`observability` surviving into the built `wrangler.json`, and `pnpm deps:check` — is covered in
[Automated verification](#automated-verification-by-ai-agent) and needs nothing from you.

## Scenario 1 — Clean playground, nothing installed

**Setup** — once, for every case in this scenario.

The playground on disk is stale (see the warning in [Summary](#summary)). Reset it:

```sh
pnpm run play:reset
```

- [ ] Setup complete — `.dev/playground` exists, `saasaloy.json` lists only `web`, and
      `packages/logger` does **not** exist

### TC-1.1 — `saasaloy add api` installs three modules in topological order  ·  🔴 Critical

**Goal** — proves ADR 0023's reversal actually lands: `api` is no longer a graph root, and one
command gives a project a logger that can log.

**Steps**

1. Preview the plan without writing anything.

   ```sh
   cd .dev/playground && ./saasaloy add api --dry-run
   ```

   - [ ] The plan lists **three** modules, in the order `logger`, `logger-console`, `api`
   - [ ] `logger-console` appears **after** `logger` (its `dependsOn`) and **before** `api`
   - [ ] Nothing was written — `packages/logger` still does not exist

2. Install for real.

   ```sh
   cd .dev/playground && ./saasaloy add api --yes
   ```

   - [ ] The command exits 0
   - [ ] The **Env vars to set** panel names `LOGGER_PROVIDER` and `LOG_LEVEL` alongside
         `CORS_ORIGINS`
   - [ ] The panel says plainly that `LOGGER_PROVIDER` is **optional** — a reader who has not seen
         the plan should not go looking for a required value

3. Check what the capability scaffolded.

   ```sh
   ls -R .dev/playground/packages/logger/src
   ```

   - [ ] `index.ts`, `define.ts`, `provider.ts` and `providers/` are all present
   - [ ] `providers/console.ts` is there — the provider file landed in the workspace the capability
         scaffolded **in the same run**

4. Check the patch point.

   ```sh
   grep -n 'consoleLogger' .dev/playground/packages/logger/src/index.ts
   ```

   - [ ] Exactly **one** `import { consoleLogger } from "./providers/console"` at the top
   - [ ] The registry line reads `export const logger = defineLogger({ providers: [consoleLogger()] });`
   - [ ] The long comment above that line survived the codemod intact

5. Check what `api` gained.

   ```sh
   grep -n '@repo/logger' .dev/playground/apps/api/package.json && grep -n 'cf-ray' .dev/playground/apps/api/src/index.ts
   ```

   - [ ] `"@repo/logger": "workspace:*"` sits in `dependencies`, alongside the untouched `hono`,
         `zod` and `@hono/zod-validator`
   - [ ] The correlation middleware is in `src/index.ts`, reading `cf-ray` with a
         `crypto.randomUUID()` fallback

6. Check `wrangler.jsonc` — this is a hand-edited JSONC file with comments, so read it, don't grep
   it.

   ```sh
   cat .dev/playground/apps/api/wrangler.jsonc
   ```

   - [ ] The `observability` block is present with `"enabled": true` and `"head_sampling_rate": 1`
   - [ ] The pre-existing `dev.port: 4000` block is still there and still correct
   - [ ] Both original comment blocks survived, and the new cost-dial comment reads as guidance
         rather than noise

7. Check the manifests and the skill install.

   ```sh
   cat .dev/playground/saasaloy.json && cat .dev/playground/saasaloy-lock.json
   ```

   - [ ] `installed` contains `logger`, `logger-console`, `api` in that order
   - [ ] `aliases` gained `"@logger": "packages/logger/src"`
   - [ ] The lock records `logger-console` → `dependsOn: ["logger"]` and `api` →
         `dependsOn: ["logger", "logger-console"]`

   ```sh
   ls -l .dev/playground/.agents/skills .dev/playground/.claude/skills
   ```

   - [ ] `.agents/skills/saasaloy-logger` is a **real directory**
   - [ ] `.claude/skills/saasaloy-logger` is a **symlink** to it (ADR 0015)
   - [ ] `logger-console` shipped **no** skill of its own

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.2 — Idempotent re-run and `--force` re-apply leave exactly one registration  ·  🔴 Critical

**Goal** — proves the `plugin-array` codemod is idempotent both ways round: a second install is a
no-op, and an explicit re-apply doesn't double the registration or the import.

**Steps**

1. Snapshot the tree, so any drift is visible as a diff (`play:init` leaves the playground a git
   repo).

   ```sh
   cd .dev/playground && git add -A && git commit -q -m 'qa baseline' && git log --oneline -1
   ```

   - [ ] A baseline commit exists

2. Re-run the same install.

   ```sh
   cd .dev/playground && ./saasaloy add api --yes
   ```

   - [ ] The CLI reports the modules are already installed and suggests `--force`
   - [ ] It exits without an error

3. Re-apply the provider explicitly. `--force` re-applies only the **requested** module, so name
   `logger-console` — `add api --force` would not re-run the provider's patch.

   ```sh
   cd .dev/playground && ./saasaloy add logger-console --yes --force
   ```

   - [ ] Exits 0

4. Count the registrations.

   ```sh
   grep -c 'consoleLogger' .dev/playground/packages/logger/src/index.ts
   ```

   - [ ] The count is **3** — one in the import, one in the comment, one in the array literal
   - [ ] The array literal still reads `providers: [consoleLogger()]`, not
         `[consoleLogger(), consoleLogger()]`

5. Re-apply `api` too, and check the JSONC patch didn't duplicate.

   ```sh
   cd .dev/playground && ./saasaloy add api --yes --force && grep -c '"observability"' apps/api/wrangler.jsonc
   ```

   - [ ] Exactly **one** `observability` key
   - [ ] `apps/api/package.json` still lists `@repo/logger` exactly once

6. Look at the total drift.

   ```sh
   cd .dev/playground && git status --porcelain && git diff
   ```

   - [ ] The diff is empty, or contains only whitespace/ordering changes you judge harmless
   - [ ] Nothing in `packages/logger/src/` changed

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-1.3 — Install, typecheck and build with `logger` in the graph  ·  🔴 Critical

**Goal** — proves the new workspace resolves, typechecks under the repo's TS config, and bundles
into the Worker without dragging in a runtime dependency.

**Steps**

1. Install.

   ```sh
   cd .dev/playground && pnpm install
   ```

   - [ ] Resolves with no peer or workspace-protocol errors
   - [ ] `apps/api/node_modules/@repo/logger` is a symlink to `packages/logger`

2. Confirm the zero-runtime-dependency claim.

   ```sh
   cat .dev/playground/packages/logger/package.json
   ```

   - [ ] `"dependencies"` is `{}` — empty, not absent
   - [ ] `devDependencies` are exact-pinned (no `^`, no `~`) and include `rimraf`
   - [ ] `"clean": "rimraf -g dist \"*.tsbuildinfo\""` is present, per `AGENTS.md`

3. Typecheck and build the whole playground.

   ```sh
   cd .dev/playground && pnpm exec turbo run typecheck build
   ```

   - [ ] Typecheck is clean, including `packages/logger`
   - [ ] The `api` build succeeds

4. Inspect the bundle.

   ```sh
   wc -c .dev/playground/apps/api/dist/api/index.js && grep -c 'redacted' .dev/playground/apps/api/dist/api/index.js
   ```

   - [ ] The logger's code is in the bundle (`redacted` appears)
   - [ ] Record the byte count here: `____________` — the agent measured **65,567 bytes** for the
         same three-module build on this branch. Compare against an `api`-only build from `main` if
         you want the delta on the record; nothing here depends on it.

5. Confirm the built Worker config carries the observability block.

   ```sh
   grep -o '"observability":{[^}]*}' .dev/playground/apps/api/dist/api/wrangler.json
   ```

   - [ ] `{"enabled":true,"head_sampling_rate":1}` survived the build, comments and all

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — none. Scenario 2 builds directly on the state Scenario 1 leaves.

## Scenario 2 — The Worker running locally with a QA route

Nothing in the repo logs anything yet — `api` ships one `health` route and no module calls
`c.get("log")`. Drop a throwaway route into the playground so there is something to `curl`. It is
QA scaffolding, not part of any module; the file-based route registration in `apps/api/src/index.ts`
mounts it at `/qa-log` with no other edit.

**Setup** — once, for every case in this scenario.

1. Write the route.

   ```sh
   cat > .dev/playground/apps/api/src/routes/qa-log.ts <<'EOF'
   import { Hono } from "hono";
   import type { LoggerVariables } from "@repo/logger";

   const qaLog = new Hono<{ Variables: LoggerVariables }>();

   qaLog.get("/levels", (c) => {
     const log = c.get("log");
     log.trace("qa trace");
     log.debug("qa debug");
     log.info("qa info");
     log.warn("qa warn");
     log.error("qa error");
     log.fatal("qa fatal");
     return c.json({ provider: log.provider, level: log.level });
   });

   qaLog.get("/correlate", (c) => {
     const log = c.get("log");
     log.info("qa line one");
     log.child({ jobId: "job_1" }).info("qa line two");
     log.info("qa line three", { tenant: "acme" });
     return c.json({ ok: true });
   });

   qaLog.get("/redact", (c) => {
     c.get("log").info("qa redact", {
       authorization: "Bearer super-secret",
       Token: "tok_live_123",
       authorizationHeader: "Bearer NOT-caught",
       headers: { cookie: "session=abc", ok: "visible" },
       deep: { nested: { token: "NOT-caught-two-levels-down" } },
     });
     return c.json({ ok: true });
   });

   qaLog.get("/error", (c) => {
     const err = new Error("charge failed", { cause: new Error("card declined") });
     c.get("log").error("qa error serialization", { err, invoiceId: "inv_1" });
     return c.json({ ok: true });
   });

   export default qaLog;
   EOF
   ```

   - [ ] The file exists at `.dev/playground/apps/api/src/routes/qa-log.ts`

2. Start with no logger config at all — the defaults are what most projects will run.

   ```sh
   rm -f .dev/playground/apps/api/.dev.vars
   ```

3. Start the Worker on real `workerd`. Leave it running for every case in this scenario, in its own
   terminal; its stdout **is** the log sink under test.

   ```sh
   cd .dev/playground && pnpm --filter @repo/api dev
   ```

   - [ ] `➜  Local: http://localhost:4000/` — the port is fixed by `strictPort`
   - [ ] No error about `@repo/logger` failing to resolve

- [ ] Setup complete

### TC-2.1 — One request, one `requestId`; `cf-ray` wins, `x-request-id` is ignored  ·  🔴 Critical

**Goal** — proves correlation is real: a single query on `requestId` reconstructs a whole request,
the id agrees with Cloudflare's own view when there is one, and a client can't forge it.

**Steps**

1. Hit the correlation route with no special headers.

   ```sh
   curl -s "$BASE_URL/qa-log/correlate" -w '\n%{http_code}\n'
   ```

   - [ ] `200` and `{"ok":true}`
   - [ ] In the dev-server terminal: **three** log lines, all carrying the **same**
         `fields.requestId`
   - [ ] With no `cf-ray` present the id is a UUID (`8-4-4-4-12` hex)
   - [ ] The middle line also carries `fields.jobId: "job_1"`; the other two do not
   - [ ] The third line carries `fields.tenant: "acme"` **and** the same `requestId` — a call-site
         field does not displace the bound one

2. Hit it again and compare.

   ```sh
   curl -s "$BASE_URL/qa-log/correlate" > /dev/null
   ```

   - [ ] The new trio's `requestId` differs from the first trio's — ids are per-request, not
         per-process

3. Supply a `cf-ray`, the way Cloudflare's edge would.

   ```sh
   curl -s "$BASE_URL/qa-log/correlate" -H 'cf-ray: 8f0000000000abcd-LHR' > /dev/null
   ```

   - [ ] All three lines carry `requestId: "8f0000000000abcd-LHR"` — verbatim, not re-derived
   - [ ] No UUID was generated for this request

4. Try to forge one from the client side. This is the security half of the case.

   ```sh
   curl -s "$BASE_URL/qa-log/correlate" -H 'x-request-id: forged-by-client' > /dev/null
   ```

   - [ ] The `requestId` is a fresh UUID — **not** `forged-by-client`
   - [ ] `forged-by-client` appears nowhere in the emitted lines

5. Confirm the middleware covers routes it didn't author.

   ```sh
   curl -s "$BASE_URL/health" -w '\n%{http_code}\n'
   ```

   - [ ] Still `200 {"status":"ok"}` — the base `api` capability is undisturbed by the middleware
   - [ ] Judge as a human: a route that logs nothing costs nothing visible; the middleware is not
         chattering on its own

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.2 — `LOG_LEVEL` filters at the source, and a garbage value falls back to `info`  ·  🔴 Critical

**Goal** — proves the threshold is a source-side control (a filtered line is never written at all),
and pins the `c78fcba` regression: a `LOG_LEVEL` that happens to name an `Object.prototype` key must
not turn every level on.

**Steps**

1. With no `.dev.vars` at all (the Setup state), hit the levels route.

   ```sh
   curl -s "$BASE_URL/qa-log/levels" -w '\n%{http_code}\n'
   ```

   - [ ] The JSON body is `{"provider":"console","level":"info"}`
   - [ ] The terminal shows **four** lines — `info`, `warn`, `error`, `fatal`
   - [ ] `trace` and `debug` are **absent**, not merely quieter
   - [ ] `warn` printed through `console.warn` and `error`/`fatal` through `console.error` — in
         `vite dev` these are visually distinct from `console.log`
   - [ ] The event arrived as an **object** with `level`, `message`, `time`, `fields` — not a
         pre-stringified JSON blob

2. Turn the threshold down.

   ```sh
   printf 'LOG_LEVEL=debug\n' > .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s "$BASE_URL/qa-log/levels" -w '\n%{http_code}\n'
   ```

   - [ ] The body now reports `"level":"debug"`
   - [ ] **Five** lines — `debug` through `fatal`; `trace` still absent

3. The regression guard. `constructor` resolves on `Object.prototype`, so a bare property lookup
   would have accepted it and left the threshold non-numeric — every comparison false, every level
   emitted.

   ```sh
   printf 'LOG_LEVEL=constructor\n' > .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s "$BASE_URL/qa-log/levels" -w '\n%{http_code}\n'
   ```

   - [ ] The body reports `"level":"info"` — **not** `"constructor"`
   - [ ] **Four** lines, `info` and above. `trace` and `debug` must **not** appear

4. Repeat for the other prototype keys and for plain nonsense.

   ```sh
   printf 'LOG_LEVEL=__proto__\n' > .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s "$BASE_URL/qa-log/levels" -w '\n%{http_code}\n'
   ```

   - [ ] `"level":"info"`, four lines

   ```sh
   printf 'LOG_LEVEL=VERBOSE\n' > .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s "$BASE_URL/qa-log/levels" -w '\n%{http_code}\n'
   ```

   - [ ] `"level":"info"`, four lines
   - [ ] Nothing was logged **about** the bad value — the fallback is silent, by design

5. Restore the default before the next case.

   ```sh
   rm -f .dev/playground/apps/api/.dev.vars
   ```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.3 — Redaction and error serialization in a real Worker  ·  🔴 Critical

**Goal** — proves the default-on deny-list catches the keys it claims to at both depths, that the
documented misses really are misses (so the skill isn't overselling it), and that an `Error` reaches
the sink as a readable object rather than `{}`.

**Steps**

1. Log the redaction payload.

   ```sh
   curl -s "$BASE_URL/qa-log/redact" -w '\n%{http_code}\n'
   ```

   - [ ] `fields.authorization` is the string `[redacted]`
   - [ ] `fields.Token` is `[redacted]` — matching is case-insensitive
   - [ ] `fields.headers.cookie` is `[redacted]` — one level below the top
   - [ ] `fields.headers.ok` is still `"visible"` — redaction didn't flatten the object
   - [ ] `fields.authorizationHeader` still shows `Bearer NOT-caught` — matching is **exact**, not
         substring. This is a documented limit, not a bug
   - [ ] `fields.deep.nested.token` still shows its value — two levels down is out of bounds, also
         documented
   - [ ] Judge as a human: reading only the `saasaloy-logger` skill's redaction section, would you
         have predicted both misses before seeing them?

2. Log an error.

   ```sh
   curl -s "$BASE_URL/qa-log/error" -w '\n%{http_code}\n'
   ```

   - [ ] The event has a top-level `err` object, **not** an `err` inside `fields`
   - [ ] `err` shows `name: "Error"`, `message: "charge failed"`, and a real multi-line `stack`
   - [ ] `err` is **not** `{}` — the whole point of serializing it
   - [ ] `err.cause` shows `{ name, message: "card declined" }`
   - [ ] `err.cause.cause` is absent — the chain stops at one level
   - [ ] `fields.invoiceId` is `"inv_1"` — the sibling field came through untouched

3. Confirm nothing in this case took the request down.

   - [ ] Both requests returned `200 {"ok":true}`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-2.4 — `LOGGER_PROVIDER`: unset works, a typo throws  ·  🟡 Normal

**Goal** — proves the deliberate divergence from `EMAIL_PROVIDER` behaves in a live Worker: the
optional path is genuinely optional, and the one throwing path fails loudly enough to diagnose.

**Steps**

1. Name the installed provider explicitly.

   ```sh
   printf 'LOGGER_PROVIDER=console\n' > .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s "$BASE_URL/qa-log/levels" -w '\n%{http_code}\n'
   ```

   - [ ] `200`, body reports `"provider":"console"`
   - [ ] Lines still print

2. Name one that isn't registered. The middleware calls `createLogger` on every request, so this
   surfaces on the request rather than at boot.

   ```sh
   printf 'LOGGER_PROVIDER=axiom\n' > .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s -i "$BASE_URL/qa-log/levels" | head -1
   ```

   - [ ] The request fails — a `500`, not a silent success with no logging
   - [ ] The dev-server terminal shows the message
         `LOGGER_PROVIDER is "axiom", which is not registered. Registered providers: console.`
   - [ ] Judge as a human: does that message tell an on-call engineer what to change, without
         opening the source?

3. Confirm the blast radius. A misconfigured `LOGGER_PROVIDER` takes down every route, not just the
   logging one.

   ```sh
   curl -s -i "$BASE_URL/health" | head -1
   ```

   - [ ] `/health` also fails while `LOGGER_PROVIDER=axiom` is set
   - [ ] Judge as a human: is that the trade you want? It is the documented one — a naming typo is
         "unambiguously a typo in a deploy config" — but it means one bad env var is a total outage.
         Record your opinion in **Notes** even if you pass the case.

4. Clean up.

   ```sh
   rm -f .dev/playground/apps/api/.dev.vars
   ```

   ```sh
   curl -s "$BASE_URL/health" -w '\n%{http_code}\n'
   ```

   - [ ] Back to `200 {"status":"ok"}`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after every case above, before moving to Scenario 3.

Stop the dev server (`Ctrl-C` in its terminal), then remove the QA scaffolding:

```sh
rm -f .dev/playground/apps/api/src/routes/qa-log.ts .dev/playground/apps/api/.dev.vars
```

- [ ] No `workerd` or `vite` process is still holding port 4000

## Scenario 3 — Docs read cold

**Setup** — once. Read as someone who has never seen issue #66, the plan doc, or this QA plan. No
commands, no running code.

- [ ] Setup complete

### TC-3.1 — The env panel, `saasaloy-logger`, `create-provider` and ADR 0023 stand on their own  ·  🟡 Normal

**Goal** — proves the docs carry the two things that are genuinely counter-intuitive here: that
`logger-console` is production (unlike `email-console`), and what redaction does *not* catch.

**Steps**

1. Re-read the **Env vars to set** panel from TC-1.1 step 2.

   - [ ] It is obvious `LOGGER_PROVIDER` has a working default and needn't be set
   - [ ] It is obvious `LOG_LEVEL` defaults to `info`

2. Read `modules/logger/skills/saasaloy-logger/SKILL.md` end to end.

   - [ ] The `logger-console` vs `email-console` disambiguation is impossible to miss — it is in
         the opening, not buried in a provider table
   - [ ] The "what redaction does **not** catch" section lists all four misses and reads as a
         warning, not a footnote
   - [ ] The `c.get("log")` vs `createLogger(env)` table makes the choice obvious inside a route
   - [ ] "Log objects, never pre-stringified JSON" and the 256 KB cap are both findable
   - [ ] Judge as a human: does anything here promise a queryable dashboard the reader hasn't yet
         enabled?

3. Read the counterpart warning in `modules/email/skills/saasaloy-email/SKILL.md`.

   - [ ] Someone who only ever reads the *email* skill still learns that `email-console` is
         dev-only and that the identically-suffixed logger module is not

4. Read `modules/api/skills/saasaloy-api/SKILL.md`'s new logging section.

   - [ ] The `LoggerVariables` generic is spelled out, with the reason a route can't import the
         entry's own `Variables`
   - [ ] "`c.get("log")` for logging, never `console.log`" made it into the boundaries list

5. Read `.agents/skills/create-provider/SKILL.md`'s new `logger` mode.

   - [ ] The four divergences from the `email` mode (sync `void` `write`, no error type, pre-
         normalized event, optional `LOGGER_PROVIDER`) are each stated as a way to get it wrong
   - [ ] It is enough to write a `logger-<x>` module without opening `define.ts`

6. Read `docs/adr/adr-0023-api-depends-on-logger-2026-08-07.md`.

   - [ ] The rule it sets — the spine depends on what it *consumes*, and is depended on by what it
         *hosts* — is stated in a form a future module author can apply
   - [ ] The consequence that a `saasaloy:capability` now depends on a `saasaloy:feature` is
         acknowledged rather than glossed
   - [ ] `README.md` and `modules/README.md` list `logger` and `logger-console` in their
         inventories

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

## Scenario 4 — A project that installed `api` before this branch

ADR 0023 states outright that projects which already installed `api` "do not retroactively gain
`logger`", and that QA confirms what such a project sees rather than automating it. This scenario
builds exactly that starting state.

**Setup** — once, for every case in this scenario. Needs a checkout of `main` somewhere on disk;
`/home/dev/projects/saasaloy` is the usual one. **Skip this scenario** if you don't have one.

```sh
pnpm run play:reset
```

Install `api` from **main's** registry, bypassing the shim's `SAASALOY_REGISTRY_DIR`:

```sh
cd .dev/playground && env SAASALOY_REGISTRY_DIR=/home/dev/projects/saasaloy/modules node ../../packages/cli/dist/index.js add api --yes
```

- [ ] Setup complete — `saasaloy.json` lists `api` but **not** `logger`, and `packages/logger` does
      not exist

### TC-4.1 — An existing project upgrades into the logger with `add api --force`  ·  🟡 Normal

**Goal** — proves there is a real upgrade path for a project on the old `api`, and that it is one
command rather than a hand-merge.

**Steps**

1. Confirm the starting state really is the old one.

   ```sh
   grep -c 'cf-ray' .dev/playground/apps/api/src/index.ts
   ```

   - [ ] `0` — no correlation middleware
   - [ ] `apps/api/wrangler.jsonc` has no `observability` block

2. Try the plain re-add first — this is what a user reaches for.

   ```sh
   cd .dev/playground && ./saasaloy add api --yes
   ```

   - [ ] Judge as a human: whatever it does, is the outcome legible? Record whether it (a) refused
         because `api` is installed, (b) installed only the two missing logger modules, or (c)
         upgraded everything
   - [ ] If it left `apps/api/src/index.ts` on the old version while installing `packages/logger`,
         that half-state is worth a finding — note it

3. Force the re-apply.

   ```sh
   cd .dev/playground && ./saasaloy add api --yes --force
   ```

   - [ ] `packages/logger` now exists with `providers/console.ts`
   - [ ] `packages/logger/src/index.ts` has exactly one `consoleLogger()` in the array
   - [ ] `apps/api/src/index.ts` now has the `cf-ray` middleware
   - [ ] `apps/api/wrangler.jsonc` now has the `observability` block
   - [ ] `apps/api/package.json` now lists `@repo/logger`

4. Check nothing local was clobbered. This is the real risk of a `--force` upgrade.

   ```sh
   cd .dev/playground && git diff -- apps/api
   ```

   - [ ] Judge as a human: if a project had edited `apps/api/src/index.ts` (added a route, changed
         the CORS list), would this upgrade have silently overwritten it? Record the answer — it is
         the ADR 0006 copy-in question and this is the first module change that forces it.

5. Install and typecheck the upgraded project.

   ```sh
   cd .dev/playground && pnpm install && pnpm exec turbo run typecheck
   ```

   - [ ] Clean

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

### TC-4.2 — `saasaloy list` and the removal path read sensibly with the new edge  ·  🟢 Low

**Goal** — proves the new capability→feature dependency doesn't confuse the two commands that
report on or undo an install.

**Steps**

1. List.

   ```sh
   cd .dev/playground && ./saasaloy list
   ```

   - [ ] `logger` shows as a capability and `logger-console` as a feature/provider
   - [ ] Judge as a human: does the output make it clear `api` pulled these in, rather than
         suggesting the user asked for them?

2. Try to remove the capability that something depends on.

   ```sh
   cd .dev/playground && ./saasaloy remove logger
   ```

   - [ ] Whatever it does, it is not silent data loss — either it refuses with a reason naming
         `logger-console` and `api`, or it removes cleanly and the project still typechecks
   - [ ] If it removed `packages/logger` while `apps/api/src/index.ts` still imports
         `@repo/logger`, that is a finding — record it and re-run
         `pnpm exec turbo run typecheck` to show the breakage

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes** — _what actually happened on a fail; why it was skipped_

**Reset** — after this scenario.

```sh
pnpm run play:reset
```

## Regression checks

- [x] `packages/logger` ships **zero runtime dependencies** — `"dependencies": {}` in
      `modules/logger/files/package.json`, verified by the agent below.
- [x] `apps/api/package.json` keeps `hono`, `zod` and `@hono/zod-validator` after `@repo/logger` is
      added — verified in the installed playground.
- [x] `apps/api/wrangler.jsonc`'s existing `dev.port: 4000` block and both original comment blocks
      survive the `observability` addition.
- [x] The `email` capability is untouched apart from one added disambiguation blockquote in its
      skill — no code change, so nothing about sending regressed.
- [x] `packages/cli` test suite: **121 tests green**, plus `pnpm typecheck` and `pnpm build`, all
      run by the branch's own gate before this plan was written. No new CLI test was added by this
      branch — the change is entirely in `modules/`, which the CLI suite does not execute.
- [x] `pnpm deps:check` reports **no** drift attributable to this branch — `modules/logger`'s only
      flagged pin is a within-cooldown `@cloudflare/workers-types` bump shared with `modules/api`.
- [ ] **Needs the tester:** nothing in the registry calls `c.get("log")` yet — `waitlist`, `auth`
      and `database` reach `@repo/logger` transitively but don't use it. Re-check adoption when the
      first module logs for real.

## Automated verification (by AI agent)

_Checks the agent ran on 2026-08-07 — no action needed from the tester; listed here for context and
sign-off. Every check **inspected** existing state: nothing was rebuilt, re-scaffolded or reset, and
the `.dev/playground` the agent found is the one it left behind._

### The branch gate

Run by the pipeline's implement step before this plan was written; **not re-run here**, because
re-running a green gate buys the same answer at full price.

- ✅ `pnpm test` → 121 tests passed (`packages/cli`, vitest).
- ✅ `pnpm typecheck` → clean (`tsconfig.scripts.json` + `turbo run typecheck`).
- ✅ `pnpm build` → clean (`packages/cli` via tsup); `.dev/playground/apps/api/dist/api/index.js`
  built from it.
- ℹ️ **No test file changed on this branch.** The 20 changed files are all under `modules/`,
  `docs/`, `.agents/` and `README.md`. `modules/*/files/**` is template source the CLI copies, not
  code the CLI's own suite imports, so none of the logger's runtime semantics are covered by a unit
  test. That gap is exactly what the probe below fills.

### The core semantics, executed against the module source at HEAD

Node 24 strips types from `.ts` on import, and `define.ts`/`console.ts` import only *types* from
`./provider` — so both files run directly, with no build step and nothing rebuilt.

```sh
node --experimental-strip-types probe.ts
```

The probe imports `modules/logger/files/src/define.ts` and `modules/logger-console/files/console.ts`
at HEAD, registers a capture provider, and asserts 31 behaviors. Its core is:

```ts
const out = [];
const capture = { name: "capture", write: (_env, ev) => void out.push(ev) };
const reg = defineLogger({ providers: [capture] });
const log = reg.create({ LOG_LEVEL: "info" });
log.debug("d"); log.info("i"); log.error("e");   // → out.length === 2
```

**All 31 assertions passed.** Grouped:

*Level threshold*
- ✅ `LOG_LEVEL=info` drops `debug`, keeps `info` and `error` → emitted `["info","error"]`.
- ✅ `LOG_LEVEL=constructor` → `level` resolves to `info`, one line emitted of three. **This is the
  `c78fcba` fix under test.**
- ✅ `LOG_LEVEL=__proto__` → `info`, one of three.
- ✅ `LOG_LEVEL=toString`, `hasOwnProperty`, `bogus` → all fall back to `info`.
- ✅ `LOG_LEVEL="  DEBUG "` → trimmed and lower-cased to `debug`.

*Redaction*
- ✅ Top-level `authorization` → `[redacted]`.
- ✅ `TOKEN` → `[redacted]` (case-insensitive).
- ✅ `headers.cookie` and `headers["set-cookie"]` → `[redacted]` one level down;
  `headers.ok` survives as `"v"`.
- ✅ `authorizationHeader` **not** redacted — exact-match only, as documented.
- ✅ `{ deep: { a: { token } } }` **not** redacted — two levels down, as documented.
- ✅ `[{ token }]` inside an array **not** redacted — non-plain-object, as documented.
- ✅ `defineLogger({ redact: ["apiKey"] })` redacts `apiKey` **and** the built-in `token` — it
  unions, it doesn't replace.

*Correlation*
- ✅ `child({ requestId, tenant })` puts both on every line.
- ✅ A nested `child({ jobId })` accumulates all three.
- ✅ A call-site `{ tenant: "override" }` beats the bound value.

*Errors*
- ✅ An `Error` passed as `err` is lifted out of `fields` and lands as a top-level `err`.
- ✅ `err` carries `name`, `message` and a real `stack` string.
- ✅ `err.cause` is followed **exactly one level** — `err.cause.cause` is `undefined` on a
  three-deep chain.
- ✅ A non-`Error` `err` (a string) stays in `fields` untouched; no `event.err` is invented.
- ✅ `time` is ISO 8601 (`2026-08-07T23:25:11.190Z`).

*Provider selection*
- ✅ Unset `LOGGER_PROVIDER` selects the first registered provider.
- ✅ An unregistered name throws:
  `LOGGER_PROVIDER is "nope", which is not registered. Registered providers: capture.`
- ✅ With **zero** providers, the throw carries the install hint:
  `No providers are registered — install one, e.g. \`saasaloy add logger-console\`.`
- ✅ With zero providers **and** no `LOGGER_PROVIDER`, `create()` returns a working no-op whose
  `provider` is `"none"` — logging is silent, not fatal.
- ✅ A provider whose `write` throws does **not** propagate — the `try/catch` swallows it and the
  caller returns normally.

*The console provider*
- ✅ Level→method mapping is exactly `["log","log","log","warn","error","error"]` for
  trace/debug/info/warn/error/fatal.
- ✅ Every argument reaching `console.*` is an **object**, never a string — so Workers Logs can
  index the fields.
- ✅ `consoleLogger().name === "console"` — the factory name differs from the provider name on
  purpose, so the generated import can't shadow the global `console`.
- ✅ `fatal` survives on the event even though it rides `console.error`.

### The stale playground copy — and what it proves

The same probe was run first against `.dev/playground/packages/logger/src/`, which was scaffolded
earlier on this branch:

```sh
node --experimental-strip-types probe.ts
```

- ❌ `LOG_LEVEL=constructor` → `{"emitted":3,"level":"constructor"}` — all three levels emitted,
  including `trace` and `debug`.
- ❌ `LOG_LEVEL=__proto__` → same.
- ✅ The other 29 assertions passed.

```sh
diff .dev/playground/packages/logger/src/define.ts modules/logger/files/src/define.ts
```

```
<   return LEVELS[normalized as LogLevel] === undefined ? DEFAULT_LEVEL : (normalized as LogLevel);
---
>   return Object.hasOwn(LEVELS, normalized) ? (normalized as LogLevel) : DEFAULT_LEVEL;
```

The playground predates `c78fcba`. Two things follow, and both matter to the tester:

1. **The bug was real and the fix is real** — the same probe fails on the old guard and passes on
   the new one. TC-2.2 step 3 is the live version of this.
2. **The playground on disk cannot be trusted for this plan.** Scenario 1 starts with
   `pnpm play:reset` for that reason. The agent deliberately did **not** reset it — resetting is a
   destructive rebuild, and the pre-built artifacts were needed for the inspections below.

### Install shape, as found in the existing playground

No install was performed; these read the state a prior step left behind.

```sh
cat .dev/playground/saasaloy.json
```

- ✅ `installed: ["web", "logger", "logger-console", "api"]` — logger and its provider precede
  `api`, i.e. the resolver emitted the topological order ADR 0023 predicts.
- ✅ `aliases` carries `"@logger": "packages/logger/src"`.

```sh
cat .dev/playground/saasaloy-lock.json
```

- ✅ `logger-console` → `dependsOn: ["logger"]`; `api` → `dependsOn: ["logger", "logger-console"]`.

```sh
grep -n 'consoleLogger' .dev/playground/packages/logger/src/index.ts
```

- ✅ Exactly one import (`import {consoleLogger} from "./providers/console";`) and exactly one
  registration (`export const logger = defineLogger({ providers: [consoleLogger()] });`). The
  20-line comment above the patch point survived the codemod.

```sh
grep -n -A4 observability .dev/playground/apps/api/wrangler.jsonc
```

- ✅ One `observability` block, `enabled: true`, `head_sampling_rate: 1`; the `dev.port` block and
  the surrounding comments intact.

```sh
grep -n 'cf-ray\|createLogger\|Variables' .dev/playground/apps/api/src/index.ts
```

- ✅ `import { createLogger, type Logger } from "@repo/logger"` at line 1; `Variables` type at 19;
  `new Hono<{ Bindings: Bindings; Variables: Variables }>()` at 32; the middleware's
  `c.req.header("cf-ray") ?? crypto.randomUUID()` at 66.

```sh
ls -l .dev/playground/apps/api/node_modules/@repo/
```

- ✅ `logger -> ../../../../packages/logger` — the `workspace:*` dependency resolves.

```sh
ls .dev/playground/.agents/skills .dev/playground/.claude/skills
```

- ✅ `saasaloy-api` and `saasaloy-logger` in both; `logger-console` contributed none, per the
  provider-module convention.

### The built bundle, as found

```sh
wc -c .dev/playground/apps/api/dist/api/index.js
```

- ✅ **65,567 bytes** for the three-module build (unminified rolldown output). No `main` baseline
  was produced — that would need a rebuild — so the delta is left for TC-1.3 step 4 to record.

```sh
grep -c 'cf-ray' .dev/playground/apps/api/dist/api/index.js
```

- ✅ 1 — the middleware is in the bundle.

```sh
grep -c '\[redacted\]' .dev/playground/apps/api/dist/api/index.js
```

- ✅ 2 — the redaction constant survived bundling.

```sh
grep -o '"observability":{[^}]*}' .dev/playground/apps/api/dist/api/wrangler.json
```

- ✅ `{"enabled":true,"head_sampling_rate":1}` — Workers Logs is on in the deployable config, not
  only in the source comment.

### Dependency policy

```sh
pnpm deps:check
```

- ⚠️ Exits 1 with **8 outdated · 12 within-cooldown · 34 up-to-date** — a pre-existing condition,
  not something this branch introduced. The 8 outdated are `turbo`, `lucide-react`, `shadcn`,
  `@cloudflare/vite-plugin`, `vite` and `wrangler` across the base template and the `api`, `auth`
  and `database` modules. **None is in `modules/logger`.**
- ✅ `modules/logger/files/package.json` appears only in the *within-cooldown* group, for
  `@cloudflare/workers-types 5.20260801.1 → 5.20260804.1` — the same pin `modules/api` carries, so
  the two agree.
- ✅ `modules/logger/files/package.json` declares `"dependencies": {}` and exact-pinned devDeps
  (`@cloudflare/workers-types` `5.20260801.1`, `@repo/tsconfig` `workspace:*`, `rimraf` `6.1.3`,
  `typescript` `7.0.2`) with a `rimraf`-backed `clean` script, per `AGENTS.md`.

### Cleanup

- ✅ No process was started, so none was left running: no `wrangler dev`, no `workerd`, no `vite`.
- ✅ `git status` in the worktree is clean apart from this new, uncommitted QA document.
- ✅ `.dev/playground` is byte-for-byte as the agent found it — nothing installed, reset, rebuilt or
  removed.

## Not covered / needs human judgment

- **Workers Logs in the Cloudflare dashboard.** The whole point of logging an object rather than a
  string is that the platform indexes its fields — and that can only be seen after a `wrangler
  deploy` on an account. Nothing here proves a `requestId` is actually queryable, that
  `head_sampling_rate` behaves as a cost dial, or that the 256 KB truncation flag appears. Deferred
  to a deploy.
- **`wrangler tail`.** Same reason: needs a deployed Worker.
- **The 256 KB per-log cap.** Documented in the skill, never exercised. A field big enough to
  trigger `truncated: true` was not logged.
- **A second provider.** `logger-console` is the only one, so the `LOGGER_PROVIDER`-picks-between-
  several path, and the both-install-orders check the `email` plan ran, have no second implementation
  to run against. The `create-provider` `logger` mode is reviewed as text only (TC-3.1); no
  `logger-<x>` has been authored through it end to end.
- **`createLogger(env)` outside a request** — a `scheduled()` handler or a queue consumer. `api`
  scaffolds neither, so the documented escape hatch is prose, not code under test.
- **Concurrency.** No simultaneous requests, so "two in-flight requests keep distinct `requestId`s"
  is inferred from the per-request `child()` rather than observed under load. TC-2.1 step 2 checks
  sequential requests only.
- **Performance.** No measurement of what redaction costs per log call, and no high-volume run. The
  one-level bound is justified on CPU grounds in the source; that justification is untested.
- **A bundle-size delta against `main`.** Would need a second build; TC-1.3 leaves a slot to record
  it if anyone wants the number.
- **Accessibility, compatibility, responsive/dark-mode.** Deliberately skipped — this change ships
  no UI. `apps/web` and `apps/admin` are untouched.
- **`saasaloy doctor`-style checks** — e.g. warning that `LOGGER_PROVIDER` names something
  uninstalled *before* the first request 500s. Not built (#47), so TC-2.4's failure surfaces at
  request time.
- **Real log-retention review.** Redaction is a backstop, not a guarantee; whether this project's
  actual routes put secrets in `fields` is a judgment no test makes.
