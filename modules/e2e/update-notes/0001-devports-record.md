---
title: The e2e suite reads this checkout's ports from .devports.json
---

## What update does

`packages/e2e/lib/project.ts` reads `.devports.json` at the repository root, which `pnpm dev:ports` writes. `PORTS` and `URLS` take the host and each app's port from it, so a run in a linked worktree drives that worktree's own servers. With no record, the suite uses the pinned ports on `localhost`, as before. A record that does not parse fails the run, because the pinned ports may belong to another checkout. The pinned ports are now exported as `PINNED_PORTS`, and `portsFrom(text)` holds the parse.

This reads the record that the base note `base/0003-dev-ports` adds.

## What the merge plan gets

`packages/e2e/lib/project.ts`, if you edited it. Keep your edits and take the new `PINNED_PORTS`, `portsFrom` and the `PORTS` and `URLS` built from the record.

## What you do

1. Run `pnpm dev:ports` in each checkout that runs the suite, so `.devports.json` exists there.

## Verify

```sh
cat .devports.json
pnpm e2e
```

The record names this checkout's ports, and the suite passes against the servers on those ports.
