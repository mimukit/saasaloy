# Plan: upload components and a server upload helper (#284)

Grilled: 2026-10-26

## Context

A project on saasaloy writes its upload code twice, once in the browser and once in the api route. primeshopr has two flows and two copies of the server checks: `apps/api/src/lib/payment-receipt.ts` (a streamed read with a 5 MB cap, a JPEG/PNG/WebP signature check, an owner-scoped key, `ownsReceipt`) and `storeFiles` behind `apps/api/src/routes/me-support.ts` (multipart through `parseBody`, no size cap in the loop, and the browser's `file.type` stored as the content type). The browser half is `packages/ui/src/components/attachment-picker.tsx`, 231 lines, which a second project would copy.

saasaloy already has two pieces of this. `modules/storage` owns `buildKey`, `assertValidKey`, `tenantPrefix` and signed download tokens (`modules/storage/files/src/keys.ts`, `token.ts`). `modules/file-uploads` owns the direct-to-R2 path: a `storage_objects` record, `POST /files/uploads` that returns a presigned PUT, `POST /files/uploads/:id/complete` that heads the object and compares size and content type, and a presentational block at `packages/ui/src/blocks/file-uploads.tsx`. That `complete` step does not check a file signature, because it only heads the object. primeshopr does not install `file-uploads`, since both of its flows attach a file to a record it already owns (a payment, a ticket message) and need no files table.

Goal: a project attaches a file to its own record with one helper call on the server and one component in the browser, and no project writes signature or read-cap code again.

Target: both primeshopr flows call the helper, and `payment-receipt.ts` keeps no byte reading or signature code after brainaloylabs/primeshopr#103 moves them onto the extracted version. brainaloylabs/primeshopr#97 changed the browser only; the server code is unchanged from before it. A reviewer checks it with `grep -n "getReader\|0xff" apps/api/src/lib/payment-receipt.ts` (no match).

## Design decisions (settled)

| Decision | Resolution |
|----------|-----------|
| Where the server helper lives | In the `@repo/storage` core, as pure functions in a new `src/upload.ts`. It imports no vendor SDK and no binding, so it keeps the core vendor-blind. A new `upload` module would add a descriptor, a skill and an install step for about 150 lines of functions. |
| Which path the helper serves | The Worker path: the bytes travel through the api route. That is the only path where the api caps the size during the read and sees the first bytes. `file-uploads` keeps the direct-to-R2 path. |
| Helper surface | `readLimited(body, maxBytes)` reads a `ReadableStream` and returns `null` past the cap, also with no `Content-Length`. `sniffType(bytes, allowed)` returns `{ type, extension }` or `null` for JPEG, PNG, WebP, GIF and PDF; the caller passes the allowed list, and there are no named presets. `ownsKey(key, { tenantId, scope, id }, { filename?: RegExp })` checks that a key sits under the prefix `buildKey` would make, and checks the last segment against `filename` when given, so primeshopr keeps its `<uuid>.<ext>` check. A refusal returns `null`; only a programmer error throws `StorageError`. |
| Worker path ceiling | The skill recommends the Worker path up to 10 MB and points at `file-uploads` above it. `readLimited` buffers the file in a 128 MB Worker. The helper does not enforce the number. |
| Compression and EXIF | Out of scope. `FileDrop` has no transform hook, and the skill does not cover it. |
| `file-uploads` block | Moves onto `FileDrop` in this plan (Phase 4). `file-uploads` already lists `storage` in `dependsOn`. |
| Browser component | `FileDrop` in `packages/ui/src/components/file-drop.tsx`: drop zone, picker button, thumbnail or file chip per file, remove, refusal reason. It holds no IO and no copy; labels come in as props, the same contract as primeshopr's `AttachmentPickerLabels`. |
| Who ships `FileDrop` | The `storage` module, as a file into `@ui`. The base template has no use for it without storage. |
| `react-dropzone` | Used, pinned to 20.1.4, the version primeshopr's merged `packages/ui/src/components/file-drop.tsx` uses. The storage descriptor adds it to `packages/ui/package.json`. Re-grilled 2026-10-26 (reopened Q5): the extraction ports a component that already runs. |
| Single or several files | A `multiple` prop, default `false`, matches primeshopr's receipt field. With `multiple` true, `maxFiles` caps the count, which covers the support flow (brainaloylabs/primeshopr#98) and the `file-uploads` block. |
| primeshopr server migration | brainaloylabs/primeshopr#103 moves the receipt route and `storeFiles` onto the helpers, blocked on #284. Filed 2026-10-26. |
| Order of work | primeshopr#97 built first and merged through primeshopr PR #101 on 2026-10-26. This plan extracts from it, so the two real callers set the API, as the issue asks. |
| Tests | vitest unit tests beside the source for `upload.ts`, the same shape as `keys.test.ts`. `FileDrop` gets no component tests, because the base `ui` package has no runner; the `.dev` check in Phase 6 covers it. |
| Outward actions | Approved 2026-10-26: commit this plan to `main`, push, update the #284 body, and label #284 `blocked` until primeshopr#97 merges. |
| UI house rules | The repo has no root `DESIGN.md`; the rules come from `packages/cli/templates/base/packages/ui/AGENTS.md`. No IO in `@repo/ui`: `FileDrop` hands `File` objects to the app. Copy comes in as label props, never hard-coded. Tokens only (`border-input`, `bg-muted`, `text-destructive`), so light and dark both follow the theme. A component under `src/components/` is scanned only when `globals.css` names it in an `@source` line, because a block renders it. |
| Mockup approval | Approved 2026-10-26, round 1. Single mode is primeshopr's component unchanged. Multiple mode is layout B: the file list first, then a one-line "Add more, or drop files here" bar; the full drop zone shows only when the list is empty. Screenshots: `docs/plans/assets/0090-upload-components/round1-*.png`. Layouts A (full zone above the list) and C (tile grid) were rejected. |
| Admin multi-file submit | The `file-uploads` block takes several files per submit (`multiple`, upload button reads "Upload N files") and calls `onUpload(file)` once per file. Approved with the mockup, 2026-10-26. |

## Approach

Extract the Worker-path checks from primeshopr into `@repo/storage`, and ship `FileDrop` beside them. Leave `file-uploads` as the record-keeping, direct-to-R2 path, and point to it from the skill.

Rejected: a new `upload` module (one more install step for no extra dependency or binding); direct-to-R2 only (no signature check and no size cap until after the bytes land, and primeshopr's flows have no record table to sweep); one helper that covers both paths (the two paths check at different times, so a shared API would hide that difference).

### Phase 1: wait for primeshopr#97 and approve the FileDrop mockup (built 2026-10-26)

Attended: the owner approves the mockup screenshots: `FileDrop` in single mode (empty, dragging, one image chosen, one refused file, disabled), in multiple mode (two files with one image thumbnail, the `maxFiles` refusal) and the admin `/files` screen with `FileDrop` in it.

- Read primeshopr's merged `file-drop.tsx` on its `main` (PR #101) and use it as the base for the port. The server helper surface comes from `payment-receipt.ts` and `storeFiles`, because #97 did not change the api.
- Build the mockup and record the approval date and round in Design decisions.

Done when: Design decisions carries a mockup approval row with a date, and the Helper surface row matches primeshopr#97's merged code.

### Phase 2: server helper in @repo/storage

- Add `modules/storage/files/src/upload.ts` with `readLimited`, `sniffType` and `ownsKey`, and export them from `src/index.ts`.
- Add new `StorageErrorCode` values only if a function needs to throw (for example `too_large`); a refusal that the caller turns into a 4xx returns `null`.
- Add `upload.test.ts`: a stream over the cap with no `Content-Length`, each signature, a PNG renamed `.pdf`, a key from another tenant, a key with `..`.

Done when: `pnpm test` passes the new `upload.test.ts`, and `pnpm lint` is clean.

### Phase 3: FileDrop component

- Add `modules/storage/files/ui/components/file-drop.tsx` and register it in `modules/storage/registry-item.json` as a file targeting `@ui/components/file-drop.tsx`.
- Port primeshopr's `file-drop.tsx` on `react-dropzone` 20.1.4, and add `react-dropzone` to `packages/ui/package.json` through a `package-json-dependency` patch in the storage descriptor.
- Add the `multiple` and `maxFiles` props in layout B, and take the multi-file list behaviour from `attachment-picker.tsx`: check type, size and count as a file is chosen, revoke each object URL when its chip goes, keep the refusal reason on screen.
- Add `@source "../components/file-drop.tsx";` to `globals.css` through the storage descriptor, so Tailwind scans the component.

Done when: in a `.dev` project with `storage` installed, the component renders the approved mockup states in both modes, and the screenshots match the Phase 1 round.

### Phase 4: move the file-uploads block onto FileDrop

- Replace the file input in `modules/file-uploads/files/ui/blocks/file-uploads.tsx` with `FileDrop` in `multiple` mode, and keep the block's `onUpload(file)` contract: the block calls it once per file, in order.
- Change the submit button to "Upload N files", and show each file's progress in its row while the loop runs.
- Keep the public or private choice and its disabled reason as they are.

Done when: in a `.dev` project with `file-uploads`, the admin `/files` screen uploads two files in one submit through `FileDrop`, lists both, and matches `round1-admin-*.png` layout B.

### Phase 5: skill section

- Add a "Uploads through the Worker" section to `modules/storage/skills/saasaloy-storage/SKILL.md`. It wires one route (`readLimited` → `sniffType` → `buildKey` → `put`), a later `ownsKey` check when a record saves the key, `FileDrop` on the page, and a signed download link for staff.
- Add one paragraph that says when to pick `file-uploads` instead: files over 10 MB, a files list, a sweep.

Done when: the skill section's route example compiles in the `.dev` project, and the section names `file-uploads` as the other path.

### Phase 6: check in a scaffolded project

- In `.dev`, scaffold a project with `storage` and `storage-memory`, add the skill's example route, and upload a PNG, a renamed text file and a 6 MB file.

Done when: the PNG returns 201, the renamed file returns a 4xx with the signature reason, and the 6 MB file returns 413. The target line then holds once brainaloylabs/primeshopr#103 swaps its copies for the extracted helper.

## Open questions

None. The grill on 2026-10-26 settled every question.

## Non-goals

- Changes to the direct-to-R2 path in `file-uploads`, including a signature check in `complete` (it would need a ranged `get` on `StorageProvider`). Phase 4 changes the block only.
- Image compression, resizing or EXIF stripping in the browser.
- Multipart or resumable uploads.
- Editing primeshopr. Its server migration is brainaloylabs/primeshopr#103, and its support picker is brainaloylabs/primeshopr#98.
