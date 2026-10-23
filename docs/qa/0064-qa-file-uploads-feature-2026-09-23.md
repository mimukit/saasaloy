# QA Plan: the `file-uploads` feature module

_Generated 2026-09-23 · against `b6f2506` · covers `modules/file-uploads` end to end in a `.dev` playground_

## Summary

- `file-uploads` records every uploaded object in `storage_objects`, scopes it to a tenant, and serves it two ways: a short-lived signed link for a private file, a stable URL for a public image.
- Working means a human uploads a file from the admin Files screen, sees the row, opens a public image in a new tab, deletes the file, and the database agrees at every step.

## Environment

True for the whole plan. Do this once, before Scenario 1.

- Branch under test: `issue-175-object-records-upload-ui-and-public-image-path`.
- Run every command from the repo root unless a step says otherwise.
- The api answers on `http://localhost:4000`. The admin app answers on `http://localhost:4321`.
- There are no credentials yet. Scenario 1 creates the first account, and the `auth` module gives it the `superadmin` role.

Build the CLI and create a clean playground.

```sh
pnpm play:reset
```

Install the five modules under test.

```sh
cd .dev/playground && for m in database-d1 storage-memory queue queue-memory file-uploads; do ./saasaloy add $m --yes; done
```

Re-apply `file-uploads` so its two `queue` registrations land. A plain re-run answers "already installed".

```sh
cd .dev/playground && ./saasaloy add file-uploads --yes --force
```

```sh
cd .dev/playground && pnpm install
```

Write the Worker environment.

```sh
cat > .dev/playground/apps/api/.dev.vars <<'EOF'
LOGGER_PROVIDER=console
LOG_LEVEL=debug
CORS_ORIGINS=http://localhost:4321,http://localhost:5173
BETTER_AUTH_SECRET=dev-secret-dev-secret-dev-secret-32
BETTER_AUTH_URL=http://localhost:4000
PUBLIC_API_URL=http://localhost:4000
STORAGE_PROVIDER=memory
STORAGE_URL_SECRET=dev-storage-secret-dev-storage-32
STORAGE_MAX_UPLOAD_BYTES=1048576
STORAGE_PROXY_URL=http://localhost:4000
STORAGE_PUBLIC_URL=http://localhost:4000/files/public
QUEUE_PROVIDER=memory
EOF
```

Create the schema and apply it.

```sh
cd .dev/playground/packages/db && pnpm db:generate && pnpm db:migrate:local
```

Set the database client. Every query below runs through it.

```sh
export DB_CMD='npx wrangler d1 execute DB --local --config apps/api/wrangler.jsonc --persist-to apps/api/.wrangler/state --command'
```

Launch the api and the admin app in two terminals, both from `.dev/playground`.

```sh
cd .dev/playground/apps/api && pnpm dev
```

```sh
cd .dev/playground/apps/admin && pnpm dev
```

- [ ] Environment ready

## Test cases at a glance

Priority legend: 🔴 Critical · 🟡 Normal · 🟢 Low

| # | Scenario | Test case | Priority |
|------|----------|-----------|----------|
| TC-1.1 | 1: Fresh project, no files, public uploads on | Upload a private file from the screen | 🔴 Critical |
| TC-1.2 | 1: Fresh project, no files, public uploads on | Download the private file | 🔴 Critical |
| TC-1.3 | 1: Fresh project, no files, public uploads on | Upload a public image and open its URL | 🔴 Critical |
| TC-1.4 | 1: Fresh project, no files, public uploads on | Read the screen at two widths and in dark mode | 🟡 Normal |
| TC-1.5 | 1: Fresh project, no files, public uploads on | Reach and run the form from the keyboard | 🟡 Normal |
| TC-1.6 | 1: Fresh project, no files, public uploads on | Delete a file | 🔴 Critical |
| TC-2.1 | 2: Same project, `STORAGE_PUBLIC_URL` unset | The form refuses a public upload and says why | 🔴 Critical |
| TC-3.1 | 3: Two organizations, one file each | One organization cannot see the other's file | 🔴 Critical |

## Scenario 1: Fresh project, no files, public uploads on

**Setup.** Run once, for every case in this scenario.

1. Open `http://localhost:4321` in the browser.
2. Sign up with `qa@example.com` and the password `password1234`.
3. Open `http://localhost:4321/files`.

Prepare two files to upload.

```sh
printf 'hello world' > /tmp/qa-notes.txt && cp docs/assets/*.png /tmp/qa-avatar.png 2>/dev/null || printf 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' | base64 -d > /tmp/qa-avatar.png
```

