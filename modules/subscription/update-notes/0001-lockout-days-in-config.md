---
title: The lockout window moves from SUBSCRIPTION_LOCKOUT_DAYS to config.subscription.lockoutDays
---

## What update does

The past-due lockout window is now a checked-in value, `config.subscription.lockoutDays`, in `packages/config/src/sections/subscription.ts`. It still defaults to 14 days. Two deployments of one project give a past-due customer the same grace, so the value is `config`, not `env` (ADR 0052, #162).

Nothing reads the `SUBSCRIPTION_LOCKOUT_DAYS` env var any more. The module no longer declares it, and `apps/api/src/env.ts` no longer validates it. A value you set in a `.env` is ignored, and the sweep uses 14 days until you set the leaf.

`setSubscriptionConfig`, `subscriptionConfig()`, `readLockoutDays` and `DEFAULT_LOCKOUT_DAYS` are gone. The lockout job and `apps/api/src/subscription-store.ts`, which computes the date the `payment-failed` email names, import the leaf from `@repo/config`. `update` deletes `packages/subscription/src/config.ts` when you never edited it.

## What update merges

- `apps/api/src/subscription-store.ts`, if you edited it. Keep your edits, drop the `setSubscriptionConfig({ lockoutDays: readLockoutDays(...) })` call, and take `config.subscription.lockoutDays` in the `payment-failed` date.
- `packages/subscription/src/config.ts`, if you edited it. `update` keeps an edited copy. Delete it once nothing imports it.
- `packages/config/src/sections/subscription.ts`, if you edited it. Move your edits to `packages/config/src/project.ts` instead, because `update` owns the section file.

## What you do

1. Run the update:

   ```sh
   saasaloy update
   ```

2. If a `.env` sets `SUBSCRIPTION_LOCKOUT_DAYS` to a value other than 14, set the same number in `packages/config/src/project.ts`:

   ```ts
   subscription: {
     lockoutDays: 30,
   },
   ```

3. Delete the `SUBSCRIPTION_LOCKOUT_DAYS` line from `packages/env/.env`, from every service `.env`, and from each deployment's secrets. Delete it from `packages/env/.env.example` too, because `add` never removes a key.

4. Search your own code for the removed exports, and read `config.subscription.lockoutDays` instead:

   ```sh
   grep -rn 'setSubscriptionConfig\|subscriptionConfig()\|readLockoutDays\|DEFAULT_LOCKOUT_DAYS' apps packages --include='*.ts'
   ```

5. Run `pnpm typecheck` and the api tests.

## Verify

```sh
saasaloy doctor
grep -rn 'SUBSCRIPTION_LOCKOUT_DAYS' apps packages
```

`doctor` reports no `/env/SUBSCRIPTION_LOCKOUT_DAYS` finding. The `grep` prints nothing.
