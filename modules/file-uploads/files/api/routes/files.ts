import { zValidator } from "@hono/zod-validator";
import { requireSession, withAuthScope } from "@repo/auth/server";
import { withDb } from "@repo/db/client";
import {
  createObject,
  findObject,
  findPublicObjectByKey,
  listObjects,
  markDeleted,
  markDeleting,
  markReady,
  markRejected,
} from "@repo/db/repositories/objects";
import {
  assertValidKey,
  buildKey,
  createStorage,
  StorageError,
} from "@repo/storage";
import { errorBody } from "@repo/validators/common";
import { listQuery, uploadRequest } from "@repo/validators/file-uploads";
import { Hono } from "hono";
// Imported for its side effect: the module registers the sweep runner with
// `@repo/file-uploads` at load, and this route file is what puts it on the Worker's import
// graph. Without the line the daily job throws rather than silently sweeping nothing.
import "../lib/storage-sweep";
import {
  hasPublicUrl,
  imageTransformsEnabled,
  PRIVATE_SCOPE,
  PUBLIC_SCOPE,
  publicUrl,
  resolveTenant,
} from "../lib/file-uploads";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { AuthDbBindings } from "@repo/auth/server";
import type { StorageObjectRow } from "@repo/db/repositories/objects";
import type { FileUploadsEnv } from "../lib/file-uploads";

// The object record's api: five authenticated routes and one that is deliberately not.
//
// Route module contract: export a Hono sub-app under a NAMED export matching the file,
// built as ONE chained expression. Splitting the chain into statements empties the routes
// out of `AppType`. This module's `chained-route` patch mounts it at `/files`, so
// `get("/")` serves `GET /files`.
//
// Two rules run through every authenticated route, and they are what the feature promises:
//
//   **Every query goes through `@repo/db/repositories/objects`.** That file takes a tenant
//   id on every call and filters on it. There is no `forTenant` wrapper here, because
//   `file-uploads` does not depend on `multitenant`, so the repository being the only read
//   path is the whole tenant boundary. A raw `db.select()` in this file would remove it.
//
//   **The size cap is enforced twice, and the second time is the one that counts.**
//   `POST /uploads` refuses a declared size over the cap, but a presigned PUT carries no
//   cap S3 query signing could enforce. `POST /uploads/:id/complete` heads the real object
//   and deletes anything that does not match what was declared. That is the window
//   `complete` exists to close.
//
// No CORS and no `onError`: `modules/api`'s spine applies the credentialed `CORS_ORIGINS`
// allowlist before this sub-app is mounted, and an unset `onError` inherits api's, which
// renders the `HTTPException` `requireSession` throws as the shared error envelope.

type Bindings = AuthDbBindings & FileUploadsEnv;

/** Map the capability's codes onto HTTP, so a caller branches on a status or a code. */
const STATUS_FOR: Record<string, 400 | 403 | 404 | 413 | 429 | 500 | 501> = {
  invalid_key: 403,
  not_found: 404,
  not_supported: 501,
  provider_error: 500,
  rate_limited: 429,
  too_large: 413,
};

const validateUpload = zValidator("json", uploadRequest, (result, c) => {
  if (!result.success) {
    return c.json(errorBody("invalid_input", firstIssue(result)), 400);
  }
});

const validateList = zValidator("query", listQuery, (result, c) => {
  if (!result.success) {
    return c.json(errorBody("invalid_input", firstIssue(result)), 400);
  }
});

