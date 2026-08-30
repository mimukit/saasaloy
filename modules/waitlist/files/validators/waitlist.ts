import { z } from "zod";

import { email } from "./common";

// One file per feature, directly under `src/` — this one is imported as
// `@repo/validators/waitlist` (the package exports `"./*": "./src/*.ts"`).
//
// Isomorphic on purpose: no Workers types, no `@repo/db`, no `@repo/api`. The api route
// validates against it with `zValidator`, and a browser bundle can import the same file.

/** Body of `POST /waitlist` — the address the landing-page form submits. */
export const waitlistInput = z.object({
  // `email` from `common` trims and lowercases before parsing, so `A@B.com ` and
  // `a@b.com` reach the unique `email` column as the same value.
  email,
});
export type WaitlistInput = z.infer<typeof waitlistInput>;
