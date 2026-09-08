import { createStorage, StorageError, verifyToken } from "@repo/storage";
import type { StorageEnv } from "@repo/storage";
import { Hono } from "hono";

// The proxy upload and download path. It exists so `createUploadUrl` can always return
// a URL: a provider that cannot sign one (`storage-memory`, or R2 with no API token)
// gets this route instead, and the browser does the same PUT either way.
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file,
// built as ONE chained expression. Splitting the chain into statements empties the
// routes out of `AppType`. `modules/storage`'s `chained-route` patch mounts this at
// `/storage`, so `put("/objects")` serves `PUT /storage/objects`.
//
// Authorization is the signed token in `?token=`, not a session. The token names one
// key, one method and one expiry, and it is verified BEFORE a byte of the body is read
// — an unauthorized PUT must not get to stream a file through the Worker first. The
// token is a bearer credential: whoever holds it can do exactly what it says until it
// expires, which is why the core issues 5-minute uploads and 1-hour downloads.
//
// No CORS here: `modules/api`'s spine applies the credentialed `CORS_ORIGINS` allowlist
// to `*` before this sub-app is mounted.

/** The one error body this api answers with, matching `modules/api`'s envelope. */
function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

/** Map the capability's codes onto HTTP, so a caller branches on a status or a code. */
const STATUS_FOR: Record<string, 400 | 403 | 404 | 413 | 429 | 500 | 501> = {
  invalid_key: 403,
  not_found: 404,
  not_supported: 501,
  provider_error: 500,
  rate_limited: 429,
  too_large: 413,
};

export const storage = new Hono<{ Bindings: StorageEnv }>()
  .put("/objects", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.json(errorBody("forbidden", "missing upload token"), 403);
    }

    try {
      // Verified first, and nothing below reads `c.req.raw.body` until it passes.
      const claims = await verifyToken(c.env, token);
      if (claims.method !== "PUT") {
        return c.json(
          errorBody("forbidden", "token is not an upload token"),
          403
        );
      }

      const files = createStorage(c.env);
      const limit = claims.maxBytes ?? files.maxUploadBytes;

      // `content-length` is the only size a proxy can check before it streams. A body
      // with no length still cannot exceed the cap unnoticed: the feature's `complete`
      // step heads the real object and deletes an oversize one.
      const declared = Number(c.req.header("content-length") ?? "");
      if (Number.isFinite(declared) && declared > limit) {
        return c.json(
          errorBody("too_large", `body exceeds ${limit} bytes`),
          413
        );
      }

      const body = c.req.raw.body;
      if (!body) {
        return c.json(errorBody("invalid_input", "empty request body"), 400);
      }

      const object = await files.put(claims.key, body, {
        contentType:
          claims.contentType ?? c.req.header("content-type") ?? undefined,
      });
      return c.json({ key: object.key, size: object.size }, 200);
    } catch (error) {
      if (error instanceof StorageError) {
        const status = STATUS_FOR[error.code] ?? 500;
        return c.json(errorBody(error.code, error.message), status);
      }
      throw error;
    }
  })
  .get("/objects", async (c) => {
    const token = c.req.query("token");
    if (!token) {
      return c.json(errorBody("forbidden", "missing download token"), 403);
    }

    try {
      const claims = await verifyToken(c.env, token);
      if (claims.method !== "GET") {
        return c.json(
          errorBody("forbidden", "token is not a download token"),
          403
        );
      }

      const object = await createStorage(c.env).get(claims.key);
      if (!object) {
        return c.json(errorBody("not_found", "no such object"), 404);
      }

      // A raw `Response` rather than `c.body`, because the body is a stream the provider
      // owns and Hono's `c.body` overloads do not take `ReadableStream | null`. The
      // stream is passed straight through, so the Worker never buffers the file.
      return new Response(object.body, {
        headers: {
          "content-length": String(object.size),
          "content-type": object.contentType ?? "application/octet-stream",
        },
        status: 200,
      });
    } catch (error) {
      if (error instanceof StorageError) {
        const status = STATUS_FOR[error.code] ?? 500;
        return c.json(errorBody(error.code, error.message), status);
      }
      throw error;
    }
  });