export const files = new Hono<{ Bindings: Bindings }>()
  // The tenant's objects, newest first. A public row carries its `url`, so a grid of
  // thumbnails renders in one round trip instead of one signed-link request per tile.
  .get("/", validateList, (c) =>
    withAuthScope(c, async () => {
      const session = await requireSession(c);
      const tenantId = resolveTenant(session);
      const { cursor, limit } = c.req.valid("query");

      const page = await withDb(c, (db) =>
        listObjects(db, tenantId, { limit, ...(cursor ? { cursor } : {}) })
      );

      return c.json(
        {
          objects: page.rows.map((row) => toPayload(c.env, row)),
          // Two settings the screen cannot read for itself: it runs in a browser and
          // these live in the Worker environment. Sending them with the list is what lets
          // the upload form disable the public option, and say why, instead of letting a
          // submit fail.
          settings: {
            imageTransforms: imageTransformsEnabled(c.env),
            publicUploads: hasPublicUrl(c.env),
          },
          ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
        },
        200
      );
    })
  )
  // Step one of an upload: record the intent, then hand back somewhere to PUT the bytes.
  // The row exists before the object does, so an upload that is abandoned halfway leaves
  // a `pending` row the sweep can find rather than an orphan in the bucket.
  .post("/uploads", validateUpload, (c) =>
    withAuthScope(c, async () => {
      const session = await requireSession(c);
      const tenantId = resolveTenant(session);
      const input = c.req.valid("json");

      // `STORAGE_PUBLIC_URL` gates a public upload, not the provider. Refusing by name is
      // the point: the operator reads the message and knows exactly which variable to set.
      if (input.visibility === "public" && !hasPublicUrl(c.env)) {
        return c.json(
          errorBody(
            "invalid_input",
            "STORAGE_PUBLIC_URL is not set, so this api cannot issue a public object URL. Set it to the origin that serves your bucket (an R2 custom domain in production, this api's own origin in dev), or upload the file as private."
          ),
          400
        );
      }

      try {
        const storage = createStorage(c.env);
        if (input.size > storage.maxUploadBytes) {
          return c.json(
            errorBody(
              "too_large",
              `File is ${input.size} bytes, over the ${storage.maxUploadBytes}-byte limit STORAGE_MAX_UPLOAD_BYTES sets.`
            ),
            413
          );
        }

        // 122 random bits, and for a public object the only thing standing between the
        // bytes and the internet. See the schema's comment on this column.
        const id = crypto.randomUUID();
        const key = buildKey({
          filename: input.filename,
          id,
          scope: input.visibility === "public" ? PUBLIC_SCOPE : PRIVATE_SCOPE,
          tenantId,
        });

        await withDb(c, (db) =>
          createObject(db, {
            contentType: input.contentType,
            id,
            key,
            ownerId: session.user.id,
            provider: storage.provider,
            size: input.size,
            tenantId,
            visibility: input.visibility,
            ...(input.metadata ? { metadata: input.metadata } : {}),
          })
        );

        const target = await storage.createUploadUrl(key, {
          contentType: input.contentType,
          maxBytes: storage.maxUploadBytes,
        });

        return c.json(
          {
            id,
            key,
            upload: {
              direct: target.direct,
              expiresAt: target.expiresAt.toISOString(),
              headers: target.headers,
              method: target.method,
              url: target.url,
            },
          },
          201
        );
      } catch (error) {
        return storageFailure(c, error);
      }
    })
  )
  // Step two: prove the object is what the uploader said it was.
  //
  // This is the only place the declared size is checked against reality, and it is why
  // the two-step shape exists at all. A mismatch deletes the object and marks the row
  // `rejected` — the row stays so the uploader learns why, rather than watching the file
  // silently not appear.
  .post("/uploads/:id/complete", (c) =>
    withAuthScope(c, async () => {
      const session = await requireSession(c);
      const tenantId = resolveTenant(session);
      const id = c.req.param("id");

      const row = await withDb(c, (db) => findObject(db, tenantId, id));
      if (!row) {
        return c.json(errorBody("not_found", "no such object"), 404);
      }
      if (row.status !== "pending") {
        return c.json(
          errorBody("invalid_input", `object is already ${row.status}`),
          409
        );
      }

      try {
        const storage = createStorage(c.env);
        const object = await storage.head(row.key);
        if (!object) {
          return c.json(
            errorBody("not_found", "nothing was uploaded to that key"),
            404
          );
        }

        const actualType = object.contentType ?? row.contentType;
        const mismatch =
          object.size !== row.size ||
          object.size > storage.maxUploadBytes ||
          actualType !== row.contentType;

        if (mismatch) {
          // Delete first, then record. A Worker that dies between the two leaves a
          // `pending` row with no object, which the sweep removes; the other order would
          // leave bytes nothing points at.
          await storage.delete(row.key);
          await withDb(c, (db) => markRejected(db, tenantId, id));
          return c.json(
            errorBody(
              "rejected",
              `Uploaded object is ${object.size} bytes of ${actualType}, not the ${row.size} bytes of ${row.contentType} that were declared. It has been deleted.`
            ),
            409
          );
        }

        await withDb(c, (db) =>
          markReady(db, tenantId, id, {
            contentType: actualType,
            size: object.size,
          })
        );
        return c.json(
          toPayload(c.env, {
            ...row,
            completedAt: new Date(),
            contentType: actualType,
            size: object.size,
            status: "ready",
          }),
          200
        );
      } catch (error) {
        return storageFailure(c, error);
      }
    })
  )
  // A signed, short-lived link for a private object.
  //
  // It refuses a public id rather than signing one. A public row already carries its `url`
  // in the list response, and issuing a second, expiring URL for a world-readable object
  // would imply a revocability this feature does not have.
  .get("/:id/download", (c) =>
    withAuthScope(c, async () => {
      const session = await requireSession(c);
      const tenantId = resolveTenant(session);

      const row = await withDb(c, (db) =>
        findObject(db, tenantId, c.req.param("id"))
      );
      if (!row || row.status !== "ready") {
        return c.json(errorBody("not_found", "no such object"), 404);
      }
      if (row.visibility === "public") {
        return c.json(
          errorBody(
            "invalid_input",
            "that object is public — read its url from GET /files instead."
          ),
          400
        );
      }

      try {
        const target = await createStorage(c.env).createDownloadUrl(row.key);
        return c.json(
          {
            direct: target.direct,
            expiresAt: target.expiresAt.toISOString(),
            method: target.method,
            url: target.url,
          },
          200
        );
      } catch (error) {
        return storageFailure(c, error);
      }
    })
  )
  // Three writes, in the order that survives a Worker dying between any two of them:
  // mark `deleting`, delete the object, mark `deleted`. A row left in `deleting` is
  // finished by the sweep. The reverse order would leave a row claiming bytes that are
  // already gone.
  .delete("/:id", (c) =>
    withAuthScope(c, async () => {
      const session = await requireSession(c);
      const tenantId = resolveTenant(session);
      const id = c.req.param("id");

      const row = await withDb(c, (db) => findObject(db, tenantId, id));
      if (!row) {
        return c.json(errorBody("not_found", "no such object"), 404);
      }

      try {
        await withDb(c, (db) => markDeleting(db, tenantId, id));
        await createStorage(c.env).delete(row.key);
        await withDb(c, (db) => markDeleted(db, tenantId, id));
        return c.body(null, 204);
      } catch (error) {
        return storageFailure(c, error);
      }
    })
  )
  // The public path. No token, no session, and that is the decision rather than an
  // oversight: a public object is world-readable by anyone who learns its key, and the
  // key's 122-bit `<id>` segment is what protects it.
  //
  // It exists so a project renders an uploaded image before it has set up an R2 custom
  // domain. In production `STORAGE_PUBLIC_URL` points at that domain and this route is
  // simply unused — it is the slower path, not the less safe one.
  //
  // The wildcard receives the whole five-segment key and serves it unchanged, because
  // `STORAGE_PUBLIC_URL` holds an origin only and the key is appended to it verbatim. A
  // path rewrite here is exactly the bug that would make dev and production disagree.
  //
  // Two refusals come before the database is touched. The scope segment has to be
  // `public-uploads`, so no private key is ever looked up, and the key has to pass
  // `assertValidKey`, so a traversal attempt never reaches a query.
  .get("/public/:key{.+}", async (c) => {
    const key = c.req.param("key");
    if (!isPublicKey(key)) {
      return c.json(errorBody("not_found", "no such object"), 404);
    }

    try {
      assertValidKey(key);
    } catch {
      return c.json(errorBody("not_found", "no such object"), 404);
    }

    const row = await withDb(c, (db) => findPublicObjectByKey(db, key));
    if (!row) {
      return c.json(errorBody("not_found", "no such object"), 404);
    }

    try {
      const object = await createStorage(c.env).get(key);
      if (!object) {
        return c.json(errorBody("not_found", "no such object"), 404);
      }
      // A raw `Response`, because the body is a stream the provider owns and Hono's
      // `c.body` overloads do not take `ReadableStream | null`. The Worker never buffers
      // the file.
      //
      // No `cache-control` beyond this one-hour hint. On the production path the header
      // comes from a Cloudflare Cache Rule on the custom domain, matching
      // `/t/*/public-*/*`, because the browser does the PUT and no code path in this
      // module can attach a header to an object it never touches.
      return new Response(object.body, {
        headers: {
          "cache-control": "public, max-age=3600",
          "content-length": String(object.size),
          "content-type":
            object.contentType ?? row.contentType ?? "application/octet-stream",
        },
        status: 200,
      });
    } catch (error) {
      return storageFailure(c, error);
    }
  });