- [ ] Setup complete

### TC-1.1: Upload a private file from the screen · 🔴 Critical

**Goal.** The screen runs the whole three-step upload and the row it shows matches the row the database holds.

**Steps**

1. Look at the Files screen before you upload anything.
   - [ ] The screen says nothing is uploaded yet, and the upload form is usable
     - the heading reads "Files"
     - the file input and the Upload button are both present
     - the Upload button is disabled until a file is picked
2. Pick `/tmp/qa-notes.txt`. Leave Visibility on Private. Click Upload.
   - [ ] The button shows it is working, then the table shows one row
     - filename `qa-notes.txt`, type `text/plain`, size `11 B`
     - the Visibility badge reads `private`
     - the Status cell reads `ready`
   - [ ] No error banner appears above the form
3. Read the row the api wrote.

   ```sh
   cd .dev/playground && $DB_CMD "select id, key, tenant_id, owner_id, content_type, size, visibility, status, completed_at from storage_objects;"
   ```

   - [ ] One row exists, key starting `t/default/uploads/`, size 11, content type `text/plain`, visibility `private`, status `ready`, and `completed_at` set

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.** _what actually happened on a fail; why it was skipped_

### TC-1.2: Download the private file · 🔴 Critical

**Goal.** A private object comes back only through a signed link the screen asks for.

**Steps**

1. Click Download on the `qa-notes.txt` row.
   - [ ] A new tab opens and shows the text `hello world`
2. Copy the URL of that new tab.
   - [ ] The URL points at `localhost:4000/storage/objects` and carries a `token` query parameter
3. Open the same URL in a private window with no session.
   - [ ] The file still downloads, because the token authorizes the request and the session does not

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-1.3: Upload a public image and open its URL · 🔴 Critical

**Goal.** A public image gets a stable URL that works with no session, and the screen renders it.

**Steps**

1. Pick `/tmp/qa-avatar.png`. Set Visibility to Public. Click Upload.
   - [ ] The table shows a second row with the `public` badge and status `ready`
   - [ ] An Images panel appears above the table with one square tile showing the image
2. Read the row.

   ```sh
   cd .dev/playground && $DB_CMD "select key, visibility, content_type from storage_objects where visibility = 'public';"
   ```

   - [ ] One row, key starting `t/default/public-uploads/`, content type `image/png`
3. Click Open on the public row.
   - [ ] A new tab shows the image
   - [ ] The URL is `http://localhost:4000/files/public/` followed by the whole five-segment key, unchanged
4. Open the same URL in a private window with no session.
   - [ ] The image still loads, with no sign-in prompt

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-1.4: Read the screen at two widths and in dark mode · 🟡 Normal

**Goal.** The screen stays readable where a table and an image grid usually break.

**Steps**

1. Set the browser to 1280px wide. Scroll the Files screen top to bottom.
   - [ ] Every block reads correctly, with nothing clipped and nothing invisible on its own background
     - the upload card: heading, description, file input, both radio buttons, Upload button
     - the Images panel: the tile is square and the image is not stretched
     - the table: all six columns are legible and the action buttons sit on one line
2. Set the browser to 390px wide. Scroll again.
   - [ ] The same sweep is clean at phone width
   - [ ] The table scrolls sideways rather than overflowing the page
3. Switch the app to dark mode.
   - [ ] The same sweep is clean in dark
   - [ ] The Visibility badges stay readable in both `private` and `public`

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-1.5: Reach and run the form from the keyboard · 🟡 Normal

**Goal.** Somebody who does not use a mouse can upload a file.

**Steps**

1. Click once on the page heading, then press Tab repeatedly.
   - [ ] Focus reaches the file input, both radio buttons and the Upload button, in that order
   - [ ] Every focused control shows a visible focus ring
2. Focus the Visibility radio group. Use the arrow keys.
   - [ ] The selection moves between Private and Public
3. Focus the Upload button with a file picked. Press Enter.
   - [ ] The upload runs, exactly as a click does

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

### TC-1.6: Delete a file · 🔴 Critical

**Goal.** Delete removes the row from the screen and soft-deletes it in the database.

**Steps**

1. Click Delete on the `qa-notes.txt` row.
   - [ ] The row disappears from the table
   - [ ] No error banner appears
2. Read what the delete left behind.

   ```sh
   cd .dev/playground && $DB_CMD "select key, status, deleted_at from storage_objects where status = 'deleted';"
   ```

   - [ ] The `qa-notes.txt` row is still there, status `deleted`, with `deleted_at` set
