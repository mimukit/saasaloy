---
title: The e2e suite serves built apps on CI
---

## What update does

`packages/e2e/lib/project.ts` adds `serveMode(env)` and `SERVE`, which read `E2E_SERVE`. `dev` starts each app's dev server, as before. `built` builds each app with `pnpm turbo run build --filter=@repo/<app> --only`, then starts its `preview` script. Unset, the mode is `built` when `CI` is set and `dev` otherwise. Any other value fails the run when the config loads.

`packages/e2e/playwright.config.ts` starts each app with `serveCommand(app)` in that mode. In built mode it never reuses a running server and waits up to 300 seconds for each app. It also sets `ASTRO_PREVIEW_BACKGROUND=1`, because `astro preview` detaches itself in an AI-agent environment, like `astro dev`.

Built apps use much less memory than dev servers, so a CI runner with a memory limit runs the suite reliably (issue #399).

This needs three other notes: the base note `0012-turbo-build-env-inputs`, which makes a changed origin rebuild the app, and the `preview-port` notes of `api`, `admin` and `app`, which serve each preview on its dev port. Apply them first, or a built run answers on port 4173 and Playwright times out.

## What update merges

`packages/e2e/lib/project.ts` and `packages/e2e/playwright.config.ts`, if you edited them. Keep your edits and take `serveMode`, `SERVE`, `serveCommand`, the two Astro variables, and the mode checks in `reuseExistingServer` and `timeout`.

## What you do

1. Stop `pnpm dev` before a built run, because the preview servers use the same ports.
2. To keep dev servers on CI, set `E2E_SERVE=dev` in your `ci:e2e` script.

## Verify

```sh
E2E_SERVE=built pnpm e2e
```

The log shows one turbo build for each app, then the specs run against the built apps.
