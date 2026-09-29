---
name: saasaloy-config
description: Work with @repo/config — the values this project checks into its repo and ships identically to every environment. Use when a value needs a single home, when deciding whether something belongs in config or in .env, when adding a section for a capability, when a project override is not taking effect, or when the owner says "where do I change the product name", "where do I put this constant", "config or env".
---

# saasaloy-config — one home for a checked-in value

`@repo/config` is a frozen plain object of values this project checks into its repo. Read it
with a plain import, from an app, a capability or a React island alike:

```ts
import { config } from "@repo/config";

config.app.name;
config.app.locale;
config.plans.tiers.pro.id;
```

There is no factory, no `env` argument, no async and no I/O. The object is built once at
module load and frozen, so a bundler can inline it.

## The rule: config or `.env`

- **`env`** owns a value the platform supplies per deployment, secret or not. A database
  URL, an API origin, a Stripe key, a provider selection.
- **`config`** owns a value checked into the repo that is the same in every deployment. The
  product name, the locale, a role string, a tier id.

**The test.** Two deployments of *this* project — production and staging. If the value can
differ between them, it is `env`. If it cannot, it is `config`. A value that differs between
two *different* projects but not between one project's environments is `config`.

`packages/config` imports nothing, `@repo/env` included, so a section cannot read an env
var. A value derived from both channels is derived where it is used, not in a section file.

## The other split: numbers versus sentences

A number, an id or a path lives in `packages/config`. A sentence a reader sees lives in
`packages/ui/src/content/`. So `config.app.currencySymbol` and `config.plans.tiers.pro.id`
are config, and "Start free trial" is content. The content files read their ids and numbers
back from config, never the other way around.

## The four files

| Path | Who owns it |
|------|-------------|
| `src/project.ts` | **You.** The only file here you are expected to edit. Nothing overwrites it. |
| `src/sections.ts` | The registry. `saasaloy add` patches one line into it; do not hand-edit the array. |
| `src/sections/<key>.ts` | The module that installed it (`app` and `plans` belong to the base template). |
| `src/define.ts` | The base template. The composition core. |

## Changing a value

Edit `src/project.ts`. It is typed as a partial of the composed shape, so a key no
installed section defines is a `typecheck` error rather than a value nothing reads.

```ts
export const project: ProjectOverride = {
  app: { name: "Ledgerly", locale: "en-GB" },
};
```

**The merge goes one level below the section, and no deeper.** `app: { name: "..." }`
replaces the name and keeps the rest of `app`. A nested record or an array is replaced
whole, so `app: { legal: { termsPath: "/legal/terms" } }` must also name `privacyPath`.

Run `pnpm typecheck` after an edit. That is the only validation there is: the values are
literals in this repo, so a wrong one is a review problem rather than a runtime one.

## Adding a section

A capability contributes one section, keyed by the module name. The module ships one file
into `packages/config/src/sections/<key>.ts` and registers it with a `plugin-array` patch:

```ts
// packages/config/src/sections/shop.ts
import { defineSection } from "@repo/config/define";

export function shopConfig() {
  return defineSection("shop", {
    defaultCurrency: "USD",
    maxCartItems: 50,
  });
}
```

```jsonc
// the module's registry-item.json
{
  "file": "packages/config/src/sections.ts",
  "kind": "plugin-array",
  "exportName": "sections",
  "arrayProp": "sections",
  "call": "shopConfig",
  "import": { "name": "shopConfig", "from": "./sections/shop" }
}
```

Four rules:

- **The key is the module name**, flat, and unique. `saasaloy add` refuses two modules
  claiming one key and names both; at runtime a duplicate throws at module load.
- **The section file lives in `packages/config`, not in the capability.** `@repo/config` is
  the leaf of the dependency graph — it imports nothing, so everything may import it,
  including the capability whose values these are. A section inside the capability would
  invert that and cycle.
- **Import the helper by subpath**, `@repo/config/define`, never by relative path.
- **A section never reads another section.** They are composed side by side. Apply a
  fallback between two sections where the value is used, the way
  `apps/api/src/billing-store.ts` does for `config.billing.appName || config.app.name`.

## When an override does not take effect

1. **The section is not installed.** `config.shop` only exists once `saasaloy add shop`
   has patched `src/sections.ts`. Check the array.
2. **You edited a section file, not `project.ts`.** A module-owned section file may be
   rewritten by `saasaloy update`. Move the edit to `project.ts`.
3. **You expected a deep merge.** One level below the section is the whole rule; a nested
   record is replaced whole.
4. **Something reads the value at build time.** A Node config file (`astro.config.mjs`,
   `vite.config.ts`) is not part of the app graph and keeps its own literals on purpose.

## What is not here

- **A runtime override channel.** A value that must change per deployment is an `env` value
  by definition.
- **Schema validation.** `typecheck` is the gate.
- **A `<CAP>_PROVIDER` key.** Provider selection stays in `env`.
- **The dev ports.** 3000/3001/4000 are read by Node config files at build time.
