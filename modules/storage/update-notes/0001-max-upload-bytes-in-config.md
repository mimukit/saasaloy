---
title: The upload cap moves from STORAGE_MAX_UPLOAD_BYTES to config.storage.maxUploadBytes
---

## What update does

The per-file upload cap is now a checked-in value, `config.storage.maxUploadBytes`, in the new section file `packages/config/src/sections/storage.ts`. It still defaults to 104857600 bytes (100 MiB). Two deployments of one project accept the same files, so the value is `config`, not `env` (ADR 0052, #162).

Nothing reads the `STORAGE_MAX_UPLOAD_BYTES` env var any more. The module no longer declares it, and the storage env preset no longer validates it. A value you set in a `.env` is ignored, and the cap is 100 MiB until you set the leaf.

`update` adds the `storageConfig()` entry to `packages/config/src/sections.ts`. `client.maxUploadBytes` stays on the storage client, so a caller that reads it needs no change. `DEFAULT_MAX_UPLOAD_BYTES` is no longer exported, and `defineStorage` takes an optional `maxUploadBytes`, which defaults to the leaf.

## What the merge plan gets

- `packages/storage/src/define.ts`, if you edited it. Keep your edits, and take the cap from `config.storage.maxUploadBytes` in `defineStorage`.
- `packages/storage/src/env-preset.ts`, if you edited it. Keep your edits and drop the `STORAGE_MAX_UPLOAD_BYTES` entry.

## What you do

1. Run the update:

   ```sh
   saasaloy update storage
   ```

2. If a `.env` sets `STORAGE_MAX_UPLOAD_BYTES` to a value other than 104857600, set the same number in `packages/config/src/project.ts`:

   ```ts
   storage: {
     maxUploadBytes: 26_214_400,
   },
   ```

3. Delete the `STORAGE_MAX_UPLOAD_BYTES` line from `packages/env/.env`, from every service `.env`, from each deployment's secrets, and from `packages/env/.env.example`.

4. Search your own code for the removed export, and read `config.storage.maxUploadBytes` or `client.maxUploadBytes` instead:

   ```sh
   grep -rn 'DEFAULT_MAX_UPLOAD_BYTES\|STORAGE_MAX_UPLOAD_BYTES' apps packages --include='*.ts' --include='*.tsx'
   ```

5. Run `pnpm typecheck` and the api tests.

## Verify

```sh
saasaloy doctor
grep -rn 'STORAGE_MAX_UPLOAD_BYTES' apps packages
```

`doctor` reports no `/env/STORAGE_MAX_UPLOAD_BYTES` finding. The `grep` prints nothing.
