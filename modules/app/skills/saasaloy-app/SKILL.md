---
name: saasaloy-app
description: Runbook for the app capability — the customer SPA at apps/app on port 3002, where every signed-in user lands. Use when adding a product screen (a list or a form) to apps/app, putting a screen in the sidebar, protecting a screen by session or by role, calling the api from the app with the typed hc client and TanStack Query, wiring the sign-in and sign-up routes, changing the app's canvas in app.css, debugging the :3002 → :4000 cookie and CORS flow (including COOKIE_DOMAIN and the workers.dev case), deploying the static bundle to Workers, or removing the module.
---

# app — the customer SPA

`apps/app` is the product a signed-in user sees: a TanStack Router + Vite SPA on port 3002, built on the `shell` frame with the web brand tokens, light first. `apps/web` keeps the public pages; `apps/admin` is the backoffice for the admin group. Any signed-in account may open `app`. See ADR 0047 for why the product lives here and not in `web` or `admin`.

`saasaloy add app` installs `api`, `auth` and `shell` first, and needs no `admin`. It writes:

| Path | What it is |
|---|---|
| `apps/app/` | the SPA: `vite.config.ts` (port 3002, `strictPort`), `wrangler.jsonc` (assets only), `src/env.ts` |
| `apps/app/src/routes/__root.tsx` | the one guard: no session sends the visitor to `/sign-in?redirect=…` |
| `apps/app/src/routes/sign-in.tsx`, `sign-up.tsx` | the `auth` module's `SignInCard` and `SignUpCard`, with the calls to the client instance |
| `apps/app/src/routes/index.tsx` | the home screen: a welcome card and an empty state that points at `saasaloy-feature` |
| `apps/app/src/components/nav.ts` | the sidebar's nav data |
| `apps/app/src/lib/auth.ts`, `api.ts`, `redirect.ts` | the auth client and session cache, the typed api client, the safe-destination check |
| `packages/ui/src/styles/app.css` | the app's one stylesheet: `brand.css`, `shell.css`, two canvas values |

It also appends an `app` row to `packages/env/src/services.ts`, a deploy target and a smoke check to `packages/tooling/src/targets.ts`, and a `PUBLIC_API_URL` entry for `app` to `packages/env/.env.example`. The `auth` module's blocks under `packages/ui/src/blocks/auth/` arrive in the same run, because they ship with `shell`.

## Wire-up

After `saasaloy add app`:

1. Run `pnpm install`.
2. Run `saasaloy env`, then `pnpm env:setup`. `apps/app/.env` gets `PUBLIC_API_URL` (`http://localhost:4000` in dev).
3. Run `pnpm db:seed` if the database is empty, then `pnpm dev`. Open `http://localhost:3002` and sign in as `member@example.test` with the password `saasaloy-dev-password`, or create an account on `/sign-up`.
4. **A project made before the `app` release** has no `http://localhost:3002` in `DEV_ORIGINS`, in `apps/api/src/index.ts` and in `packages/auth/src/auth.ts`. Run `saasaloy update api auth` first, or every call from :3002 fails CORS (see Failure modes).
5. **In production**, add the app's origin to `CORS_ORIGINS`, the one list the api CORS spine and `auth`'s `trustedOrigins` both read: `CORS_ORIGINS=https://x.com,https://app.x.com,https://admin.x.com`. A set value replaces the localhost list, so name every frontend. Put the app and the api on sibling subdomains of one domain you own, and set `COOKIE_DOMAIN=.x.com` when the derived one does not match. Set `PUBLIC_API_URL` for the `app` service to the api's origin.

## Add a screen

Drop `src/routes/<screen>.tsx` with a `createFileRoute` whose id matches the file path. The file is a child of `src/routes/__root.tsx`, so it gets the shell and the session guard with no work of its own. `@tanstack/router-plugin` rewrites `src/routeTree.gen.ts` on the next `pnpm dev` or `pnpm build`; never edit that file by hand.

Then put it in the sidebar: add a row to `NAV_AREAS` in `src/components/nav.ts`. The `to` is checked against the route tree, so a typo fails `pnpm typecheck`.

```ts
items: [
  { to: "/", label: "Home", icon: HouseIcon },
  { to: "/projects", label: "Projects", icon: FolderIcon },
],
```

Every screen renders inside the shell's page frame, which owns the width, the background and the gutter. Never set a page's own `max-w-*`, padding or background. Compose from the `shell` set only: `@repo/ui/components/shell/*`, `@repo/ui/blocks/shell/*`, `@repo/ui/containers/shell/*`. The base `oxlint.config.mjs` makes a base primitive under `apps/app/**` a lint error. `saasaloy-shell` lists the blocks.

### The list recipe

A list reads the api through TanStack Query, and the loader fills the cache before the first paint. The route below assumes an api route `GET /projects` that answers `{ projects, total }`; the `saasaloy-feature` skill builds one.

