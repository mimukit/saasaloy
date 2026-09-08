import { z } from "zod";

// One file per feature, directly under `src/` — imported as
// `@repo/validators/feature-flags` (the package exports `"./*": "./src/*.ts"`).
//
// Isomorphic on purpose: no Workers types, no `@repo/db`, no `@repo/feature-flags`. The api
// route validates against it with `zValidator`, and the admin bundle gets the request body's
// type through `hc<AppType>` from the same source.

/** Body of the three `/flags` write routes: the global value, or one tenant's override. */
export const flagValueInput = z.object({
  enabled: z.boolean(),
  // Read only on a percentage flag; the route stores `null` on a boolean one whatever
  // arrives here. `nullish` rather than `optional`, because the admin screen sends an
  // explicit `null` for a boolean flag rather than omitting the field.
  percentage: z.number().int().min(0).max(100).nullish(),
});
export type FlagValueInput = z.infer<typeof flagValueInput>;
