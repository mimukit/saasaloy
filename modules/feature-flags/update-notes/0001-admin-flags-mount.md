---
title: The flags routes move from /flags to /admin/flags
---

## What update does

Every `feature-flags` route was admin-only, and only the admin Flags screen called it, so the routes now mount at `/admin/flags`, next to `/admin/payment`. Under `/admin/` the shipped `admin-gate` and `audit-coverage` tests see them, and each write runs through `adminWrite`, which writes one audit row with the change.

`saasaloy update` adds the new link to the route chain in `apps/api/src/index.ts`:

```ts
.route("/admin/flags", featureFlags)
```

It does not take the old `.route("/flags", featureFlags)` link out. `update` applies the new revision's patches and never reverses a recorded patch that the revision dropped, so after the update both links serve the same handlers. The `/flags` copy sits outside `/admin/`, so the gate test and the coverage test cannot see it.

## What the merge plan gets

- `apps/admin/src/routes/flags.tsx`, if you edited it. Keep your edits and take the new calls on `api.admin.flags`.
- `apps/api/src/routes/feature-flags.ts`, if you edited it. Keep your edits and take `adminGate` before each validator and the `adminWrite` wrapper on the three writes.

## What you do

1. Run the update:

   ```sh
   saasaloy update feature-flags
   ```

2. Delete the old link from the route chain in `apps/api/src/index.ts`. Keep the `featureFlags` import, because the new link uses it:

   ```ts
   .route("/flags", featureFlags)
   ```

   Leave `.saasaloy/manifest.json` alone. `saasaloy remove feature-flags` skips a link that is already gone.

3. Search your own code for a call to the old path, such as a `fetch("/flags")` or a `bypassPaths` entry in a maintenance config, and change it to `/admin/flags`:

   ```sh
   grep -rn '"/flags' apps packages --include='*.ts' --include='*.tsx'
   ```

4. Run the api tests, then open the admin Flags screen. It lists your flags, and a toggle saves and shows a toast.

## Verify

```sh
grep -n 'route("/flags"' apps/api/src/index.ts
grep -n 'route("/admin/flags"' apps/api/src/index.ts
```

The first command prints nothing. The second prints one line.
