# QA Plan: react-email as an opt-in template and render engine

_Generated 2026-09-03 · against `bcd193f` · covers issue #59, branch `issue-59-react-email-as-the-template-and-render-engine` (6 commits on `655ac7d`, 17 files, +867/-9)_

## Summary

- `saasaloy add email-react` scaffolds `packages/email-react`, a JSX template layer built on React Email that sits beside the tagged-template idiom in `packages/email`.
- "Working" means a JSX welcome template renders to `{ subject, html, text }`, sends through an existing provider with no provider change, and shows correctly in the React Email preview server and in a real inbox.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-59-react-email-as-the-template-and-render-engine` at `bcd193f`.
- You need a machine with a browser. Scenario 1 and Scenario 2 are visual. The dev box is headless, so run this plan on your laptop, or forward the ports over Tailscale.
- Ports 3000, 3002 and 4000 must be free. `apps/web` pins 3000, the preview server pins 3002, and the api Worker pins 4000. Every one uses `strictPort` or an explicit `--port`, so a busy port fails loudly.
- You need an email address you can read, for Scenario 3.
- No cloud account is needed. The `email-console` provider writes the message to the Worker log.

Build the playground once:

```sh
pnpm install && pnpm build && pnpm run play:reset
```

Add the three modules:

```sh
cd .dev/playground && ./saasaloy add email email-console email-react && cd -
```

Install the new workspace:

```sh
pnpm -C .dev/playground install
```

Set the provider env vars the api Worker reads:

```sh
printf 'EMAIL_PROVIDER=console\nEMAIL_FROM=hello@acme.test\n' >> .dev/playground/apps/api/.dev.vars
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: playground installed, nothing running | The preview server shows the welcome template | 🔴 Critical |
| TC-1.2 | 1: playground installed, nothing running | The preview reloads after a template edit | 🟡 Normal |
| TC-1.3 | 1: playground installed, nothing running | A second template appears in the list | 🟢 Low |
| TC-2.1 | 2: every dev server running together | Root `pnpm dev` starts web and the preview without a port clash | 🔴 Critical |
| TC-3.1 | 3: api Worker running, route sends the JSX welcome | The plaintext part reads well | 🟡 Normal |
| TC-3.2 | 3: api Worker running, route sends the JSX welcome | The HTML part renders in a real inbox | 🟡 Normal |
| TC-4.1 | 4: repo checkout, no app running | The skill leads an agent to a working template | 🟢 Low |

## Scenario 1: playground installed, nothing running

**Setup.** Run once, for every case in this scenario.

1. Start the React Email preview server. It pins port 3002.

```sh
pnpm -C .dev/playground --filter @repo/email-react dev
```

2. Wait for the line `Running preview at: http://localhost:3002`.

- [ ] Setup complete

### TC-1.1: The preview server shows the welcome template · 🔴 Critical

**Goal.** A designer can open the preview server and see the shipped welcome email as a recipient would.

**Steps**

1. Open `http://localhost:3002` in the browser.
   - [ ] The sidebar lists `welcome`
   - [ ] The page carries no error overlay and no stack trace
2. Click `welcome`.
   - [ ] The preview pane renders a laid-out email, not raw markup or a blank frame
     - the heading reads `Welcome, Ada.`
     - the body names `Acme` and reads as a sentence, with no `undefined` and no `{name}` left in the text
     - the dark button reads `Open Acme`
     - a horizontal rule sits above the small grey footer line
   - [ ] The button is a real link and its target is `https://app.acme.com`
     - hover it and read the status bar, or use the browser's inspector
3. Narrow the browser window to a phone width, about 390px.
   - [ ] The email stays in one column and nothing is cut off at the right edge
4. Switch the preview to its plain-text view. React Email offers this as a tab or a toggle above the pane.
   - [ ] The plain-text view holds the same words as the HTML view, with no tags and no CSS

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: The preview reloads after a template edit · 🟡 Normal

**Goal.** The preview server is usable as a design loop, not only as a one-shot render.

**Steps**

1. Open `.dev/playground/packages/email-react/src/templates/welcome.tsx` in an editor.
2. Change the heading text from `Welcome, {name}.` to `Hello, {name}.` and save.
   - [ ] The preview pane in the browser updates within a few seconds, with no manual reload
3. Undo the edit and save again.
   - [ ] The pane returns to `Welcome, Ada.`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.3: A second template appears in the list · 🟢 Low

**Goal.** The preview-wrapper convention is discoverable, so a second template needs no extra registration.

**Steps**

1. Copy the welcome template to a second file.

