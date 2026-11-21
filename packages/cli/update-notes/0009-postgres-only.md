---
title: Postgres is the only database driver
version: 0.11.0
---

## What update does

`saasaloy add database` now adds `database-postgres` without a prompt. The 0.11.0 registry removes `database-d1` and ships one Postgres schema for each module that owns a table.

## What update merges

For a Postgres project, the schema files keep their paths. The CLI reads `onlyWith` in older release descriptors so it can render the files that those releases shipped.

## What you do

For a Postgres project, review the update report and resolve any conflicts in files you edited.

If your project uses D1, keep its CLI and registry pinned to 0.10.0 until you have a separate migration plan. Saasaloy does not convert a D1 schema or copy its data to Postgres. To move, create a Postgres scaffold and port your project code, schema and data. Check your data and application before you switch traffic.

## Verify

Check that `saasaloy-lock.json` lists `database-postgres`. Run `pnpm check` in the Postgres project.
