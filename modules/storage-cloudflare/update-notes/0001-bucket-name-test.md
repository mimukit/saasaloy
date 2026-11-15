---
title: A test compares R2_BUCKET_NAME with the BUCKET binding
---

## What update does

New file `apps/api/test/r2-bucket.test.ts`. It reads `bucket_name` of the `BUCKET` binding in `apps/api/wrangler.jsonc`, and fails when `R2_BUCKET_NAME` in `packages/env/.env` or `packages/env/.env.prod` is set to another name. When the two differ, uploads work through the binding and every presigned link answers `NoSuchBucket`.

## What the merge plan gets

Nothing. The file is new.

## What you do

1. Run `pnpm test`.
2. If the new test fails, set `R2_BUCKET_NAME` to the bucket the binding names, in the file the message names.
3. If production reads its values from a remote source, check `R2_BUCKET_NAME` there by hand. The test does not see it.

## Verify

```sh
pnpm --filter @repo/api exec vitest run test/r2-bucket.test.ts
```

The test passes.