/** True when the key's scope segment is the public one. `t / tenant / scope / id / name`. */
function isPublicKey(key: string): boolean {
  return key.split("/")[2] === PUBLIC_SCOPE;
}

/** The row shape every route answers with. A public row carries the URL that serves it. */
function toPayload(env: FileUploadsEnv, row: StorageObjectRow) {
  const url = row.visibility === "public" ? publicUrl(env, row.key) : undefined;
  return {
    completedAt: row.completedAt?.toISOString() ?? null,
    contentType: row.contentType,
    createdAt: row.createdAt.toISOString(),
    // The last key segment, which is the sanitized name the uploader gave the file. The
    // row does not store it twice: the key is built from it and is the only copy.
    filename: row.key.slice(row.key.lastIndexOf("/") + 1),
    id: row.id,
    key: row.key,
    ownerId: row.ownerId,
    size: row.size,
    status: row.status,
    visibility: row.visibility,
    ...(url === undefined ? {} : { url }),
  };
}

/** One `catch` shape for every storage call, matching `@api/routes/storage.ts`. */
function storageFailure(c: Context, error: unknown): Response {
  if (error instanceof StorageError) {
    return c.json(errorBody(error.code, error.message), {
      status: (STATUS_FOR[error.code] ?? 500) as ContentfulStatusCode,
    });
  }
  throw error;
}

function firstIssue(result: {
  error: { issues: { path: PropertyKey[]; message: string }[] };
}): string {
  const issue = result.error.issues[0];
  return issue
    ? `${issue.path.join(".")}: ${issue.message}`
    : "invalid request body";
}
