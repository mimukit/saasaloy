import { z } from "zod";

/** Shape every api error response uses: `{ error: { code, message } }`. */
export const errorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
  }),
});
export type ErrorResponse = z.infer<typeof errorSchema>;

/** Build an error body without hand-writing the envelope. */
export function errorBody(code: string, message: string): ErrorResponse {
  return { error: { code, message } };
}

/** A trimmed, lowercased email address. */
export const email = z.string().trim().toLowerCase().pipe(z.email());
export type Email = z.infer<typeof email>;

/** An opaque record identifier. */
export const id = z.string().min(1).max(128);
export type Id = z.infer<typeof id>;

/** Page cursor + size, with defaults applied. */
export const pagination = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof pagination>;
