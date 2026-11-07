---
title: Admin gains an audit log, a members screen and two seed files
---

## What update does

`admin` adds the `audit_events` table, the `adminWrite` and `adminAuthWrite` wrappers in `apps/api/src/lib/admin-write.ts`, an action registry in `apps/api/src/lib/audit-actions.ts`, the `/members` and `/activity` screens, and their nav rows. The overview at `/` now asks `GET /admin/users?limit=5&sortBy=createdAt&sortDirection=desc` and paints with each card on its own, so a down api no longer blocks the page.

It also writes `apps/admin/src/extend/root.tsx`, a seed file. A seed file is written once and is then the project's: `update` never changes it, and writes it again only when it is missing. `apps/admin/src/components/app-shell.tsx` wraps the shell in the components that file lists. With `payment` installed, the `payment` module writes a second seed file, `apps/admin/src/extend/payments.ts`, whose zod shape `apps/admin/src/routes/payments.tsx` spreads into its search schema.

## What the merge plan gets

- `apps/api/src/lib/audit-actions.ts` and `apps/admin/src/components/nav.ts`. Other modules patch both files, so either one may differ from the hash `update` recorded and arrive as drift, even if you never edited it. Merge each one the same way: take the new file's shape and keep every patched entry. In `audit-actions.ts`, keep each module's import and each call inside `defineAuditActions({ actions: [...] })`, such as `paymentAuditActions` and `featureFlagsAuditActions`, and add `adminAuditActions`. In `nav.ts`, keep every module's row and add Members (`G M`) and Activity (`G A`).
- `apps/admin/src/routes/__root.tsx`, `apps/admin/src/components/app-shell.tsx` and `apps/admin/src/routes/payments.tsx`, if you edited them.

## What you do

1. Commit your work first, so the update's changes are the only change in the tree.
2. Update `admin` together with the modules that patch it:

   ```sh
   saasaloy update
   ```

3. If the plan lists `audit-actions.ts` or `nav.ts`, merge it as the section above says, then mark it resolved:

   ```sh
   saasaloy update --resolved apps/api/src/lib/audit-actions.ts
   saasaloy update --resolved apps/admin/src/components/nav.ts
   ```

4. Move each edit you made in place into a seed file, then take the managed file as `update` ships it:
   - A wrapper or provider you added around the shell in `__root.tsx` or `app-shell.tsx` goes into `rootWrappers` in `apps/admin/src/extend/root.tsx`.
   - A search param you added to `payments.tsx` goes into `paymentsSearchExtension` in `apps/admin/src/extend/payments.ts`, as a zod field such as `payment: z.string().optional().catch(undefined)`.

   After this step `update` keeps both managed files clean, and your code no longer goes to the merge on every update.
5. Generate and apply the migration for `audit_events` with your driver's commands:

   ```sh
   pnpm --filter @repo/db db:generate
   ```

6. Install, then run the checks and the api tests:

   ```sh
   pnpm install
   pnpm typecheck
   pnpm test
   ```

## Verify

```sh
test -f apps/admin/src/extend/root.tsx && echo "root seed present"
grep -n "adminAuditActions" apps/api/src/lib/audit-actions.ts
grep -n '"/members"\|"/activity"' apps/admin/src/components/nav.ts
```

The first command prints `root seed present`, and the other two each print a line. `apps/api/src/routes/audit-coverage.test.ts` passes. Open the admin app: the overview shows three cards, and Members and Activity are in the sidebar.