3. Reload the Files screen.
   - [ ] The deleted file does not come back
   - [ ] The public image row is untouched

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after every case above, before moving to Scenario 2.

```sh
cd .dev/playground && $DB_CMD "delete from storage_objects;"
```

## Scenario 2: Same project, `STORAGE_PUBLIC_URL` unset

**Setup.** Run once, for every case in this scenario.

Clear the variable. The api reloads on its own.

```sh
cd .dev/playground && sed -i 's|^STORAGE_PUBLIC_URL=.*|STORAGE_PUBLIC_URL=|' apps/api/.dev.vars
```

1. Wait for the api terminal to report a reload.
2. Reload `http://localhost:4321/files`.

- [ ] Setup complete

### TC-2.1: The form refuses a public upload and says why · 🔴 Critical

**Goal.** With no public origin configured, the screen disables the public option and names the variable, and nothing is stored as public by accident.

**Steps**

1. Look at the Visibility control.
   - [ ] The Public radio button is disabled, and a line below the group names `STORAGE_PUBLIC_URL`
2. Restore the variable, wait for the reload, and reload the page.

   ```sh
   cd .dev/playground && sed -i 's|^STORAGE_PUBLIC_URL=$|STORAGE_PUBLIC_URL=http://localhost:4000/files/public|' apps/api/.dev.vars
   ```

   - [ ] The Public radio button is usable again

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after the case above, before moving to Scenario 3.

```sh
cd .dev/playground && $DB_CMD "delete from storage_objects;"
```

## Scenario 3: Two organizations, one file each

**Setup.** Run once, for every case in this scenario.

Install `multitenant` and migrate.

```sh
cd .dev/playground && ./saasaloy add multitenant --yes && pnpm install
```

```sh
cd .dev/playground/packages/db && pnpm db:generate && pnpm db:migrate:local
```

1. Restart the api terminal.
2. Sign in as `qa@example.com` in the normal window. Create an organization named `Alpha` and make it active.
3. Open a private window. Sign up as `qa2@example.com` with the password `password1234`. Create an organization named `Beta` and make it active.

- [ ] Setup complete

### TC-3.1: One organization cannot see the other's file · 🔴 Critical

**Goal.** A member of one organization cannot list, download or delete another organization's object.

**Steps**

1. In the Alpha window, upload `/tmp/qa-notes.txt` as private. In the Beta window, upload `/tmp/qa-avatar.png` as private.
   - [ ] Each window's table shows exactly one row, its own
2. Read the two keys.

   ```sh
   cd .dev/playground && $DB_CMD "select tenant_id, key, owner_id from storage_objects order by tenant_id;"
   ```

   - [ ] Two rows, each with a different `tenant_id`, and neither `tenant_id` is `default`
3. Copy Beta's object id from the query above. In the **Alpha** window, open `http://localhost:4000/files/<beta-id>/download` directly.
   - [ ] The api answers `{"error":{"code":"not_found",...}}` rather than a download link
4. Reload the Alpha Files screen.
   - [ ] Alpha still shows only its own file

**Result**

- [ ] Pass
- [ ] Fail
- [ ] Skipped

**Notes.**

**Reset.** Run after the case above.

```sh
cd .dev/playground && $DB_CMD "delete from storage_objects;"
```

```sh
pnpm play:destroy
```

## Automated verification (by AI agent)

_Checks the agent ran itself on 2026-09-23. No action needed from the tester; listed here for context and sign-off._

The database is the playground's local D1 file under `.dev/playground/apps/api/.wrangler/state`. It is on this machine and holds only QA data.

Repo gate:

```sh
pnpm lint
```

```sh
pnpm test
```

Playground gate, with `database-d1`, `storage-memory`, `queue`, `queue-memory` and `file-uploads` installed:

```sh
cd .dev/playground && pnpm build
```

```sh
cd .dev/playground && pnpm typecheck
```

Schema introspection, read-only:

```sh
cd .dev/playground && $DB_CMD "select name from pragma_table_info('storage_objects');"
```

```sh
cd .dev/playground && $DB_CMD "select name, \"unique\" from pragma_index_list('storage_objects');"
```

Api flows, against a running dev server:

```sh
curl -s -c /tmp/c.txt -X POST http://localhost:4000/auth/sign-up/email -H 'Origin: http://localhost:4000' -H 'content-type: application/json' -d '{"email":"a@b.com","password":"password1234","name":"A"}'
```

