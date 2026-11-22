# Product spec

Last updated: YYYY-MM-DD (saasaloy-setup)

<!-- saasaloy-setup copies this file to docs/product-spec.md and fills it. saasaloy-build and saasaloy-feature read it. Keep every ## heading and every row name of an entity table exactly as written here. -->

## Modules

The build installs these modules and no others. Write one row for each module the owner approved, and for each local provider and each module that `dependsOn` pulls in. With no module, write `| None. | | |`: the build ships the landing page only.

| Module | Stage | Why |
|--------|-------|-----|
| `<module>` | `<stage from saasaloy list --json>` | <the answer it comes from, or "needed by `<pick>`"> |

## Entities

The build makes one Feature pass and one commit for each entity, in this order. With no signed-in product, write `None.` here and no entity heading.

### 1. <Entity name>

| Part | Value |
|------|-------|
| Table | `<plural_snake_case>` |
| Fields | `<name>` <type>, required; `<name>` <type> |
| Who may see it | <the owner, the organization, or every signed-in user reads and the owner writes><; staff read every row in admin, only when `## Modules` holds `admin`> |
| Actions | `list`, `create`, `update`, <each named domain verb in a code span> |
| Screens | app: list (`data-table`), detail (`detail-panel`), create and update form (`form`, `field`)<; admin: read-only list (`data-table`), only when `## Modules` holds `admin`> |

## Not in this build

- <a wish that no module covers, in the owner's words, or "None.">

## Left for the owner

- <a vendor step for a picked module that needs an account, or "None.">