```tsx
// src/routes/projects.index.tsx  →  /projects
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { FolderIcon } from "lucide-react";

import { DataTable } from "@repo/ui/blocks/shell/data-table";
import type { DataTableColumn } from "@repo/ui/blocks/shell/data-table";
import { EmptyState } from "@repo/ui/blocks/shell/empty-state";
import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import { StatusPill } from "@repo/ui/components/shell/status-pill";
import { PageLayout } from "@repo/ui/containers/shell/page-layout";

import { api } from "@app/lib/api";

const projectsQuery = queryOptions({
  queryKey: ["projects"],
  queryFn: async () => {
    const res = await api.projects.$get();
    if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
    return res.json();
  },
});

type Project = Awaited<ReturnType<NonNullable<typeof projectsQuery.queryFn>>>["projects"][number];

const COLUMNS: readonly DataTableColumn<Project>[] = [
  { id: "name", header: "Name", value: (project) => project.name },
  {
    id: "status",
    header: "Status",
    value: (project) => project.status,
    cell: (project) => <StatusPill label={project.status} tone={project.status === "active" ? "ok" : "neutral"} />,
  },
  {
    id: "updated",
    header: "Updated",
    value: (project) => project.updatedAt,
    cell: (project) => new Date(project.updatedAt).toLocaleDateString(),
  },
];

export const Route = createFileRoute("/projects/")({
  loader: ({ context }) => context.queryClient.ensureQueryData(projectsQuery),
  component: Projects,
});

function Projects() {
  const { data } = useQuery(projectsQuery);
  return (
    <PageLayout>
      <PageHeader
        title="Projects"
        count={data?.total}
        actions={<Button render={<Link to="/projects/new" />}>New project</Button>}
      />
      <DataTable
        caption="Projects"
        columns={COLUMNS}
        rows={data?.projects ?? []}
        rowId={(project) => project.id}
        emptyState={<EmptyState icon={FolderIcon} title="No projects yet" description="Create the first one." />}
      />
    </PageLayout>
  );
}
```

`value` is what a column sorts on and shows when it has no `cell`. Read `data` through `?.` even after the loader ran: `useQuery` types it as `T | undefined`, and the repo compiles with `strict`. Check `DataTableColumn`, `PageHeader` and `StatusPill` against their files under `packages/ui/src/` when a prop does not type-check; the shell owns them.

### The form recipe

A form posts through a TanStack Query mutation, then refreshes the list and navigates back. The server validates again; the form's checks are for the person typing.

```tsx
// src/routes/projects.new.tsx  →  /projects/new
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import type { SubmitEvent } from "react";

import { PageHeader } from "@repo/ui/blocks/shell/page-header";
import { Button } from "@repo/ui/components/shell/button";
import { Field, FieldError, FieldLabel } from "@repo/ui/components/shell/field";
import { Form } from "@repo/ui/components/shell/form";
import { Input } from "@repo/ui/components/shell/input";
import { Textarea } from "@repo/ui/components/shell/textarea";
import { toastManager } from "@repo/ui/components/shell/toast";
import { PageBody } from "@repo/ui/containers/shell/page-body";

import { api } from "@app/lib/api";

export const Route = createFileRoute("/projects/new")({ component: NewProject });

function NewProject() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const create = useMutation({
    mutationFn: async (input: { name: string; description: string }) => {
      const res = await api.projects.$post({ json: input });
      if (!res.ok) {
      throw new Error(`The api answered ${res.status}.`);
    }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["projects"] });
      toastManager.add({ type: "success", title: "Project created" });
      await navigate({ to: "/projects" });
    },
    onError: (error) => {
      toastManager.add({ type: "error", title: "The project was not created", description: error.message });
    },
  });

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = data.get("name");
    const description = data.get("description");
    create.mutate({
      name: typeof name === "string" ? name : "",
      description: typeof description === "string" ? description : "",
    });
  }

  return (
    <>
      <PageHeader title="New project" />
      <PageBody>
        <Form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
          <Field>
            <FieldLabel>Name</FieldLabel>
            <Input name="name" required />
            <FieldError />
          </Field>
          <Field>
            <FieldLabel>Description</FieldLabel>
            <Textarea name="description" />
          </Field>
          <Button type="submit" loading={create.isPending} className="self-start">
            Create project
          </Button>
        </Form>
      </PageBody>
    </>
  );
}
```

A form's `max-w-*` is the field column's width inside the page, not the page's width, so it does not fight the frame.

## Protect a screen

**The session.** Every route under `__root.tsx` already needs one. The guard reads `loadSession()` once per page load; a visitor with none goes to `/sign-in?redirect=<the page>`, and the sign-in screen sends them back after a sign-in. `src/lib/redirect.ts` keeps that `redirect` on this origin and on a route this app has, or falls back to `/`.

**A role.** Ask the api, not the session object. The client session this app holds is not typed with `role`: `adminClient()` rides on the admin client only (see `saasaloy-auth`). So a role-gated screen calls a route the api guards with `requireRole`, in its `beforeLoad`, and sends the visitor home on a `403`:

```tsx
export const Route = createFileRoute("/billing")({
  beforeLoad: async () => {
    const res = await api.billing.$get();
    if (res.status === 403) {
      throw redirect({ to: "/" });
    }
  },
  component: Billing,
});
```

An organization role from the `teams` module is a different question with its own helper, `can()` from `@repo/auth/permission-rules`; `saasaloy-teams` covers it.

