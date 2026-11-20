---
title: Registration tables move into generated files
version: 0.10.0
---

Saasaloy 0.10.0 moves every registration table out of the files you keep. A table is the list a module used to add a line to: the providers of a capability, the Better Auth plugins, the api route chain, the sidebar rows, the config sections, the env presets, the services of `packages/env`, the deploy targets. The CLI now writes each table in full into a file named `<name>.generated.ts` beside the file that held it, and that file imports the table and spreads it. On a project an older CLI wrote, each file that held a table still holds the rows inline, so the first update gives it conflict markers or a report line. This note says how to move your own rows.

## What update does

- **It writes each generated file.** For example `packages/email/src/providers.generated.ts` exports `emailProviders`, and `packages/auth/src/plugins.generated.ts` exports `authPlugins` and `adminAuthPlugins`. The export is the camelCase of the table id: `email.providers` is `emailProviders`. The first line of each file names the CLI. These files are `generated`: every run writes them in full, and a run refuses with exit 2 when you edited one (`--force` overwrites it).
- **It merges each module file that held a table.** The base of the merge is the file the module shipped, before any row was added, proved by the hash in your manifest. Your side holds the rows inline, and the new side holds the spread, so the line with the array changes on both sides and gets conflict markers. The report lists the file under `## Files with conflict markers`. Examples: `packages/email/src/index.ts`, `packages/auth/src/auth.ts`, `packages/auth/src/client.ts`, `apps/api/src/index.ts`, `apps/api/src/env.ts`, `apps/admin/src/components/nav.ts`.
- **It leaves the four base files you own.** `packages/env/src/services.ts`, `packages/env/src/sources.ts`, `packages/tooling/src/targets.ts` and `packages/ui/src/blocks/navbar.tsx` are written once and never merged. The run writes their generated files (`services.generated.ts`, `sources.generated.ts`, `targets.generated.ts`, `navbar.generated.ts`), and nothing imports them until you move the table. The report lists each of the four under `## Written once, changed upstream`.
- **The order of a table is fixed.** The CLI sorts the rows of a table by their `order`, then by module name. It no longer depends on the order you added the modules in, so a list such as the sidebar or the Better Auth plugins can come out in a new order.

## What update merges

Each module file that held a table, as described above. Inside the markers, `mine` holds the array with every row, the rows the modules added and the rows you added by hand, and `saasaloy 0.10.0` holds the array with the entries the module ships inline and then the spread of the generated export.

## What you do

1. Run the update as note `base/0007-render-and-merge-engine` says: on its own branch, with a clean tree, and with the report saved to `.saasaloy/update-report.md`.
2. For each file with markers that held a table, take the `saasaloy 0.10.0` side: the import of the generated file and the array with the spread. Then find your own rows. A row is yours when the generated file beside it does not hold it: compare the `mine` side with `<name>.generated.ts`. Put each of your rows after the spread, in the order you want, and delete the markers. Do not keep a row that the generated file holds: it registers twice, and most registries throw on a duplicate name.
3. Keep the order of the array. The entries the module ships inline come first (in `auth.ts`, `audience(...)` stays first), then the spread, then your rows. For example `providers: [...emailProviders, myProvider()]` and `plugins: [audience(CLIENT_AUDIENCE), siteRoles(), clientAdminGuard(), ...authPlugins, myPlugin()]`.
4. In `apps/api/src/index.ts`, the typed chain is now `const app = apiRoutes(base);` and `base` is wrapped in `apiBaseRoutes(...)`. Both come from `./routes.generated`, and `/health` is a row of the generated chain. Add your own routes after the call: `const app = apiRoutes(base).route("/reports", reports);`. A route you mounted on `base` by hand goes inside `apiBaseRoutes(...)`, after the `.notFound(...)` link.
5. In `apps/admin/src/components/nav.ts` and `apps/app/src/components/nav.ts`, the shipped areas are `SHIPPED_AREAS`, and `NAV_AREAS` is `withRows(SHIPPED_AREAS, [...adminNav])` (`appNav` in the app). Keep a row of your own in a group of `SHIPPED_AREAS`, or add it after the spread as `{ area: "/", group: "Manage", to: "/reports", label: "Reports", icon: ChartIcon }`.
6. For each of the four base files you own, move the table by hand or run `saasaloy update --merge <path> --yes`, which merges that one file three ways and may leave markers. By hand: import the export from the generated file (`import { envServices } from "./services.generated.ts";`), put `...envServices` in the array after the rows the base ships, and delete the rows the generated file holds. The exports are `envServices` and `envSources` in `packages/env`, `toolingDeployTargets` and `toolingSmokeChecks` in `packages/tooling`, and `uiPageLinks` in `packages/ui`.
7. Never edit a `.generated.ts` file. A row of your own goes in the file that spreads it, after the spread.
8. When the work is done, record this note with `saasaloy update --done base/0008-generated-tables --yes`.

## Verify

```sh
git ls-files '*.generated.ts' | while IFS= read -r f; do n=$(basename "$f" .ts); git grep -q -e "/$n\"" -e "/$n.ts\"" -- '*.ts' '*.tsx' || echo "not imported: $f"; done
grep -rn '<<<<<<< mine' --include='*.ts' --include='*.tsx' apps packages
pnpm check
```

The first command prints nothing: each generated file is imported. The second prints nothing. `pnpm check` passes. `saasaloy update` then exits `0`.
