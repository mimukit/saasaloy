import { testDatabase } from "@repo/db/testing";
import { env as workerEnv } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import app from "../index";

// The scoping `file-uploads` promises, proved through the routes. It runs against the
// test database the database driver prepares, seeded from `packages/db/src/seed/slices/`,
// and under `storage-memory`, so it needs no bucket and no network.
//
// The seed's users belong to no organization, so every request here acts for the
// `default` tenant. That is the case the owner scope exists for: two users who share the
// tenant must still see and act on only their own objects. A public object stays readable
// by its key, by anyone, because that is what public means.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

/**
 * The Worker's own environment, which the test stand-in reads from `apps/api/.env` and
 * `apiEnv` validates, then this file's database and the storage keys these tests rely on.
 */
function env(): object {
  return {
    ...(workerEnv as object),
    ...database.env,
    STORAGE_PROVIDER: "memory",
    STORAGE_PUBLIC_URL: "http://localhost:4000/files/public",
    STORAGE_URL_SECRET: "test-storage-secret-test-storage-32",
  };
}

/** Sign a seeded user in as a client and return the session cookie pair. */
async function signIn(email: string): Promise<string> {
  const res = await app.request(
    "/auth/sign-in/email",
    {
      body: JSON.stringify({ email, password: "saasaloy-dev-password" }),
      headers: { "content-type": "application/json", ...ORIGIN },
      method: "POST",
    },
    env()
  );
  expect(res.status).toBe(200);
  const line = res.headers
    .getSetCookie()
    .find((header) => header.startsWith("client.session_token="));
  expect(line, "the sign-in sets the client cookie").toBeDefined();
  return (line ?? "").split(";")[0] ?? "";
}

function call(path: string, cookie: string, init: RequestInit = {}) {
  return app.request(
    path,
    {
      ...init,
      headers: {
        "content-type": "application/json",
        cookie,
        ...ORIGIN,
        ...init.headers,
      },
    },
    env()
  );
}

/** Run the three upload steps for `cookie` and return the finished row's id and key. */
async function upload(
  cookie: string,
  visibility: "private" | "public"
): Promise<{ id: string; key: string }> {
  const bytes = "hello world";
  const started = await call("/files/uploads", cookie, {
    body: JSON.stringify({
      contentType: "text/plain",
      filename: "notes.txt",
      size: bytes.length,
      visibility,
    }),
    method: "POST",
  });
  expect(started.status).toBe(201);
  const {
    id,
    key,
    upload: target,
  } = (await started.json()) as {
    id: string;
    key: string;
    upload: { url: string; headers: Record<string, string> };
  };

  const put = await app.request(
    target.url.slice(target.url.indexOf("/storage/")),
    { body: bytes, headers: target.headers, method: "PUT" },
    env()
  );
  expect(put.ok).toBeTruthy();

  const done = await call(`/files/uploads/${id}/complete`, cookie, {
    method: "POST",
  });
  expect(done.status).toBe(200);
  return { id, key };
}

async function listedIds(cookie: string): Promise<string[]> {
  const res = await call("/files", cookie);
  expect(res.status).toBe(200);
  const body = (await res.json()) as { objects: { id: string }[] };
  return body.objects.map((row) => row.id);
}

describe("two users with no organization", () => {
  it("lists only the caller's own objects", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");
    const mine = await upload(member, "private");

    await expect(listedIds(member)).resolves.toStrictEqual([mine.id]);
    await expect(listedIds(admin)).resolves.toStrictEqual([]);
  });

  it("refuses a download link for another user's object", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");
    const mine = await upload(member, "private");

    const res = await call(`/files/${mine.id}/download`, admin);

    expect(res.status).toBe(404);
  });

  it("refuses to delete another user's object, and the object survives", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");
    const mine = await upload(member, "private");

    const res = await call(`/files/${mine.id}`, admin, { method: "DELETE" });

    expect(res.status).toBe(404);
    await expect(listedIds(member)).resolves.toStrictEqual([mine.id]);
  });

  it("refuses to complete another user's upload", async () => {
    const member = await signIn("member@example.test");
    const admin = await signIn("admin@example.test");
    const mine = await upload(member, "private");

    const res = await call(`/files/uploads/${mine.id}/complete`, admin, {
      method: "POST",
    });

    expect(res.status).toBe(404);
  });

  it("still serves a public object by its key, with no session", async () => {
    const member = await signIn("member@example.test");
    const mine = await upload(member, "public");

    const res = await app.request(`/files/public/${mine.key}`, {}, env());

    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("hello world");
  });
});

describe("POST /files/uploads/:id/complete", () => {
  it("answers 409 with the conflict code for an object that is already ready", async () => {
    const member = await signIn("member@example.test");
    const mine = await upload(member, "private");

    const res = await call(`/files/uploads/${mine.id}/complete`, member, {
      method: "POST",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("conflict");
  });
});

describe("GET /files", () => {
  it("gives a pending public row no url", async () => {
    const member = await signIn("member@example.test");
    const started = await call("/files/uploads", member, {
      body: JSON.stringify({
        contentType: "image/png",
        filename: "a.png",
        size: 70,
        visibility: "public",
      }),
      method: "POST",
    });
    expect(started.status).toBe(201);

    const res = await call("/files", member);
    const body = (await res.json()) as {
      objects: { status: string; url?: string }[];
    };

    expect(body.objects).toHaveLength(1);
    expect(body.objects[0]?.status).toBe("pending");
    expect(body.objects[0]?.url).toBeUndefined();
  });
});
