# QA Plan: upload components and a server upload helper (#284)

_Generated 2026-10-26 · against `f0f94727` (clean; refreshed after the fix commit, first run at `ed023e2a`) · covers the `@repo/storage` upload helpers, the `FileDrop` component, the `file-uploads` block on `FileDrop`, and the skill section_

## Summary
- The storage module gives an api route three checks for an upload through the Worker, and gives the browser a `FileDrop` picker.
- Working means a route refuses an oversize body and a false file type, and `FileDrop` looks like the approved mockup in both modes.

## Environment
True for the whole plan. Do this once, before Scenario 1.

- Branch: `issue-284-upload-components`.
- Approved mockup: `docs/plans/assets/0090-upload-components/round1-*.png`. Multiple mode uses layout B.
- The playground is `.dev/playground`. It is disposable; `pnpm play:destroy` removes it.
- The QA user is `qa284@example.com` with the password `qa284-password-1`. It is the first account, so it has the `superadmin` role.
- The web harness page is `http://localhost:3000/qa-file-drop`. It exists only in the playground.

Build the playground and add the modules:

```sh
pnpm play:init && cd .dev/playground && ./saasaloy add database-d1 -y && ./saasaloy add file-uploads -y && ./saasaloy add storage-memory -y && pnpm install
```

Fill `packages/env/.env` from `.env.example`. Set `STORAGE_PROVIDER=memory`, `STORAGE_PROXY_URL=http://localhost:4000`, and a random `BETTER_AUTH_SECRET` and `STORAGE_URL_SECRET`. Then:

```sh
pnpm env:setup && pnpm --filter @repo/db db:generate && pnpm db:setup
```

Start the api, the admin app and the web app, each in its own terminal:

```sh
pnpm --filter api dev
```

```sh
pnpm --filter admin dev
```

```sh
pnpm --filter web dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Web harness, no files picked | FileDrop matches the approved mockup | 🔴 Critical |
| TC-1.2 | 1: Web harness, no files picked | Dragging a file over the zone | 🟡 Normal |
| TC-2.1 | 2: Admin signed in, on /files | The upload card matches layout B | 🔴 Critical |

## Scenario 1: Web harness, no files picked

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3000/qa-file-drop` at a width of 1440 px.

- [ ] Setup complete

### TC-1.1: FileDrop matches the approved mockup  ·  🔴 Critical

**Goal.** Both modes of `FileDrop` look like the round 1 mockup in light and dark.

**Steps**

1. Pick `bank-slip.jpg` in the Single zone. Add one JPG and one PDF in the Multiple zone, then add two more files.
   - [ ] Each state matches `round1-single-*.png` and `round1-multi-*.png` layout B
     - Single: dashed zone, then one row with a thumbnail, the name, the size and a remove button
     - Uploading: the progress bar and a disabled remove button
     - Multiple: the rows first, then the one-line "Add more" bar, red with the refusal under it
     - screenshot: `/tmp/qakit/0090-qa-upload-components-2026-10-26/single-empty-light-1440.png`
     - screenshot: `/tmp/qakit/0090-qa-upload-components-2026-10-26/single-refused-light-1440.png`
     - screenshot: `/tmp/qakit/0090-qa-upload-components-2026-10-26/multi-refused-light-1440.png`
2. Set dark mode. Look at the page again.
   - [ ] The same states read clearly in dark
     - screenshot: `/tmp/qakit/0090-qa-upload-components-2026-10-26/harness-dark-1440.png`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Dragging a file over the zone  ·  🟡 Normal

**Goal.** The drag state is clear, and a drop adds the file.

**Steps**

1. Reload the page. Drag a JPG from the file manager over the Single zone, and hold it there.
   - [ ] The zone border and the icon change to the primary color, and the text reads "Drop it to add it"
2. Drop the file.
   - [ ] The file shows as a row with its thumbnail

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Reload the page.

## Scenario 2: Admin signed in, on /files

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:3001/login`. Sign in as `qa284@example.com`.
2. Open `http://localhost:3001/files`.

- [ ] Setup complete

### TC-2.1: The upload card matches layout B  ·  🔴 Critical

**Goal.** The admin upload card uses FileDrop as the approved admin mockup shows.

**Steps**

1. Add `bank-slip.jpg` and `invoice.pdf` to the Files zone.
   - [ ] The card matches `round1-admin-light.png` layout B, and the image row shows its thumbnail
     - screenshot: `/tmp/qakit/0090-qa-upload-components-2026-10-26/admin-files-two-light-1440.png`
2. Click "Upload 2 files".
   - [ ] Both files leave the picker and show in the Files list as `ready`
     - screenshot: `/tmp/qakit/0090-qa-upload-components-2026-10-26/admin-files-after-light-1440.png`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

**Reset.** Delete the uploaded rows with the Delete button.

## Automated verification (by AI agent)
_Checks the agent ran itself. No action needed from the tester; listed here for context and sign-off._

