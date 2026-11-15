// Tests for the rules the public blog pages share: dates, the "Updated" line, the page
// number, the pager and the meta tags. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatPostDate,
  pageMeta,
  pagination,
  parsePageParam,
  postPath,
  showUpdated,
} from "./public-page.ts";

describe("formatPostDate", () => {
  it("writes the day, the month name and the year", () => {
    assert.equal(formatPostDate("2026-10-12T09:00:00.000Z"), "12 October 2026");
  });

  it("reads the date in UTC, so a late-evening publish keeps its day", () => {
    assert.equal(formatPostDate("2026-10-12T23:30:00.000Z"), "12 October 2026");
  });
});

describe("showUpdated", () => {
  it("hides the line when the live revision is the first publish", () => {
    assert.equal(
      showUpdated("2026-10-12T09:00:00.000Z", "2026-10-12T09:00:00.120Z"),
      false
    );
  });

  it("hides the line for a republish on the same day", () => {
    assert.equal(
      showUpdated("2026-10-12T09:00:00.000Z", "2026-10-12T17:00:00.000Z"),
      false
    );
  });

  it("shows the line when the live revision is from a later day", () => {
    assert.equal(
      showUpdated("2026-10-12T09:00:00.000Z", "2026-11-05T08:00:00.000Z"),
      true
    );
  });
});

describe("parsePageParam", () => {
  it("reads no parameter as page 1", () => {
    assert.equal(parsePageParam(null), 1);
  });

  it("reads a positive whole number", () => {
    assert.equal(parsePageParam("3"), 3);
  });

  it("refuses zero, negatives, decimals, padding and words", () => {
    for (const raw of ["0", "-1", "1.5", "01", " 2", "two", ""]) {
      assert.equal(parsePageParam(raw), undefined, raw);
    }
  });
});

describe("postPath", () => {
  it("joins the base path and the encoded slug", () => {
    assert.equal(postPath("/blog", "hello-world"), "/blog/hello-world");
    assert.equal(postPath("/blog/", "a b"), "/blog/a%20b");
  });
});

describe("pagination", () => {
  it("is absent with one page", () => {
    assert.equal(
      pagination({ basePath: "/blog", page: 1, pageCount: 1 }),
      null
    );
  });

  it("offers Older only on the first page", () => {
    assert.deepEqual(pagination({ basePath: "/blog", page: 1, pageCount: 3 }), {
      label: "Page 1 of 3",
      newer: null,
      older: "/blog?page=2",
    });
  });

  it("points Newer at the bare base path from page 2", () => {
    assert.deepEqual(pagination({ basePath: "/blog", page: 2, pageCount: 3 }), {
      label: "Page 2 of 3",
      newer: "/blog",
      older: "/blog?page=3",
    });
  });

  it("offers Newer only on the last page", () => {
    assert.deepEqual(pagination({ basePath: "/blog", page: 3, pageCount: 3 }), {
      label: "Page 3 of 3",
      newer: "/blog?page=2",
      older: null,
    });
  });
});

describe("pageMeta", () => {
  const entry = {
    title: "Hello",
    excerpt: "An excerpt.",
    seo: { metaTitle: "Hello", metaDescription: "An excerpt.", ogImage: null },
  };

  it("uses the api's resolved SEO strings", () => {
    assert.deepEqual(
      pageMeta(
        {
          ...entry,
          seo: {
            metaTitle: "Custom",
            metaDescription: "Custom description",
            ogImage: { objectId: "o", key: "k", url: "https://cdn.test/k.png" },
          },
        },
        "https://example.com"
      ),
      {
        title: "Custom",
        description: "Custom description",
        image: "https://cdn.test/k.png",
      }
    );
  });

  it("falls back to the title and the excerpt when the SEO strings are blank", () => {
    assert.deepEqual(
      pageMeta(
        {
          ...entry,
          seo: { metaTitle: " ", metaDescription: "", ogImage: null },
        },
        "https://example.com"
      ),
      { title: "Hello", description: "An excerpt.", image: null }
    );
  });

  it("makes a relative image URL absolute against the site", () => {
    const meta = pageMeta(
      {
        ...entry,
        seo: {
          ...entry.seo,
          ogImage: { objectId: "o", key: "k", url: "/files/public/k.png" },
        },
      },
      "https://example.com"
    );
    assert.equal(meta.image, "https://example.com/files/public/k.png");
  });

  it("has no image when the image has no URL", () => {
    const meta = pageMeta(
      {
        ...entry,
        seo: { ...entry.seo, ogImage: { objectId: "o", key: "k", url: null } },
      },
      "https://example.com"
    );
    assert.equal(meta.image, null);
  });
});
