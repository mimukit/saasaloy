// Tests for the web client: the public routes over fetch, behind the 60-second isolate
// cache that also keeps 404s and redirects. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTtlCache } from "./cache.ts";
import { CmsClientError, createCmsClient } from "./client.ts";

const ENTRY = {
  id: "e1",
  title: "Hello",
  slug: "hello",
  excerpt: "An excerpt.",
  cover: null,
  authorName: "Ada",
  publishedAt: "2026-10-12T09:00:00.000Z",
  updatedAt: "2026-10-12T09:00:00.000Z",
  html: "<p>Hi</p>",
  seo: { metaTitle: "Hello", metaDescription: "An excerpt.", ogImage: null },
};

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(answer: (url: string) => Response) {
  const calls: Call[] = [];
  const fetchImpl = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return Promise.resolve(answer(url));
  };
  return { calls, fetch: fetchImpl as typeof fetch };
}

function json(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
) {
  return Response.json(body, { status, headers });
}

function clock() {
  let now = 5_000_000;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function client(answer: (url: string) => Response, time = clock()) {
  const fake = fakeFetch(answer);
  const cms = createCmsClient({
    apiUrl: "http://api.test/",
    fetch: fake.fetch,
    cache: createTtlCache(time.now),
  });
  return { cms, calls: fake.calls, time };
}

describe("createCmsClient().entry", () => {
  it("reads a published entry from the public route", async () => {
    const { cms, calls } = client(() => json({ entry: ENTRY }));
    const found = await cms.entry("blog", "hello");
    assert.deepEqual(found, { kind: "entry", entry: ENTRY });
    assert.equal(calls[0]?.url, "http://api.test/cms/blog/entries/hello");
    assert.equal(calls[0]?.init?.redirect, "manual");
  });

  it("encodes the slug into the path", async () => {
    const { cms, calls } = client(() => json({}, 404));
    await cms.entry("blog", "a b/c");
    assert.equal(calls[0]?.url, "http://api.test/cms/blog/entries/a%20b%2Fc");
  });

  it("answers missing for a 404", async () => {
    const { cms } = client(() => json({ error: { code: "not_found" } }, 404));
    assert.deepEqual(await cms.entry("blog", "draft"), { kind: "missing" });
  });

  it("answers redirect with the body's slug for a 301", async () => {
    const { cms } = client(() =>
      json({ slug: "new-slug" }, 301, {
        location: "/cms/blog/entries/new-slug",
      })
    );
    assert.deepEqual(await cms.entry("blog", "old"), {
      kind: "redirect",
      slug: "new-slug",
    });
  });

  it("falls back to the location header when a 301 has no slug in its body", async () => {
    const { cms } = client(
      () =>
        new Response("", {
          status: 301,
          headers: { location: "/cms/blog/entries/from-header" },
        })
    );
    assert.deepEqual(await cms.entry("blog", "old"), {
      kind: "redirect",
      slug: "from-header",
    });
  });

  it("throws CmsClientError for a 500, and caches nothing", async () => {
    let status = 500;
    const { cms, calls } = client(() =>
      status === 500 ? json({}, 500) : json({ entry: ENTRY })
    );
    await assert.rejects(cms.entry("blog", "hello"), (error: unknown) => {
      assert.ok(error instanceof CmsClientError);
      assert.equal(error.status, 500);
      return true;
    });
    status = 200;
    assert.equal((await cms.entry("blog", "hello")).kind, "entry");
    assert.equal(calls.length, 2);
  });

  it("serves an entry from the cache for 60 seconds, then reads again", async () => {
    const { cms, calls, time } = client(() => json({ entry: ENTRY }));
    await cms.entry("blog", "hello");
    time.advance(59_000);
    await cms.entry("blog", "hello");
    assert.equal(calls.length, 1);
    time.advance(1000);
    await cms.entry("blog", "hello");
    assert.equal(calls.length, 2);
  });

  it("caches a 404", async () => {
    const { cms, calls } = client(() => json({}, 404));
    await cms.entry("blog", "draft");
    await cms.entry("blog", "draft");
    assert.equal(calls.length, 1);
  });

  it("caches a redirect", async () => {
    const { cms, calls } = client(() => json({ slug: "new" }, 301));
    await cms.entry("blog", "old");
    assert.deepEqual(await cms.entry("blog", "old"), {
      kind: "redirect",
      slug: "new",
    });
    assert.equal(calls.length, 1);
  });

  it("keeps two collections apart in the cache", async () => {
    const { cms, calls } = client(() => json({}, 404));
    await cms.entry("blog", "x");
    await cms.entry("news", "x");
    assert.equal(calls.length, 2);
  });
});

describe("createCmsClient().list", () => {
  const PAGE = { entries: [], page: 2, pageCount: 3, total: 25 };

  it("reads a page of the public list", async () => {
    const { cms, calls } = client(() => json(PAGE));
    assert.deepEqual(await cms.list("blog", 2), PAGE);
    assert.equal(calls[0]?.url, "http://api.test/cms/blog/entries?page=2");
  });

  it("caches each page by its number", async () => {
    const { cms, calls } = client(() => json(PAGE));
    await cms.list("blog", 1);
    await cms.list("blog", 1);
    await cms.list("blog", 2);
    assert.equal(calls.length, 2);
  });

  it("throws CmsClientError when the collection is unknown", async () => {
    const { cms } = client(() => json({}, 404));
    await assert.rejects(cms.list("nope", 1), CmsClientError);
  });
});

describe("createCmsClient options", () => {
  it("refuses an empty api URL", () => {
    assert.throws(() => createCmsClient({ apiUrl: "" }), /PUBLIC_API_URL/);
  });
});