**The api is the real gate.** Hiding a screen protects nothing. Every api route the screen calls checks the session or the role itself, with `requireSession(c)` or `requireRole(c, …)` from `@repo/auth/server` (see `saasaloy-auth`). A request from `app` carries the client session, because `src/lib/api.ts` sends no `x-auth-audience` header.

## Call the api

`src/lib/api.ts` exports `api`, an `hc<AppType>` client: `api.<route>.$get()` returns the route's own response type, with no hand-written fetch. It sends the session cookie (`credentials: "include"`) to `PUBLIC_API_URL`. Wrap each call in `queryOptions` for a read and `useMutation` for a write, as the recipes above do.

An api route a screen calls is the `api` module's business: add it under `apps/api/src/routes/` and gate it there. `saasaloy-api` has the route recipe, and `saasaloy-feature` builds a table, a route and a screen together.

## Theme and stylesheet

`src/main.tsx` imports `@repo/ui/styles/app.css`, the app's one Tailwind entrypoint. It imports `brand.css` (the web brand tokens, which import `globals.css`), then `shell.css` (the shell primitives' `@source` line, status tokens and motion), then sets two canvas values per theme: `--sidebar` and `--sidebar-accent`. Those are the round 2 values the approved mockup settled on, so the white panel stands off the canvas. A shadcn preset applied to `brand.css` repaints `app` and the landing page together; `admin` keeps its own theme in `admin.css`.

The app starts light on a first visit and keeps the visitor's choice after that, `system` included. The theme menu sits in the shell's account menu.

## Ports and CORS

| Service | Port |
|---|---|
| `apps/web` | 3000 |
| `apps/admin` | 3001 |
| `apps/app` (this app) | **3002**, with `strictPort` |
| `email-react` preview | 3003 |
| `apps/api` | 4000 |

`http://localhost:3002` is in the api's `DEV_ORIGINS` and in `auth`'s `trustedOrigins` fallback. `strictPort` makes a busy port fail at once rather than move to 3003, where nothing allows it. Cookies ignore the port, so the app at :3002 and the api at :4000 share the `localhost` jar, and the client cookie (`client.session_token`) never replaces the admin app's `admin.session_token`.

## Deploy

`apps/app/wrangler.jsonc` serves `dist/` as Workers static assets with `not_found_handling: "single-page-application"`, so a hard reload on `/projects` gets `index.html` and the router takes over. `pnpm deploy:production` deploys it after the api and admin (`order: 25`) through the `deploy` script, `env-deploy app`, and smoke-checks `/` when the Worker has a custom domain route. Set the production `PUBLIC_API_URL` for `app` and add the app's origin to `CORS_ORIGINS` first (step 5 of Wire-up). `saasaloy-deploy` has the full run.

## Removing the module

`saasaloy remove app` deletes `apps/app`, `app.css` and the rows in `services.ts` and `targets.ts`, and leaves `shell` and `auth` installed. Take the app's origin out of `CORS_ORIGINS`, and run `pnpm install` so the lockfile drops the workspace. `saasaloy remove shell` then removes the auth blocks too, unless `admin` still needs `shell`.

## Failure modes

- **The browser console says the request was blocked by CORS, or sign-in answers `403` with `INVALID_ORIGIN`.** The origin is not in the list. In dev, the project predates the `app` release: run `saasaloy update api auth`, so `http://localhost:3002` joins `DEV_ORIGINS`. In production, add the app's origin to `CORS_ORIGINS` and redeploy the api; a set `CORS_ORIGINS` replaces the localhost list, so it has to name every frontend.
- **Sign-in succeeds, then the guard sends the visitor straight back to `/sign-in`.** The browser did not keep the session cookie, or does not send it to the api. The app and the api must be same-site: sibling subdomains of one domain you own, such as `app.x.com` and `api.x.com`. Set `COOKIE_DOMAIN=.x.com` when the domain derived from `BETTER_AUTH_URL` is not the shared parent.
- **The same loop on `*.workers.dev`.** `workers.dev` is on the public suffix list, so `app.<account>.workers.dev` and `api.<account>.workers.dev` are two different sites, and no `COOKIE_DOMAIN` can join them. Browsers treat the session cookie as third-party and drop it. Put both Workers on custom domains of one zone.
- **The build fails naming `PUBLIC_API_URL`.** `apps/app/.env` lacks it. Run `saasaloy env` and `pnpm env:setup`; for a deploy, set it for the `app` service.
- **`pnpm dev` fails with "Port 3002 is already in use".** Another process holds it, often an older `email-react` preview from before it moved to 3003. Stop that process; do not change the port, or CORS breaks.
- **The pages render with no styles.** `src/main.tsx` no longer imports `@repo/ui/styles/app.css`, or `app.css` lost its `shell.css` import. Restore both.
- **The sign-in card renders unstyled.** The blocks are missing: `packages/ui/src/blocks/auth/` is empty because `shell` was installed before `auth`'s blocks existed. Run `saasaloy update auth`.

## Next

Run `saasaloy-feature` to build the first product feature end to end: the table, the api route, the screen here, and its test.
