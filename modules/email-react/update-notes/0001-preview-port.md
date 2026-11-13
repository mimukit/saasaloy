---
title: The email preview moves from port 3002 to 3003
---

## What update does

The React Email preview server moves from port 3002 to port 3003, because the `app` module takes 3002 for `apps/app`. `saasaloy update` changes the `dev` script in `packages/email-react/package.json` to:

```json
"dev": "email dev --dir src/templates --port 3003"
```

## What the merge plan gets

`packages/email-react/package.json`, only if you edited it. Keep your edits and take `--port 3003` in the `dev` script.

## What you do

1. Change any bookmark, script or doc of your own that opens `http://localhost:3002` for the email preview to `http://localhost:3003`. This command lists the places to check:

   ```sh
   grep -rn "localhost:3002" --exclude-dir=node_modules --exclude-dir=.git .
   ```

   Leave a hit that means `apps/app` or a CORS origin list alone: port 3002 belongs to the `app` module now.

## Verify

```sh
grep -n '"dev"' packages/email-react/package.json
pnpm --filter @repo/email-react dev
```

The first command shows `--port 3003`. The second starts the preview on `http://localhost:3003`. Stop it with Ctrl-C when it is up.
