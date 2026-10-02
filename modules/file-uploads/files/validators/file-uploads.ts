import { z } from "zod";

// One file per feature, directly under `src/` — this one is imported as
// `@repo/validators/file-uploads` (the package exports `"./*": "./src/*.ts"`).
//
// Isomorphic on purpose: no Workers types, no `@repo/db`, no `@repo/storage`. The api
// route validates against it with `zValidator`, and a browser bundle can import the same
// file.
//
// What is NOT here: the per-file size cap. `STORAGE_MAX_UPLOAD_BYTES` is read from the
// Worker environment, and a schema that baked a number in would be wrong the moment a
// project changed it. The route compares `size` against the client's own cap instead.

/** `private` keeps the signed-link path; `public` gets a world-readable CDN URL. */
export const visibility = z.enum(["private", "public"]);
export type Visibility = z.infer<typeof visibility>;

/** Every state a row passes through. `pending` on insert, one of the rest afterwards. */
export const objectStatus = z.enum([
  "pending",
  "ready",
  "rejected",
  "deleting",
  "deleted",
]);
export type ObjectStatus = z.infer<typeof objectStatus>;

/**
 * Body of `POST /files/uploads`.
 *
 * `filename` is checked for length only, not for shape: `buildKey` in `@repo/storage`
 * sanitizes it into a key segment, and rejecting a name a user legitimately gave a file
 * ("отчёт.csv") would be worse than folding it.
 *
 * `size` is what the client says the file weighs, and the route refuses it against the
 * cap before it issues a target. It is not trusted afterwards — `complete` heads the real
 * object and rejects a mismatch, which is the check that closes the window a presigned
 * PUT leaves open.
 */
export const uploadRequest = z.object({
  contentType: z.string().trim().min(1).max(255),
  filename: z.string().trim().min(1).max(255),
  /** Optional JSON kept beside the object. */
  metadata: z.record(z.string(), z.string()).optional(),
  size: z.coerce.number().int().positive(),
  visibility: visibility.default("private"),
});
export type UploadRequest = z.infer<typeof uploadRequest>;

/**
 * Query of `GET /files`.
 *
 * `cursor` is the opaque keyset cursor `@repo/db/repositories/objects` issues. It is not
 * parsed here: its shape is the repository's business, and an unreadable one falls back to
 * the first page rather than failing the request.
 */
export const listQuery = z.object({
  cursor: z.string().min(1).max(256).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListQuery = z.infer<typeof listQuery>;
