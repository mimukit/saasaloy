---
name: saasaloy-admin
description: Runbook for the admin capability — a TanStack Router SPA on Vite, deployed as Cloudflare Workers static assets. Use when adding, changing, or debugging pages in apps/admin, calling the api from the shell, or setting VITE_API_URL per environment. Covers the routes/ file-based convention, the staticData nav entry, and the pre-paint theme rule.
---

# admin — TanStack Router SPA on Cloudflare Workers

`apps/admin` is the signed-in shell. It is a client-rendered [TanStack Router](https://tanstack.com/router) app built with Vite and served as Workers static assets, so nothing renders on the edge. Its defining convention is **file-based routing**: a page is a file you drop into `src/routes/`, never an edit to a router or a nav array.

## Add a page (the core convention)

Create `src/routes/<name>.tsx` and export a `Route`:

```tsx
// src/routes/billing.tsx  →  /billing
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/billing")({
  component: Billing,
  staticData: { nav: { label: "Billing", order: 20 } },
});

function Billing() {
  return <main>…</main>;
}
```

`@tanstack/router-plugin` regenerates `src/routeTree.gen.ts` on every `dev` and `build`. That file is plugin-owned: never edit it by hand, and commit the regenerated version with the route that caused it.

`staticData.nav` is how the page registers in the shell nav. The shape is typed in `src/main.tsx`, so a bad `label` or a missing `order` is a type error, not a silent omission. Leave the entry off and the page still works, it just does not appear in the nav.

## Dev servers

`apps/admin` runs on port 3001 with `strictPort: true`. The api Worker's `CORS_ORIGINS` fallback and auth's `trustedOrigins` both hardcode `http://localhost:3001`, so the port must not drift. Run the api on 4000 alongside it:

```sh
pnpm --filter @repo/api dev     # http://localhost:4000
pnpm --filter @repo/admin dev   # http://localhost:3001
```

## The API origin

`VITE_API_URL` is read at **build** time, not run time, and defaults to `http://localhost:4000`. Build once per environment and set it in that environment's build step. There is no runtime config file to edit after deploy.

## The theme rule

`index.html` carries no theme code. `vite.config.ts` injects `THEME_INIT_SCRIPT` from `@repo/ui/lib/theme` at `head-prepend` through a `transformIndexHtml` plugin, so the script runs before first paint and a dark-mode visitor never sees a white flash. Do not paste a copy of the script into `index.html`, and do not turn it into a `<script type="module">` — module scripts are deferred by specification and always run too late.