```sh
cp .dev/playground/packages/email-react/src/templates/welcome.tsx .dev/playground/packages/email-react/src/templates/reset.tsx
```

2. Open `reset.tsx`. Rename `WelcomeEmail` to `ResetEmail`, `welcome` to `reset`, `welcomePreviewProps` to `resetPreviewProps`, and `WelcomePreview` to `ResetPreview`. Save.
   - [ ] The sidebar lists `reset` beside `welcome`
   - [ ] The `reset` preview renders the same way `welcome` does
3. Delete the default export line from `reset.tsx` and save.
   - [ ] `reset` disappears from the list, which is the documented behaviour for a file with no default export
4. Delete the file.

```sh
rm .dev/playground/packages/email-react/src/templates/reset.tsx
```

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
git -C .dev/playground checkout -- packages/email-react/src/templates/ 2>/dev/null; pkill -f "react-email"
```

## Scenario 2: every dev server running together

This scenario tests the fix for review finding S1. The React Email CLI defaults to port 3000, which `apps/web` already holds.

**Setup.** Run once, for every case in this scenario.

1. Confirm nothing holds the three ports.

```sh
ss -ltn | grep -E ':3000|:3002|:4000' || echo "ports free"
```

- [ ] Setup complete

### TC-2.1: Root `pnpm dev` starts web and the preview without a port clash · 🔴 Critical

**Goal.** A project that installs `email-react` can still run its whole dev stack with one command.

**Steps**

1. Start every dev server at once. `turbo run dev` marks `dev` persistent, so this starts `apps/web`, `apps/api` and the preview server together.

```sh
pnpm -C .dev/playground dev
```

2. Read the combined log.
   - [ ] No line reports a port already in use, and no process exits
   - [ ] The log names `http://localhost:3000` for web and `http://localhost:3002` for the preview
3. Open `http://localhost:3000` in the browser.
   - [ ] The Astro landing page renders, not the React Email preview
4. Open `http://localhost:3002` in a second tab.
   - [ ] The React Email preview renders and lists `welcome`
5. Stop the stack with Ctrl-C.
   - [ ] Every process stops and the ports free up

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after the case above, before moving to Scenario 3.

```sh
pkill -f "react-email"; pkill -f "vite.js dev"
```

## Scenario 3: api Worker running, route sends the JSX welcome

**Setup.** Run once, for every case in this scenario.

1. Add a throwaway route that sends the JSX welcome. Create `.dev/playground/apps/api/src/routes/mail.ts` with a handler that calls the template and returns the rendered message.

```sh
cat .dev/playground/packages/email-react/src/templates/welcome.tsx | head -30
```

2. Wire the route into `apps/api/src/index.ts`. The call site is the one line the module's skill documents:

```ts
await mail.send({ to: "ada@example.com", ...(await welcome({ name: "Ada", appName: "Acme", ctaUrl: "https://app.acme.com" })) });
```

3. Start the api Worker.

```sh
pnpm -C .dev/playground --filter @repo/api dev
```

- [ ] Setup complete

### TC-3.1: The plaintext part reads well · 🟡 Normal

**Goal.** A recipient whose client shows plain text gets a readable message, not a stripped-tag soup.

**Steps**

1. Send one message.

```sh
curl -sS -i -X POST http://localhost:4000/mail
```

   - [ ] The response status is 200
2. Read the console provider's block in the Worker log.
   - [ ] The plain-text body reads as English prose a person would send
     - the heading line is present and legible
     - the button became the label and its URL side by side, such as `Open Acme https://app.acme.com`
     - the horizontal rule became a dashed line, not a run of tag names
     - the preview line does not repeat inside the body
   - [ ] No HTML tag, CSS property or `&nbsp;` appears anywhere in the text

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-3.2: The HTML part renders in a real inbox · 🟡 Normal

**Goal.** React Email's nested-table output survives a real mail client, which is the reason to adopt it.

**Steps**

1. Change the provider registration in the playground to log the HTML too. `consoleEmail({ html: true })` is the option `modules/email-console/files/console.ts` reads.
2. Send one message again.

```sh
curl -sS -i -X POST http://localhost:4000/mail
```

3. Copy the logged HTML into a file and mail it to yourself, or paste it into a mail-client preview tool.
4. Open the message in at least two clients. Gmail on the web and Outlook are the pair worth checking.
   - [ ] The layout holds in both clients
     - the card sits centred on the grey page background
     - the button keeps its dark fill, its rounded corners and its white label
     - the footer stays small and grey
   - [ ] The button click opens `https://app.acme.com`
5. Open the same message on a phone.
   - [ ] The layout stays in one column and the button stays tappable

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Run after every case above, before moving to Scenario 4.

