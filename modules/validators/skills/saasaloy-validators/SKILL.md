---
name: saasaloy-validators
description: Author and consume shared Zod input schemas in packages/validators (@repo/validators). Use when adding request validation to an api route, sharing a schema between the api and a browser bundle, or adding a new per-feature schema file.
---

# saasaloy-validators

`packages/validators` holds the project's shared input schemas. Zod is its only runtime dependency. The api validates requests against these schemas, and browser bundles import the same files, so one schema serves both sides.

## Where a schema lives

One file per feature, directly under `src/`. A file named `src/waitlist.ts` is imported as `@repo/validators/waitlist`, because the package exports `"./*": "./src/*.ts"`. Do not add index barrels and do not nest feature files in folders.

`src/common.ts` holds the primitives every feature reuses: `errorSchema` (the `{ error: { code, message } }` envelope), `errorBody`, `email`, `id`, and `pagination`. Put a schema there only when two or more features need it.

## Rules

- Export the schema and its inferred type together: `export const createInput = z.object({...})` and `export type CreateInput = z.infer<typeof createInput>`.
- Keep every schema isomorphic. No Workers types, no Node APIs, no `process.env`, no imports from `@repo/db` or `@repo/api`. The file must run unchanged in a browser bundle.
- Validate input only. Database column shapes belong in `packages/db`.
- Return errors through `errorSchema` so every response carries the same envelope.
