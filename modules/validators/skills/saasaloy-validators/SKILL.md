---
name: saasaloy-validators
description: Author and consume shared Zod input schemas in packages/validators (@repo/validators). Use when adding request validation to an api route, sharing a schema between the api and a browser bundle, or adding a new per-feature schema file.
---

# saasaloy-validators

`packages/validators` holds the project's shared input schemas. Zod is its only runtime dependency. The api validates requests against these schemas, and browser bundles import the same files, so one schema serves both sides.

## Where a schema lives

One file per feature, directly under `src/`. A file named `src/waitlist.ts` is imported as `@repo/validators/waitlist`, because the package exports `"./*": "./src/*.ts"`. Do not add index barrels and do not nest feature files in folders.

`src/common.ts` holds the primitives every feature reuses: `errorSchema` (the `{ error: { code, message } }` envelope), `errorBody`, `email`, `id`, and `pagination`. Put a schema there only when two or more features need it. `src/phone.ts` holds `bangladeshMobile`; see [Bangladeshi mobile numbers](#bangladeshi-mobile-numbers).

## Using a schema in an api route

An api route validates with `zValidator` from `@hono/zod-validator` and reads the parsed value with `c.req.valid("json")`, naming the same target `zValidator` was given. That call carries the schema's inferred type into the handler. Pass a hook as the third argument so the failure reply uses the shared envelope instead of Hono's default body.

```ts
// apps/api/src/routes/signup.ts
import { zValidator } from "@hono/zod-validator";
import { errorBody } from "@repo/validators/common";
import { signupInput } from "@repo/validators/signup";
import { Hono } from "hono";

export const signup = new Hono().post(
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
```

One named export, one chained expression. Split the `.post()` into its own `signup.post(...)` statement and the exported type forgets the route, which empties it out of `AppType`. The name has to be an `export const`: the `chained-route` codemod writes `import { signup } from "./routes/signup"` and refuses a default import. See the `saasaloy-api` skill for the full route contract.

`result.error.issues[0]` is possibly undefined under the template's tsconfig, so guard it rather than indexing straight into `.message`.

## Error responses

Every api error body is the `errorSchema` envelope, `{ error: { code, message } }`. Build it with `errorBody(code, message)` from `@repo/validators/common`; do not hand-write the object and do not return a bare `{ message }`. `code` is a stable machine-readable string a client can branch on, such as `invalid_input` or `not_found`. `message` is for a human reader and may change.

## Bangladeshi mobile numbers

`src/phone.ts` exports `bangladeshMobile` and its inferred type `BangladeshMobile`, imported as `@repo/validators/phone`. It lives in its own file rather than `common.ts` because a single-country schema is not a primitive every feature reuses.

```ts
import { bangladeshMobile } from "@repo/validators/phone";
import { z } from "zod";

export const signupInput = z.object({
  name: z.string().min(1),
  mobile: bangladeshMobile, // or bangladeshMobile.optional()
});
```

It normalizes. The output is canonical E.164, `+8801XXXXXXXXX`, so a handler never sees the form the user typed. Five input forms are accepted, each after the separators are removed:

| Input | Output |
|-------|--------|
| `01712345678` | `+8801712345678` |
| `+8801712345678` | `+8801712345678` |
| `8801712345678` | `+8801712345678` |
| `1712345678` | `+8801712345678` |
| `008801712345678` | `+8801712345678` |

Four rules decide the rest:

- **Allowed separators are digits, a space, `-`, `(`, `)`, `.` and a leading `+`.** Any other character rejects the input. The set is a rejection boundary, not a strip list, so `hello01712345678world` fails instead of reducing to a valid number.
- **ASCII digits only.** Bengali numerals (`০`–`৯`) are rejected. A Bengali-keyboard user retypes in ASCII digits.
- **The operator check is structural.** The digit after the leading `1` must be `3`–`9`, which rejects the `10`, `11` and `12` blocks with no operator table to maintain.
- **One failure message for every rejection class:** `must be a Bangladeshi mobile number, for example +8801712345678`.

There is no `phone({ country })` option and no optional variant. Write `bangladeshMobile.optional()`, the way `email` is used.

This schema and the `sms` capability check the same country at different layers, which is not duplication. The `khudebarta` provider checks `/^\+880\d{10}$/` on a recipient that is already E.164, and it stays dependency-free because `packages/sms` takes no runtime dependency (ADR 0020). This schema guards whatever a person typed at the api request boundary, and every value it returns satisfies the provider's regex. See the `saasaloy-sms` skill for the provider side.

## Rules

- Export the schema and its inferred type together: `export const createInput = z.object({...})` and `export type CreateInput = z.infer<typeof createInput>`.
- Keep every schema isomorphic. No Workers types, no Node APIs, no `process.env`, no imports from `@repo/db` or `@repo/api`. The file must run unchanged in a browser bundle.
- Validate input only. Database column shapes belong in `packages/db`.
- Return errors through `errorSchema` so every response carries the same envelope.
