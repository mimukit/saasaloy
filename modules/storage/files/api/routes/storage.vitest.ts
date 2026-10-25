import { createStorage } from "@repo/storage";
import { env as workerEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../index";

// The route test for the storage proxy, `PUT` and `GET /storage/objects`. It runs under
// `storage-memory`, so it needs no bucket and no network.
//
// The proxy authorizes with the signed `?token=` the core mints in `createUploadUrl` and
// `createDownloadUrl`, never with a session, so it has no `401` case. A missing token and a
// token for the other method are its two refusals, and both answer `403`. The `400` is an
// upload with no body.

const KEY = "t/default/uploads/route-test/notes.txt";

/** The Worker's environment plus the storage keys this file relies on. */
function env(): Record<string, unknown> {
  return {
    ...(workerEnv as object),
    STORAGE_PROVIDER: "memory",
    STORAGE_URL_SECRET: "test-storage-secret-test-storage-32",
  };
}

/** The path and query of a proxy link the core minted, for `app.request`. */
function proxyPath(url: string): string {
  return url.slice(url.indexOf("/storage/"));
}

function put(path: string, body?: string) {
  return app.request(
    path,
    {
      method: "PUT",
      ...(body === undefined
        ? {}
        : { body, headers: { "content-type": "text/plain" } }),
    },
    env()
  );
}

describe("PUT and GET /storage/objects", () => {
  it("stores the body under the token's key, and serves it back", async () => {
    const files = createStorage(env());
    const upload = await files.createUploadUrl(KEY, {
      contentType: "text/plain",
    });

    const stored = await put(proxyPath(upload.url), "hello world");

    expect(stored.status).toBe(200);
    await expect(stored.json()).resolves.toStrictEqual({ key: KEY, size: 11 });
    const download = await files.createDownloadUrl(KEY);
    const served = await app.request(proxyPath(download.url), {}, env());
    expect(served.status).toBe(200);
    await expect(served.text()).resolves.toBe("hello world");
  });

  it("answers 403 for an upload with no token", async () => {
    const res = await put("/storage/objects", "hello world");

    expect(res.status).toBe(403);
  });

  it("answers 403 for a download token used to upload", async () => {
    const download = await createStorage(env()).createDownloadUrl(KEY);

    const res = await put(proxyPath(download.url), "hello world");

    expect(res.status).toBe(403);
  });

  it("answers 400 for an upload with no body", async () => {
    const upload = await createStorage(env()).createUploadUrl(KEY);

    const res = await put(proxyPath(upload.url));

    expect(res.status).toBe(400);
  });
});
