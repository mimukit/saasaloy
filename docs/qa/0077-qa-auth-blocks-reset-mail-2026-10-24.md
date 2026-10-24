# QA Plan: auth sign-in blocks and the password reset mail

_Generated 2026-10-24 · against `cbb8aceb` (clean), refreshed at `2e07fced` (clean) · covers issue #225: the `SignInCard` and `SignUpCard` blocks, the admin `/login` route, the password reset mail, and the 12-character password rule_

## Summary
- `auth` ships two sign-in blocks on the `shell` kit, and the admin `/login` renders one. With `email` installed, `auth` also sends a password reset mail.
- Working means the admin login looks like the approved r2 card, signs a seeded admin in, and a reset request prints a mail in the api log.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-225-ship-sign-in-blocks-and-send-the-password-reset-mail` at `cbb8aceb`.
- Project: `.dev/playground`, made by `pnpm play:init` from this branch, with `auth` (`database-d1`), `email`, `email-console` and `admin` (which brings `shell`). Testing mode is `tests-after`.
- Admin app: `http://localhost:3001`. Api: `http://localhost:4000`.
- Seed accounts use the password `saasaloy-dev-password`: `admin@example.test` (admin), `member@example.test` (plain user).
- The approved r2 screenshots are on the branch `issue-227-add-the-customer-app-module`, in `docs/plans/assets/0074-app-mockup-r2/sign-in-*.png`.

Start the api, in the playground:

```sh
cd .dev/playground/apps/api && pnpm dev
```

Start the admin app, in a second terminal:

```sh
cd .dev/playground/apps/admin && pnpm dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Signed out, on the admin login | The admin login matches the approved card | 🔴 Critical |
| TC-1.2 | 1: Signed out, on the admin login | A failed sign-in reads well | 🟢 Low |

## Scenario 1: Signed out, on the admin login

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login` in a private window, so no session cookie exists.

- [ ] Setup complete

### TC-1.1: The admin login matches the approved card  ·  🔴 Critical

**Goal.** The admin login renders the approved r2 card with the admin copy, in both themes and at both widths.

**Steps**

1. Compare the four screenshots with the approved r2 sign-in screenshots.
   - [ ] The card has the r2 shape: the brand mark beside the site name, the title, the description, two fields and a full-width button
     - the admin copy replaces the r2 copy: "Sign in to Saasaloy admin" and "Use an account with the admin role."
     - the card has no footer link, on purpose: admin has no sign-up
     - the canvas is the admin `bg-background`, not the `app` canvas
     - screenshot: `docs/qa/assets/0077-qa-auth-blocks-reset-mail/login-light-1440.png` light 1440 px · `login-dark-1440.png` dark 1440 px · `login-light-360.png` light 360 px · `login-dark-360.png` dark 360 px
   - [ ] The site name beside the brand mark is acceptable on the admin login, where the old login showed the mark only

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: A failed sign-in reads well  ·  🟢 Low

**Goal.** The error line sits well in the card and reads as one clear message.

**Steps**

1. Look at the error screenshot.
   - [ ] The red line above the button is legible and does not crowd the button
     - screenshot: `docs/qa/assets/0077-qa-auth-blocks-reset-mail/login-error-light-1440.png` light 1440 px

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Close the private window.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run in the repo at `cbb8aceb` (each once, into a log):

```sh
pnpm lint
```

```sh
pnpm typecheck
```

```sh
pnpm test
```

```sh
pnpm build
```

- ✅ `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` → each exit 0.

Commands run in `.dev/playground`, after `add auth --with database-d1`, `add email-console` and `add admin`:

```sh
pnpm typecheck && pnpm lint && pnpm test && pnpm build
```

