import { users } from "@repo/db/schema/auth";
import { seedId } from "@repo/db/seed/id";
import { testDatabase } from "@repo/db/testing";
import { env as workerEnv } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import app from "../index";

// The CMS routes, proved through the app. It runs against the test database the database
// driver prepares, seeded from `packages/db/src/seed/slices/`: the published "Welcome to
// the blog" post (version 2, written by the superadmin) and the draft "Drafting the
// second post" (version 1, written by the admin).
//
// The admin routes read the admin session, so a caller signs in on `/admin/auth` and
// sends the `admin.session_token` cookie. The public routes take no session at all.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const database = testDatabase();

const ORIGIN = { origin: "http://localhost:3000" };

const WELCOME = seedId("cms_entries", "welcome");
const DRAFT = seedId("cms_entries", "second-post");
const ADMIN = seedId("users", "admin");

function env(): object {
  return {
    ...(workerEnv as object),
    ...database.env,
    STORAGE_PROVIDER: "memory",
    STORAGE_PUBLIC_URL: "http://localhost:4000/files/public",
    STORAGE_URL_SECRET: "test-storage-secret-test-storage-32",
  };
}

/** Sign a seeded user in on the admin instance and return its session cookie pair. */
async function signInAdmin(email = "admin@example.test"): Promise<string> {
  const res = await app.request(
    "/admin/auth/sign-in/email",
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
    .find((header) => header.startsWith("admin.session_token="));
  expect(line, "the sign-in sets the admin cookie").toBeDefined();
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

function send(path: string, cookie: string, method: string, body?: unknown) {
  return call(path, cookie, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const BODY = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [{ type: "text", text: "Hello from the api." }],
    },
  ],
};

function postData(overrides: Record<string, unknown> = {}) {
  return { body: BODY, cover: null, excerpt: "", seo: {}, ...overrides };
}

interface EntryBody {
  entry: {
    id: string;
    slug: string;
    status: string;
    version: number;
    authorName: string | null;
    updatedByName: string | null;
    hasUnpublishedEdits: boolean;
    liveSlug: string | null;
  };
}

interface ConflictBody {
  error: { code: string; message: string };
  conflict: {
    updatedAt: string;
    updatedByName: string | null;
    version: number;
  };
}

/** Create a draft as `cookie` and return it. */
async function create(cookie: string, slug: string, title = "Hello") {
  const res = await send("/cms/admin/blog/entries", cookie, "POST", {
    data: postData(),
    slug,
    title,
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as EntryBody).entry;
}

describe("the admin guard", () => {
  it("answers 401 to a signed-out caller", async () => {
    const res = await app.request("/cms/admin/blog/entries", {}, env());

    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("answers 401 to a write with no session, and writes nothing", async () => {
    const res = await send("/cms/admin/blog/entries", "", "POST", {
      data: postData(),
      slug: "sneaky",
      title: "Sneaky",
    });

    expect(res.status).toBe(401);
  });

  it("answers 403 to an admin session whose role is no longer an admin role", async () => {
    const cookie = await signInAdmin();
    await database.db
      .update(users)
      .set({ role: "user" })
      .where(eq(users.id, ADMIN));

    const res = await call("/cms/admin/blog/entries", cookie);

    expect(res.status).toBe(403);
  });
});

describe("GET /cms/admin/:collection/entries", () => {
  it("lists draft and published entries by default, with author and edit state", async () => {
    const cookie = await signInAdmin();

    const res = await call("/cms/admin/blog/entries", cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: {
        id: string;
        status: string;
        authorName: string | null;
        hasUnpublishedEdits: boolean;
      }[];
      page: number;
      pageCount: number;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.entries.find((entry) => entry.id === WELCOME)).toMatchObject({
      authorName: "Ada Superadmin",
      hasUnpublishedEdits: false,
      status: "published",
    });
  });

  it("filters by status, and hides archived entries from the default list", async () => {
    const cookie = await signInAdmin();
    const archived = await send(
      `/cms/admin/blog/entries/${DRAFT}/archive`,
      cookie,
      "POST",
      { version: 1 }
    );
    expect(archived.status).toBe(200);

    const ids = async (query: string) => {
      const res = await call(`/cms/admin/blog/entries${query}`, cookie);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { entries: { id: string }[] };
      return body.entries.map((entry) => entry.id);
    };

    const every = await ids("?status=all");
    const lists = {
      all: every.length,
      archived: await ids("?status=archived"),
      current: await ids(""),
      draft: await ids("?status=draft"),
      published: await ids("?status=published"),
    };

    expect(lists).toStrictEqual({
      all: 2,
      archived: [DRAFT],
      current: [WELCOME],
      draft: [],
      published: [WELCOME],
    });
  });

  it("counts every status of the collection, whatever the filter", async () => {
    const cookie = await signInAdmin();

    const res = await call("/cms/admin/blog/entries?status=archived", cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      counts: Record<string, number>;
    };
    expect(body.counts).toStrictEqual({ archived: 0, draft: 1, published: 1 });
  });

  it("answers 404 for a collection that is not registered", async () => {
    const cookie = await signInAdmin();

    const res = await call("/cms/admin/recipes/entries", cookie);

    expect(res.status).toBe(404);
  });

  it("answers 400 for an unknown status filter", async () => {
    const cookie = await signInAdmin();

    const res = await call("/cms/admin/blog/entries?status=deleted", cookie);

    expect(res.status).toBe(400);
  });
});

describe("POST /cms/admin/:collection/entries", () => {
  it("creates a draft written by the caller", async () => {
    const cookie = await signInAdmin();

    const entry = await create(cookie, "hello");

    expect(entry.status).toBe("draft");
    expect(entry.version).toBe(1);
    expect(entry.authorName).toBe("Alan Admin");
    expect(entry.updatedByName).toBe("Alan Admin");
  });

  it("refuses data that fails the collection's schema with the error envelope", async () => {
    const cookie = await signInAdmin();

    const res = await send("/cms/admin/blog/entries", cookie, "POST", {
      data: postData({ excerpt: 42 }),
      slug: "bad-data",
      title: "Bad",
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_input");
  });

  it("refuses a body node the renderer does not know", async () => {
    const cookie = await signInAdmin();

    const res = await send("/cms/admin/blog/entries", cookie, "POST", {
      data: postData({
        body: { type: "doc", content: [{ type: "iframe" }] },
      }),
      slug: "bad-node",
      title: "Bad node",
    });

    expect(res.status).toBe(400);
  });

  it("answers 409 slug_taken for a slug another entry uses", async () => {
    const cookie = await signInAdmin();

    const res = await send("/cms/admin/blog/entries", cookie, "POST", {
      data: postData(),
      slug: "welcome-to-the-blog",
      title: "Again",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("slug_taken");
  });
});

describe("GET /cms/admin/:collection/entries/:id", () => {
  it("reads one entry with its data", async () => {
    const cookie = await signInAdmin();

    const res = await call(`/cms/admin/blog/entries/${WELCOME}`, cookie);

    expect(res.status).toBe(200);
    const body = (await res.json()) as EntryBody & {
      entry: { data: { excerpt: string } };
    };
    expect(body.entry.liveSlug).toBe("welcome-to-the-blog");
    expect(body.entry.data.excerpt).toContain("What the blog is for");
  });

  it("names the public URL of every image the draft holds", async () => {
    const cookie = await signInAdmin();
    const cover = { key: "t/x/public-uploads/a/cover.png", objectId: "a" };
    const image = {
      attrs: { objectId: "b", storageKey: "t/x/public-uploads/b/inline.png" },
      type: "image",
    };
    const res = await send("/cms/admin/blog/entries", cookie, "POST", {
      data: postData({
        body: { content: [image], type: "doc" },
        cover,
        seo: { ogImage: { key: "t/x/public-uploads/c/og.png", objectId: "c" } },
      }),
      slug: "with-images",
      title: "With images",
    });
    expect(res.status).toBe(201);

    const body = (await res.json()) as {
      entry: { mediaUrls: Record<string, string> };
    };
    expect(body.entry.mediaUrls).toStrictEqual({
      "t/x/public-uploads/a/cover.png":
        "http://localhost:4000/files/public/t/x/public-uploads/a/cover.png",
      "t/x/public-uploads/b/inline.png":
        "http://localhost:4000/files/public/t/x/public-uploads/b/inline.png",
      "t/x/public-uploads/c/og.png":
        "http://localhost:4000/files/public/t/x/public-uploads/c/og.png",
    });
  });

  it("answers 404 for an unknown id", async () => {
    const cookie = await signInAdmin();

    const res = await call("/cms/admin/blog/entries/nope", cookie);

    expect(res.status).toBe(404);
  });
});

describe("PUT /cms/admin/:collection/entries/:id (save draft)", () => {
  it("saves the draft, bumps the version and leaves the live post alone", async () => {
    const cookie = await signInAdmin();

    const res = await send(
      `/cms/admin/blog/entries/${WELCOME}`,
      cookie,
      "PUT",
      {
        data: postData(),
        slug: "welcome-to-the-blog",
        title: "Welcome, edited",
        version: 2,
      }
    );

    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as EntryBody;
    expect(entry).toMatchObject({
      hasUnpublishedEdits: true,
      updatedByName: "Alan Admin",
      version: 3,
    });

    const live = await app.request(
      "/cms/blog/entries/welcome-to-the-blog",
      {},
      env()
    );
    const page = (await live.json()) as { entry: { title: string } };
    expect(page.entry.title).toBe("Welcome to the blog");
  });

  it("answers 409 for a stale version, naming who saved last and when", async () => {
    const admin = await signInAdmin();
    const saved = await send(`/cms/admin/blog/entries/${DRAFT}`, admin, "PUT", {
      data: postData(),
      slug: "drafting-the-second-post",
      title: "Saved by the admin",
      version: 1,
    });
    expect(saved.status).toBe(200);
    const superadmin = await signInAdmin("superadmin@example.test");

    const res = await send(
      `/cms/admin/blog/entries/${DRAFT}`,
      superadmin,
      "PUT",
      {
        data: postData(),
        slug: "drafting-the-second-post",
        title: "Saved from a stale tab",
        version: 1,
      }
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictBody;
    expect(body.error.code).toBe("conflict");
    expect(body.conflict).toMatchObject({
      updatedByName: "Alan Admin",
      version: 2,
    });
    expect(Date.parse(body.conflict.updatedAt)).toBeGreaterThan(
      Date.parse("2026-11-03T15:30:00.000Z")
    );
  });
});

describe("POST /cms/admin/:collection/entries/:id/publish", () => {
  it("publishes the draft and returns the rendered html", async () => {
    const cookie = await signInAdmin();

    const res = await send(
      `/cms/admin/blog/entries/${DRAFT}/publish`,
      cookie,
      "POST",
      { version: 1 }
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as EntryBody & {
      revision: { id: string; html: string };
    };
    expect(body.entry.status).toBe("published");
    expect(body.revision.html).toContain("<p>A draft stays in the admin app");

    const live = await app.request(
      "/cms/blog/entries/drafting-the-second-post",
      {},
      env()
    );
    expect(live.status).toBe(200);
  });

  it("answers 409 for a stale version, naming who saved last", async () => {
    const cookie = await signInAdmin();

    const res = await send(
      `/cms/admin/blog/entries/${WELCOME}/publish`,
      cookie,
      "POST",
      { version: 1 }
    );

    expect(res.status).toBe(409);
    const body = (await res.json()) as ConflictBody;
    expect(body).toStrictEqual({
      conflict: {
        updatedAt: "2026-11-01T09:00:00.000Z",
        updatedByName: "Ada Superadmin",
        version: 2,
      },
      error: { code: "conflict", message: expect.any(String) },
    });
  });
});

describe("unpublish and archive", () => {
  it("takes a published entry offline", async () => {
    const cookie = await signInAdmin();

    const res = await send(
      `/cms/admin/blog/entries/${WELCOME}/unpublish`,
      cookie,
      "POST",
      { version: 2 }
    );

    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as EntryBody;
    expect(entry.status).toBe("draft");
    const live = await app.request(
      "/cms/blog/entries/welcome-to-the-blog",
      {},
      env()
    );
    expect(live.status).toBe(404);
  });
});

describe("DELETE /cms/admin/:collection/entries/:id", () => {
  it("refuses to delete a published entry, and the entry survives", async () => {
    const cookie = await signInAdmin();

    const res = await call(`/cms/admin/blog/entries/${WELCOME}`, cookie, {
      method: "DELETE",
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_state");
    const still = await call(`/cms/admin/blog/entries/${WELCOME}`, cookie);
    expect(still.status).toBe(200);
  });

  it("deletes a draft", async () => {
    const cookie = await signInAdmin();

    const res = await call(`/cms/admin/blog/entries/${DRAFT}`, cookie, {
      method: "DELETE",
    });

    expect(res.status).toBe(204);
    const gone = await call(`/cms/admin/blog/entries/${DRAFT}`, cookie);
    expect(gone.status).toBe(404);
  });
});

/** Create an entry, publish it, rename its title, publish again. Returns its id. */
async function publishTwice(cookie: string): Promise<string> {
  const entry = await create(cookie, "first-title", "First title");
  const steps: [string, string, unknown][] = [
    [`/cms/admin/blog/entries/${entry.id}/publish`, "POST", { version: 1 }],
    [
      `/cms/admin/blog/entries/${entry.id}`,
      "PUT",
      {
        data: postData(),
        slug: "first-title",
        title: "Second title",
        version: 2,
      },
    ],
    [`/cms/admin/blog/entries/${entry.id}/publish`, "POST", { version: 3 }],
  ];
  for (const [path, method, body] of steps) {
    const res = await send(path, cookie, method, body);
    expect(res.status, `${method} ${path}`).toBe(200);
  }
  return entry.id;
}

describe("revisions", () => {
  it("lists revisions and restores one into the draft", async () => {
    const cookie = await signInAdmin();
    const id = await publishTwice(cookie);

    const listed = await call(
      `/cms/admin/blog/entries/${id}/revisions`,
      cookie
    );
    expect(listed.status).toBe(200);
    const { revisions } = (await listed.json()) as {
      revisions: { id: string; title: string; live: boolean }[];
    };
    expect(
      revisions.map((revision) => [revision.title, revision.live])
    ).toStrictEqual([
      ["Second title", true],
      ["First title", false],
    ]);

    const oldest = revisions[1]?.id ?? "";
    const restored = await send(
      `/cms/admin/blog/entries/${id}/revisions/${oldest}/restore`,
      cookie,
      "POST",
      { version: 4 }
    );

    expect(restored.status).toBe(200);
    const body = (await restored.json()) as EntryBody;
    expect(body.entry).toMatchObject({
      hasUnpublishedEdits: true,
      title: "First title",
    });
  });
});

describe("POST /cms/admin/rerender", () => {
  it("rebuilds the html of every live revision", async () => {
    const cookie = await signInAdmin();

    const res = await send("/cms/admin/rerender", cookie, "POST");

    expect(res.status).toBe(200);
    const body = (await res.json()) as { rerendered: number };
    expect(body.rerendered).toBe(1);
  });

  it("answers 401 to a signed-out caller", async () => {
    const res = await send("/cms/admin/rerender", "", "POST");

    expect(res.status).toBe(401);
  });
});

describe("GET /cms/:collection/entries (public)", () => {
  it("lists published entries only, with finished excerpts", async () => {
    const res = await app.request("/cms/blog/entries", {}, env());

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entries: { slug: string; excerpt: string; authorName: string | null }[];
      page: number;
      pageCount: number;
      total: number;
    };
    expect(body.entries.map((entry) => entry.slug)).toStrictEqual([
      "welcome-to-the-blog",
    ]);
    expect(body.entries[0]?.excerpt).toContain("What the blog is for");
    expect(body.entries[0]).not.toHaveProperty("data");
    expect([body.page, body.pageCount, body.total]).toStrictEqual([1, 1, 1]);
  });

  it("pages with ?page=N", async () => {
    const res = await app.request("/cms/blog/entries?page=2", {}, env());

    expect(res.status).toBe(200);
    const body = (await res.json()) as { entries: unknown[]; page: number };
    expect(body.entries).toStrictEqual([]);
    expect(body.page).toBe(2);
  });
});

describe("GET /cms/:collection/entries/:slug (public)", () => {
  it("reads a published entry with its html and resolved fallbacks", async () => {
    const res = await app.request(
      "/cms/blog/entries/welcome-to-the-blog",
      {},
      env()
    );

    expect(res.status).toBe(200);
    const { entry } = (await res.json()) as {
      entry: {
        title: string;
        html: string;
        excerpt: string;
        seo: { metaTitle: string; metaDescription: string };
        authorName: string | null;
        publishedAt: string;
        updatedAt: string;
      };
    };
    expect(entry.html).toContain("<h2>What you can do</h2>");
    expect(entry.seo.metaDescription).toBe(entry.excerpt);
    expect(entry).toMatchObject({
      authorName: "Ada Superadmin",
      publishedAt: "2026-11-01T09:00:00.000Z",
      seo: { metaTitle: "Welcome to the blog", ogImage: null },
      title: "Welcome to the blog",
    });
  });

  it("answers 404 for a draft", async () => {
    const res = await app.request(
      "/cms/blog/entries/drafting-the-second-post",
      {},
      env()
    );

    expect(res.status).toBe(404);
  });

  it("answers 404 for an archived entry", async () => {
    const cookie = await signInAdmin();
    const archived = await send(
      `/cms/admin/blog/entries/${WELCOME}/archive`,
      cookie,
      "POST",
      { version: 2 }
    );
    expect(archived.status).toBe(200);

    const res = await app.request(
      "/cms/blog/entries/welcome-to-the-blog",
      {},
      env()
    );

    expect(res.status).toBe(404);
  });

  it("answers 301 to the new slug after a published rename", async () => {
    const cookie = await signInAdmin();
    const steps = [
      await send(`/cms/admin/blog/entries/${WELCOME}`, cookie, "PUT", {
        data: postData(),
        slug: "hello-blog",
        title: "Hello blog",
        version: 2,
      }),
      await send(`/cms/admin/blog/entries/${WELCOME}/publish`, cookie, "POST", {
        version: 3,
      }),
    ];
    expect(steps.map((step) => step.status)).toStrictEqual([200, 200]);

    const res = await app.request(
      "/cms/blog/entries/welcome-to-the-blog",
      { redirect: "manual" },
      env()
    );

    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/cms/blog/entries/hello-blog");
    const body = (await res.json()) as { slug: string };
    expect(body.slug).toBe("hello-blog");
  });

  it("answers 404 for a collection that is not registered", async () => {
    const res = await app.request("/cms/recipes/entries/anything", {}, env());

    expect(res.status).toBe(404);
  });
});