```sh
pkill -f "vite.js dev"; pkill -f "workerd serve"
```

## Scenario 4: repo checkout, no app running

**Setup.** Run once, for the case in this scenario.

1. Open `modules/email-react/skills/saasaloy-email-react/SKILL.md` in an editor.

- [ ] Setup complete

### TC-4.1: The skill leads an agent to a working template · 🟢 Low

**Goal.** The guidance that ships with the module is enough to write a second template without reading the source.

**Steps**

1. Read the skill top to bottom as if you had never seen the module.
   - [ ] The helper contract is clear: what `defineReactTemplate` takes and that it returns a promise
   - [ ] The `await` at the call site is stated, and the failure mode of forgetting it is named
   - [ ] The `safeUrl` rule for a caller-supplied `href` is stated as a rule, not as a footnote
   - [ ] The preview-wrapper convention and the pinned port 3002 both appear
2. Ask your coding agent to add a `password-reset` template using only this skill as context.
   - [ ] The agent produces a file that follows the convention, with a named export and a default preview export
   - [ ] The agent awaits the template at the call site

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

## Automated verification (by AI agent)

_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off. Every result below is transcribed from the run's verification and fix steps on 2026-09-03; nothing was re-run to write this plan._

### The repo gate

```sh
pnpm test && pnpm build
```

```sh
pnpm lint
```

```sh
pnpm typecheck
```

- ✅ `pnpm test` → 26 tests, 26 pass, 0 fail, across `turbo run test`, `test:modules` and `test:scripts`
- ✅ `pnpm build` → 1 task successful
- ✅ `pnpm lint` → all four passes clean: `lint:types`, `lint:code`, `lint:css`, `format:check`
- ✅ `pnpm typecheck` → 1 task successful

### AC1 — the ADR and the reversal note

```sh
ls docs/adr/adr-0031-*.md && grep -n "Status\|request-time\|gzip\|opt-in" docs/adr/adr-0031-*.md
```

- ✅ `docs/adr/adr-0031-react-email-is-an-opt-in-render-engine-2026-09-03.md` exists, holds `## Status`, records request-time render, the opt-in module shape and the measured byte counts
- ✅ The 2026-08-04 plan's §Templating row carries the reversal note and names both the new plan and the ADR; the new plan links back to the ADR

### AC2 — the descriptor, the scaffold, the render, and the untouched providers

```sh
node -e 'const d=require("./modules/email-react/registry-item.json");console.log(d.name,d.type,d.dependsOn,d.scaffolds[0].workspace)'
```

```sh
git diff --stat main -- modules/email modules/email-console modules/email-cloudflare modules/email-plunk
```

- ✅ Descriptor parses: `email-react`, `saasaloy:feature`, `dependsOn: ["email"]`, scaffolds `packages/email-react` with alias `@email-react`
- ✅ The only change under the email modules is one line in `modules/email/files/src/index.ts`, which adds `safeUrl` to the barrel. `provider.ts`, `define.ts`, `render.ts` and every `email-<provider>` module are unchanged
- ✅ A bundled probe rendered the welcome template: keys are exactly `html`, `subject`, `text`; `html` starts `<!DOCTYPE html`; `text` is 335 characters
- ✅ Hostile props are escaped: `<script>` never appears raw in `html` or `text`
- ✅ `safeUrl` throws on `javascript:alert(1)` and on a relative URL, before render, so the promise rejects

### AC3 — the playground typecheck and the end-to-end send

```sh
pnpm -C .dev/playground typecheck
```

```sh
curl -sS -i -X POST localhost:4000/mail
```

- ✅ `@repo/email-react:typecheck` passes. No `TS6142` and no JSX error anywhere, so the `.tsx` template compiles under `apps/api`'s tsconfig
- ❌ `@repo/api:typecheck` fails with two errors at `src/index.ts(119,33)` and `(145,48)`: `Bindings` is not assignable to `LoggerEnv`. **Both are pre-existing.** ADR 0030 records them as red on `main` as well, so this branch does not cause them and does not fix them. AC3's literal wording, `pnpm typecheck` exits 0, is therefore not met. It needs its own issue
- ✅ `POST /mail` returned 200 with `{"keys":["html","subject","text"], …}`; the Worker log carried the console provider's block with the subject `Welcome to Acme` and the plaintext body
- ✅ The `email-console` provider took the awaited `EmailContent` with no change, so the async template is invisible to providers

### AC4 — the measured bundle delta

```sh
cd .dev/playground/apps/api && pnpm exec wrangler deploy --dry-run --outdir /tmp/bundle-with && wc -c /tmp/bundle-with/index.js && gzip -c /tmp/bundle-with/index.js | wc -c
```