Commands run (one per block; chain with `&&` when they must run together):

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
cd .dev/playground && pnpm typecheck
```

- ✅ `pnpm lint` at `f0f94727` → exit 0, all four passes.
- ✅ `pnpm typecheck` at `f0f94727` → exit 0.
- ✅ `pnpm test` at `f0f94727` → exit 0; `test:modules` passes 1021 tests, including 14 in `upload.test.ts` and 10 in `file-drop.test.ts`.
- ✅ C1 to C3 → `upload.test.ts` covers the cap with no Content-Length, each signature, a PNG refused where only PDF is allowed, another tenant's key, a key with `..`, and the filename pattern. A deliberate break of each check turned a test red.
- ✅ C7 → `saasaloy add file-uploads` and `storage-memory` wrote `packages/ui/src/components/file-drop.tsx` and `src/lib/file-drop.ts`, added `"react-dropzone": "20.1.4"` to `packages/ui/package.json`, and `globals.css` carries the `@source` line. The playground typecheck exits 0.
- ✅ C9 → the skill's route example is `apps/api/src/routes/receipts.ts` in the playground, mounted at `/receipts`. It type-checks, and oxlint exits 0 on it.
- ⚠️ `cd .dev/playground && pnpm lint` → exit 1, one error in `packages/ui/src/blocks/shell/data-table.tsx:271` (`consistent-return`). This branch does not change that file. The acceptance check ran the same lint on a playground built from `origin/main` and got the same error, so it is pre-existing.

C10, the skill's route against the api on `localhost:4000`, with a session cookie from the sign-up below:

```sh
curl -s -c /tmp/jar -H 'content-type: application/json' -H 'origin: http://localhost:3001' -d '{"email":"qa284@example.com","password":"qa284-password-1","name":"QA 284"}' http://localhost:4000/auth/sign-up/email
```

```sh
curl -s -b /tmp/jar -w '\n%{http_code}\n' -H 'origin: http://localhost:3001' -H 'content-type: application/octet-stream' --data-binary @/tmp/qa284.png http://localhost:4000/receipts/order-1
```

- ✅ A 1×1 PNG → `201 {"key":"t/<user id>/receipts/order-1/<uuid>.png"}`.
- ✅ An HTML file named `qa284-fake.png` → `415 {"error":{"code":"unsupported_type","message":"A receipt is a JPG, PNG or PDF file."}}`.
- ✅ A 6 MB file → `413 {"error":{"code":"too_large","message":"A receipt is at most 5 MB."}}`.

### Browser checks
_Driven with `playwright-cli` against `http://localhost:3000/qa-file-drop` and `http://localhost:3001/files`, first at `ed023e2a`, then the two fixed checks again at `f0f94727`. Screenshots in `/tmp/qakit/0090-qa-upload-components-2026-10-26/`._

- ✅ harness · Single, `statement.pdf` picked → alert "statement.pdf is not a JPG, PNG or WebP image."
- ✅ harness · Single, `bank-slip-2026-10-26.jpg` picked → row "bank-slip-2026-10-26.jpg | 12 KB", the alert is gone, the thumbnail is a `blob:` image.
- ✅ harness · Uploading → `progressbar` `aria-valuenow` = `62`, and the remove button is disabled.
- ✅ harness · Disabled → the input is disabled.
- ✅ harness · Multiple, a JPG and a PDF picked → 2 rows, then "Add more, or drop files here".
- ✅ harness · Multiple, two more picked with max 3 → 3 rows; alert "You can attach at most 3 files. receipt-photo-4.jpg was not added."; the bar has `aria-invalid="true"`.
- ✅ harness · Multiple, one row removed → 2 rows, and the alert clears.
- ✅ harness · horizontal overflow at 1440 px and at 375 px → none.
- ✅ harness · the zone is in the tab order → `tabindex="0"`.
- ✅ admin `/files` · two files picked → the submit button reads "Upload 2 files".
- ✅ admin `/files` · submit → the picker empties; the Files list shows `invoice-INV-1042.pdf` and `bank-slip-2026-10-26.jpg`, both `ready`. A third `pending` row is left from a first attempt that ran before `STORAGE_PROXY_URL` was set.
- ✅ admin `/files` · a failed submit (proxy 404) → both files stay in the picker, and the app shows "The storage target refused the file (404)."
- ✅ admin `/files` · the image row's thumbnail, at `f0f94727` → the `<img>` loads with `naturalWidth` 400, and the console shows no `ERR_FILE_NOT_FOUND`. At `ed023e2a` it was a broken image: StrictMode ran the effect cleanup that revoked the `blob:` URL before the image loaded (acceptance finding B1).
- ✅ harness · Uploading, a 12 KB file, at `f0f94727` → "7 KB of 12 KB · 62%". At `ed023e2a` it read "0.0 of 0.0 MB · 62%" (acceptance finding B2).

## Not covered / needs human judgment
- The drag state needs a real drag from the desktop; TC-1.2 covers it.
- The `storage-cloudflare` provider and a real R2 bucket. The playground uses `storage-memory`.
- primeshopr itself. Its move onto the helpers is brainaloylabs/primeshopr#103.
- Concurrency: a second submit while the first runs. The block disables the form while it sends, and the browser checks saw it disabled; no race was driven.
- Performance: the cap reads at most 5 MB into memory; no load test ran.

## Overall result
_Tick one when you finish the run, or skip the ticks. Report each failure in the agent session or as a PR comment, and the agent records it here._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
