import type { z } from "zod";

// Your project owns this file. `saasaloy add payment` wrote it once, and `saasaloy update`
// never changes it: it writes it again only when the file is missing, because
// src/routes/payments.tsx imports it.
//
// Put the search params your project adds to the Payments screen here, as a zod object
// shape. payments.tsx spreads this shape into its own `validateSearch` schema, so a key
// added here is typed on `Route.useSearch()` and on every `<Link to="/payments" search>`
// with no edit to payments.tsx, and that file keeps taking updates cleanly.
//
// Give each key a fallback, such as `.optional().catch(undefined)`, so a malformed value
// in a pasted link drops the param instead of failing the screen. For example, a link
// that opens one payment's panel:
//
//   import { z } from "zod";
//
//   export const paymentsSearchExtension = {
//     payment: z
//       .string()
//       .regex(/^[\w-]{1,64}$/)
//       .optional()
//       .catch(undefined),
//   } satisfies z.ZodRawShape;
export const paymentsSearchExtension = {} satisfies z.ZodRawShape;