- ✅ Measured twice on `wrangler 4.127.1`: 1,281,354 B raw, 284,871 B gzipped with the JSX welcome imported
- ✅ Review finding N3 was applied. ADR 0031 and both plans now carry the re-measured pair and the recomputed delta, +1,196,179 B raw and +262,632 B gzipped, and both documents state that the byte counts belong to the throwaway route measured on 2026-09-03
- ⚠️ The tagged-template baseline, 22,239 B gzipped, was not re-measured. Doing so needs the route edited back to the tagged import

### AC5 — the preview server

```sh
pnpm -C .dev/playground --filter @repo/email-react dev
```

```sh
curl -sS localhost:3002 | grep -o "welcome" | head -2
```

```sh
curl -sS -o /tmp/preview-welcome.html -w "%{http_code}\n" localhost:3002/preview/welcome
```

- ✅ The server starts, reports `Running preview at: http://localhost:3002`, and binds 3002. `ss -ltnp` showed nothing on 3000 while it ran, which is the collision review finding S1 named
- ✅ The index response lists `welcome`; `/preview/welcome` returns 200 and its HTML carries the sample props, `Acme` and `https://app.acme.com`
- ⚠️ The visual half is human-only. The dev box is headless. That is TC-1.1 above

### AC6 — `deps:verify` fails on a pin skew

```sh
node scripts/verify-pins.ts; echo "exit=$?"
```

```sh
node --test scripts/verify-pins.test.ts
```

- ✅ Clean state: `verify-pins: 2 pin rule(s) agree across their manifests.`, exit 0
- ✅ Skewed state, tested against a copy in `/tmp` so no tracked file moved: exit 1, with both file paths and both versions in the message. An absent pin also exits 1 and prints `(absent)`
- ✅ A stand-in chain confirmed `deps:verify` stops at `verify:pins` and never reaches `play:init`
- ✅ `verify-pins.test.ts`: 11 tests, 11 pass. Review finding N4 was applied, so `PIN_RULES` now covers `@types/react` alongside `react`

### AC7 — the docs and the skill

```sh
head -5 modules/email-react/skills/saasaloy-email-react/SKILL.md && node -e 'console.log(require("./modules/email-react/registry-item.json").agent.skills)'
```

- ✅ The skill's frontmatter `name` is `saasaloy-email-react`, matching its folder, and `agent.skills[]` lists `skills/saasaloy-email-react`
- ✅ `saasaloy-email`'s template-contract section names the opt-in JSX idiom, states that a JSX template returns a promise, and points at `saasaloy-email-react`
- ✅ `saasaloy add email-react` copies the skill into the playground's `.claude/skills/`

### The module conventions

```sh
pnpm -C .dev/playground/packages/email-react run clean
```

- ✅ `clean` is declared with an exact-pinned `rimraf 6.1.3`, exits 0, and removes `.react-email/` and `*.tsbuildinfo`

## Not covered / needs human judgment

- **The visual half of the preview server and of the delivered email.** No browser and no mail client on the dev box. TC-1.1, TC-3.1 and TC-3.2 exist for this.
- **The tagged-template bundle baseline, 22,239 B gzipped.** Recorded from the implementation run and not re-measured, because doing so needs the throwaway route edited back.
- **A `tsc` rejection of a forgotten `await` at a call site.** The runtime consequence was confirmed, and spreading an un-awaited promise yields only `{ to }`. The type error itself was not exercised.
- **A from-scratch `play:reset` plus `add`.** The verification used the playground as the implementation step left it. The Environment section above rebuilds it, so a tester running this plan covers the gap.
- **The full `pnpm deps:verify` chain end to end.** Only `verify:pins` and the chain's short-circuit were exercised. The rest is a multi-minute playground rebuild.
- **`saasaloy remove email-react`.** Not exercised in either direction.
- **A real `workerd` deploy.** The end-to-end send ran through the Vite Cloudflare plugin, and the render probe ran the `workerd` export condition under Node.
- **Accessibility, concurrency and performance dimensions.** Deliberately skipped. The change adds a build-time template layer and a dev-only preview server; it adds no user-facing screen, no concurrent path and no data store.

## Known follow-ups

- **AC3 is not met as written.** `pnpm typecheck` in a scaffolded playground is red on two pre-existing `Bindings` / `LoggerEnv` errors in `@repo/api`. ADR 0030 records them as red on `main` too. This deserves its own issue.
- Every review finding, `S1` and `N1` through `N4`, was applied on this branch. `.afkkit/findings.md` holds the full report.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
