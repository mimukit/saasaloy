---
title: The isolate cache TTL moves from FLAGS_ISOLATE_TTL_SECONDS to config["feature-flags"].isolateTtlSeconds
---

## What update does

The flag cache TTL is now a checked-in value, `config["feature-flags"].isolateTtlSeconds`, in the new section file `packages/config/src/sections/feature-flags.ts`. It still defaults to 10 seconds, and `0` still skips the isolate cache. Two deployments of one project make the same trade between KV reads and toggle latency, so the value is `config`, not `env` (ADR 0052, #162).

Nothing reads the `FLAGS_ISOLATE_TTL_SECONDS` env var any more. A value you set in a `.env` is ignored, and the cache uses 10 seconds until you set the leaf. `feature-flags` now declares no env var at all, so it ships no env preset: `update` deletes `packages/feature-flags/src/env-preset.ts` when you never edited it, and drops the `./env-preset` export from `packages/feature-flags/package.json`.

`update` adds the `featureFlagsConfig()` entry to `packages/config/src/sections.ts`. It does not take the old `featureFlagsEnv()` entry out of `apps/api/src/env.ts`, because `update` never reverses a recorded patch that the new revision dropped. Step 2 below removes it.

`DEFAULT_ISOLATE_TTL_SECONDS` is no longer exported. `defineFlags` takes an optional `isolateTtlSeconds`, which defaults to the leaf.

## What the merge plan gets

- `packages/feature-flags/src/define.ts` and `src/cache.ts`, if you edited them. Keep your edits, and take the TTL from `config["feature-flags"].isolateTtlSeconds` in `defineFlags`.
- `packages/feature-flags/src/env-preset.ts`, if you edited it. `update` keeps an edited copy. Delete it after step 2.

## What you do

1. Run the update:

   ```sh
   saasaloy update feature-flags
   ```

2. In `apps/api/src/env.ts`, delete the `featureFlagsEnv()` entry from the `extends` array and its import:

   ```ts
   import { featureFlagsEnv } from "@repo/feature-flags/env-preset";
   ```

   Then delete `packages/feature-flags/src/env-preset.ts` if `update` kept it.

3. If a `.env` sets `FLAGS_ISOLATE_TTL_SECONDS` to a value other than 10, set the same number in `packages/config/src/project.ts`:

   ```ts
   "feature-flags": {
     isolateTtlSeconds: 30,
   },
   ```

4. Delete the `FLAGS_ISOLATE_TTL_SECONDS` line from `packages/env/.env`, from every service `.env`, from each deployment's secrets, and from `packages/env/.env.example`.

5. Run `pnpm typecheck` and the api tests.

## Verify

```sh
saasaloy doctor
grep -rn 'FLAGS_ISOLATE_TTL_SECONDS\|feature-flags/env-preset' apps packages
```

`doctor` reports no `/env/FLAGS_ISOLATE_TTL_SECONDS` finding. The `grep` prints nothing.