- ✅ project gates → typecheck, lint, test (148 tests) and build exit 0.
- ✅ C2 · `add auth` with no `shell` → no `packages/ui/src/blocks/auth/`; with no `email` → no reset plugin, template, test or patch, and `@repo/auth` typechecks.
- ✅ C3 · `add email-console` after `auth` → `backfill` lines for `reset-password.test.ts`, `templates/reset-password.ts` and `plugins/reset-password-mail.ts`, plus the `plugins` and `package.json` patches.
- ✅ C7 · `add admin` (brings `shell`) → `backfill` lines for `blocks/auth/auth-card.tsx`, `sign-in.tsx` and `sign-up.tsx`.
- ✅ C5 · `apps/api/src/routes/reset-password.test.ts` → 2 tests pass; removing `resetPasswordMail()` turns both red.
- ✅ C4 · the "password length" tests in `auth.test.ts` pass; setting the minimum to 8 turns one red.
- ✅ C8 · `packages/cli/templates/base/oxlint.config.mjs` lists `packages/ui/src/blocks/auth/**` in the twin-primitive rule.
- ✅ C6 · the three block files import only `react`, `@repo/ui`, `@repo/ui/blocks/auth/*`, `@repo/ui/blocks/shell/brand-mark` and `@repo/ui/components/shell/{button,field,input}`; no `fetch`, `import.meta`, `localStorage`, store, router or `@repo/auth`.
- ✅ refresh at `2e07fced` · the fix commit changes only `modules/auth/skills/saasaloy-auth/SKILL.md` (`git diff --stat cbb8aceb 2e07fced`), so every code result above still holds; `pnpm lint` at `2e07fced` → exit 0.
- ✅ C13 · the "Wire-up" example, copied into the playground admin app with its client import pointed at `@admin/lib/auth`, passes `tsc --noEmit` at `2e07fced` (the scratch file was deleted after).
- ✅ C13 · `saasaloy-auth` has "Wire-up: the sign-in and sign-up blocks", "Password rules" and "Password reset mail".

Api checks against the running api:

```sh
curl -s -X POST http://localhost:4000/auth/request-password-reset -H 'content-type: application/json' -H 'origin: http://localhost:3000' -d '{"email":"member@example.test","redirectTo":"http://localhost:3000/reset-password"}'
```

- ✅ C1 → `{"status":true,...}`, and the api log prints `to: member@example.test`, `subject: Reset your Saasaloy password` and `http://localhost:4000/auth/reset-password/<token>?callbackURL=http%3A%2F%2Flocalhost%3A3000%2Freset-password`.

```sh
curl -s -X POST http://localhost:4000/auth/sign-up/email -H 'content-type: application/json' -H 'origin: http://localhost:3000' -d '{"email":"short@example.test","name":"Short","password":"elevenchars"}'
```

- ✅ C4 → `{"message":"Password too short","code":"PASSWORD_TOO_SHORT"}`. The same call with `twelve-chars` answers 200.

### Browser checks
_Driven with `playwright-cli` against `http://localhost:3001` at `cbb8aceb`. Screenshots in `docs/qa/assets/0077-qa-auth-blocks-reset-mail/`._

- ✅ `/login` · heading → `Sign in to Saasaloy admin`; description → `Use an account with the admin role.`; site name → `Saasaloy`.
- ✅ `/login` · footer links in the card → none (no `signUpHref`).
- ✅ `/login` · page canvas → `main` has `bg-background`.
- ✅ `/login` · fields → `email` (`autocomplete=username`), `password` (`autocomplete=current-password`).
- ✅ `/login` · horizontal overflow at 1440 px and 360 px, dark and light → none.
- ✅ `/login` · first visit theme → `dark`; after `theme=light` → light.
- ✅ C9 · wrong password for `admin@example.test` → `role="alert"` inside the form, directly above the button, text `Invalid email or password`; the button leaves its loading state; the email stays filled.
- ✅ C10 · `admin@example.test` with the seed password → URL `/`, the sign-in card is gone, the shell `nav` renders.
- ✅ `member@example.test` with the seed password → stays on `/login` with `Invalid email or password`, the same text as a wrong password.
- ✅ console errors → only the 401 from the refused sign-in and a 404 for `/favicon.ico`.

## Not covered / needs human judgment
- `SignUpCard` renders on no route in this change. #227 renders it on `/sign-up` in `app`, and its own QA covers the look.
- The `app` canvas (`bg-sidebar`) and an `app.css` built on `brand.css`: `app` does not exist yet (#227).
- A real mail provider. The check uses `email-console` only.
- The reset screen that reads the token: #230 plans it.
- The "could not reach the api" message: it needs the api down during a sign-in, which the agent did not do.
- Concurrency, performance and data persistence: the change adds no table and no new query.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