```sh
curl -s -b /tmp/c.txt -H 'Origin: http://localhost:4000' -H 'content-type: application/json' -X POST http://localhost:4000/files/uploads -d '{"filename":"notes.txt","contentType":"text/plain","size":11,"visibility":"private"}'
```

```sh
curl -s -b /tmp/c.txt -H 'Origin: http://localhost:4000' -H 'content-type: application/json' -X POST http://localhost:4000/files/uploads -d '{"filename":"big.bin","contentType":"application/octet-stream","size":99999999,"visibility":"private"}'
```

```sh
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4000/files/public/t/default/uploads/<private-id>/notes.txt
```

Results:

- ✅ `pnpm lint` → four passes clean, including `prettier --check .`.
- ✅ `pnpm test` → 166 tests, 0 failures. 21 of them are this module's new unit tests over `resolveTenant`, `publicUrl`, `publicImageUrl` and `imageUrl`.
- ✅ `pnpm build` and `pnpm typecheck` in the playground → 3 and 11 tasks green, with and without the `queue` capability installed.
- ✅ `pragma_table_info('storage_objects')` → 13 columns: `id`, `key`, `provider`, `tenant_id`, `owner_id`, `content_type`, `size`, `visibility`, `status`, `created_at`, `completed_at`, `deleted_at`, `metadata`.
- ✅ `pragma_index_list('storage_objects')` → `storage_objects_key_unique` (unique), `storage_objects_tenant_id_idx`, `storage_objects_tenant_id_status_idx`, plus the primary-key autoindex.
- ✅ Private upload → key `t/default/uploads/<uuid>/notes.txt`, PUT through the proxy route, `complete` returned status `ready`, download link returned `hello world`.
- ✅ Oversize refusal → `413 {"error":{"code":"too_large","message":"File is 99999999 bytes, over the 1048576-byte limit STORAGE_MAX_UPLOAD_BYTES sets."}}`.
- ✅ Size mismatch at `complete` → `409`, the object was deleted and the row marked `rejected`.
- ✅ Public upload → key `t/default/public-uploads/<uuid>/avatar.png`, `GET /files/public/<key>` with no cookie returned `200 image/png 70`.
- ✅ Public route refusals → a private key returns `404`, and a key carrying `..` returns `404`.
- ✅ `GET /files/<public-id>/download` → `400`, naming the list response instead.
- ✅ Delete → `204`, the row left `status = 'deleted'` with `deleted_at` set, and the list stopped showing it.
- ✅ `STORAGE_PUBLIC_URL` unset → `POST /files/uploads` with `visibility: "public"` returned `400` naming the variable, and `GET /files` reported `publicUploads: false`.
- ✅ With `multitenant` installed → two organizations wrote keys under their own organization ids, each list showed one row, and a cross-organization download and delete both returned `404`.
- ✅ `saasaloy add file-uploads` with no `queue` capability → installs, builds and typechecks, warning that three `packages/queue` patch targets are missing.

## Not covered / needs human judgment

- **`storage-cloudflare`.** Every flow above ran under `storage-memory`. The R2 path needs a Cloudflare account and a bucket, which this machine has none of. Re-run Scenario 1 with `STORAGE_PROVIDER=cloudflare` before release.
- **The R2 custom domain and the Cache Rule.** Both are dashboard settings. Confirm that `STORAGE_PUBLIC_URL` pointing at the custom domain serves the same key, and that the Cache Rule on `/t/*/public-*/*` attaches the `cache-control` header.
- **Cloudflare image transformations.** `STORAGE_IMAGE_TRANSFORMS=true` needs a zone with transformations enabled. The off path is proven; the on path builds a `/cdn-cgi/image/` URL that only a real zone answers.
- **The sweep job running.** The job and its schedule register correctly, and the sweep is unit-testable through its port, but firing the 04:00 UTC tick needs a deployed Cron Trigger or a hand-built scheduled event.
- **Performance at volume.** The list is keyset-paginated, and nothing here loaded more than a handful of rows.
- **Screen-reader labels.** TC-1.5 covers keyboard reach and focus order only. A screen-reader pass is a separate exercise.
- **Concurrency.** Two simultaneous uploads of the same filename produce different keys by construction, because the `<id>` segment is a fresh UUID. Nothing exercised a real race.

## Overall result

_Tick one when you finish the run._

- [ ] Pass: every case passed
- [ ] Fail: at least one case failed
- [ ] Partial: cases were skipped or not reached
