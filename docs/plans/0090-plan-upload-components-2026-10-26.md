# Plan: upload components and a server upload helper (#284)

Grilled: 2026-10-26

## Context

A project on saasaloy writes its upload code twice, once in the browser and once in the api route. primeshopr has two flows and two copies of the server checks: `apps/api/src/lib/payment-receipt.ts` (a streamed read with a 5 MB cap, a JPEG/PNG/WebP signature check, an owner-scoped key, `ownsReceipt`) and `storeFiles` behind `apps/api/src/routes/me-support.ts` (multipart through `parseBody`, no size cap in the loop, and the browser's `file.type` stored as the content type). The browser half is `packages/ui/src/components/attachment-picker.tsx`, 231 lines, which a second project would copy.

saasaloy already has two pieces of this. `modules/storage` owns `buildKey`, `assertValidKey`, `tenantPrefix` and signed download tokens (`modules/storage/files/src/keys.ts`, `token.ts`). `modules/file-uploads` owns the direct-to-R2 path: a `storage_objects` record, `POST /files/uploads` that returns a presigned PUT, `POST /files/uploads/:id/complete` that heads the object and compares size and content type, and a presentational block at `packages/ui/src/blocks/file-uploads.tsx`. That `complete` step does not check a file signature, because it only heads the object. primeshopr does not install `file-uploads`, since both of its flows attach a file to a record it already owns (a payment, a ticket message) and need no files table.

Goal: a project attaches a file to its own record with one helper call on the server and one component in the browser, and no project writes signature or read-cap code again.

Target: both primeshopr flows call the helper, and `payment-receipt.ts` keeps no byte reading or signature code after brainaloylabs/primeshopr#97 moves onto the extracted version. A reviewer checks it with `grep -n "getReader\|0xff" apps/api/src/lib/payment-receipt.ts` (no match).

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
| `react-dropzone` | Not used. primeshopr's picker covers the same ground with native drag events and a hidden input, and a native version adds no template dependency for `deps:update` to track. |
| Order of work | primeshopr#97 builds first, in its own thread. This plan extracts from it, so the two real callers set the API, as the issue asks. |
| Tests | vitest unit tests beside the source for `upload.ts`, the same shape as `keys.test.ts`. `FileDrop` gets no component tests, because the base `ui` package has no runner; the `.dev` check in Phase 6 covers it. |
| Outward actions | Approved 2026-10-26: commit this plan to `main`, push, update the #284 body, and label #284 `blocked` until primeshopr#97 merges. |
| UI house rules | Read `DESIGN.md` and the base `ui` AGENTS.md in Phase 1 and list the rules here before the mockup. |

## Approach

Extract the Worker-path checks from primeshopr into `@repo/storage`, and ship `FileDrop` beside them. Leave `file-uploads` as the record-keeping, direct-to-R2 path, and point to it from the skill.

Rejected: a new `upload` module (one more install step for no extra dependency or binding); direct-to-R2 only (no signature check and no size cap until after the bytes land, and primeshopr's flows have no record table to sweep); one helper that covers both paths (the two paths check at different times, so a shared API would hide that difference).

### Phase 1: wait for primeshopr#97 and approve the FileDrop mockup

Attended: primeshopr#97 merged, and the owner approves the mockup screenshots: `FileDrop` in five states (empty, dragging, two files with one image thumbnail, one refused file, disabled) and the admin `/files` screen with `FileDrop` in it.

- Read the merged primeshopr#97 code and note where its helper API differs from the surface above. Update the Helper surface row if it does.
- Build the mockup and record the approval date and round in Design decisions.

Done when: Design decisions carries a mockup approval row with a date, and the Helper surface row matches primeshopr#97's merged code.

### Phase 2: server helper in @repo/storage

- Add `modules/storage/files/src/upload.ts` with `readLimited`, `sniffType` and `ownsKey`, and export them from `src/index.ts`.
- Add new `StorageErrorCode` values only if a function needs to throw (for example `too_large`); a refusal that the caller turns into a 4xx returns `null`.
- Add `upload.test.ts`: a stream over the cap with no `Content-Length`, each signature, a PNG renamed `.pdf`, a key from another tenant, a key with `..`.

Done when: `pnpm test` passes the new `upload.test.ts`, and `pnpm lint` is clean.

### Phase 3: FileDrop component

- Add `modules/storage/files/ui/components/file-drop.tsx` and register it in `modules/storage/registry-item.json` as a file targeting `@ui/components/file-drop.tsx`.
- Port the behaviour of `attachment-picker.tsx`: check type, size and count as a file is chosen, revoke each object URL when its chip goes, keep the refusal reason on screen.
- Add drag and drop with native events.

Done when: in a `.dev` project with `storage` installed, the component renders the five approved mockup states, and the screenshots match the Phase 1 round.

### Phase 4: move the file-uploads block onto FileDrop

- Replace the file input in `modules/file-uploads/files/ui/blocks/file-uploads.tsx` with `FileDrop`, and keep the block's `onUpload(file)` contract.
- Keep the public or private choice and its disabled reason as they are.

Done when: in a `.dev` project with `file-uploads`, the admin `/files` screen uploads a file through `FileDrop` and matches the approved mockup.

### Phase 5: skill section

- Add a "Uploads through the Worker" section to `modules/storage/skills/saasaloy-storage/SKILL.md`. It wires one route (`readLimited` → `sniffType` → `buildKey` → `put`), a later `ownsKey` check when a record saves the key, `FileDrop` on the page, and a signed download link for staff.
- Add one paragraph that says when to pick `file-uploads` instead: files over 10 MB, a files list, a sweep.

Done when: the skill section's route example compiles in the `.dev` project, and the section names `file-uploads` as the other path.

### Phase 6: check in a scaffolded project

- In `.dev`, scaffold a project with `storage` and `storage-memory`, add the skill's example route, and upload a PNG, a renamed text file and a 6 MB file.

Done when: the PNG returns 201, the renamed file returns a 4xx with the signature reason, and the 6 MB file returns 413. The target line then holds once primeshopr#97 swaps its copies for the extracted helper.

## Open questions

None. The grill on 2026-10-26 settled every question.

## Non-goals

- Changes to the direct-to-R2 path in `file-uploads`, including a signature check in `complete` (it would need a ranged `get` on `StorageProvider`). Phase 4 changes the block only.
- Image compression, resizing or EXIF stripping in the browser.
- Multipart or resumable uploads.
- Editing primeshopr. Its migration is brainaloylabs/primeshopr#97.
