---
title: CMS admin routes move to /admin/cms
---

## What update does

The CLI registers the CMS admin routes under `/admin/cms`. The admin gate checks each request, and CMS writes record an audit event in the same transaction. Public CMS reads keep their paths under `/cms`.

## What update merges

The CLI updates the CMS router, the generated route and audit registrations, and `apps/admin/src/lib/cms-api.ts`. It reports conflicts where project edits overlap those changes.

## What you do

Replace `/cms/admin` with `/admin/cms` in your CMS admin clients and tests. If you use the typed client, change `api.cms.admin` to `api.admin.cms`. Resolve any conflicts in the files listed in the update report.

## Verify

Run `pnpm check`. Save a CMS draft from the admin app. Check that the request succeeds and the activity log shows the CMS action.
