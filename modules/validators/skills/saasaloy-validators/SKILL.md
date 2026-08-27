---
name: saasaloy-validators
description: Author and consume shared Zod input schemas in packages/validators (@repo/validators). Use when adding request validation to an api route, sharing a schema between the api and a browser bundle, or adding a new per-feature schema file.
---

# saasaloy-validators

`packages/validators` holds the project's shared input schemas. Zod is its only runtime dependency. The api validates requests against these schemas, and browser bundles import the same files, so one schema serves both sides.

## Where a schema lives

One file per feature, directly under `src/`. A file named `src/waitlist.ts` is imported as `@repo/validators/waitlist`, because the package exports `"./*": "./src/*.ts"`. Do not add index barrels and do not nest feature files in folders.

`src/common.ts` holds the primitives every feature reuses: `errorSchema` (the `{ error: { code, message } }` envelope), `errorBody`, `email`, `id`, and `pagination`. Put a schema there only when two or more features need it.

## Using a schema in an api route

An api route validates with `zValidator` from `@hono/zod-validator` and reads the parsed value with `c.req.valid()`, which carries the schema's inferred type into the handler. Pass a hook as the third argument so the failure reply uses the shared envelope instead of Hono's default body.

```ts
// apps/api/src/routes/signup.ts
import { zValidator } from "@hono/zod-validator";
import { errorBody } from "@repo/validators/common";
import { signupInput } from "@repo/validators/signup";
import { Hono } from "hono";

const signup = new Hono();

signup.post(
  "/",
  zValidator("json", signupInput, (result, c) => {
    if (!result.success) {
      const issue = result.error.issues[0];
      const message = issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid request body";
      return c.json(errorBody("invalid_input", message), 400);
    }
  }),
  (c) => {
    const input = c.req.valid("json"); // typed as SignupInput
    return c.json({ email: input.email, name: input.name }, 201);
  },
);

export default signup;
```

`result.error.issues[0]` is possibly undefined under the template's tsconfig, so guard it rather than indexing straight into `.message`.

## Error responses

Every api error body is the `errorSchema` envelope, `{ error: { code, message } }`. Build it with `errorBody(code, message)` from `@repo/validators/common`; do not hand-write the object and do not return a bare `{ message }`. `code` is a stable machine-readable string a client can branch on, such as `invalid_input` or `not_found`. `message` is for a human reader and may change.

## Rules

- Export the schema and its inferred type together: `export const createInput = z.object({...})` and `export type CreateInput = z.infer<typeof createInput>`.
- Keep every schema isomorphic. No Workers types, no Node APIs, no `process.env`, no imports from `@repo/db` or `@repo/api`. The file must run unchanged in a browser bundle.
- Validate input only. Database column shapes belong in `packages/db`.
- Return errors through `errorSchema` so every response carries the same envelope.
