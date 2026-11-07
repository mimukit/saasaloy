// Tests for ./form.ts, the rules that turn a collection definition into the editor
// form. Repo-only: the descriptor ships `form.ts`, never this file. The collections
// are built with the real builders.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blogCollection } from "./collections/blog.ts";
import { defineCollection } from "./define.ts";
import { media, richText, slug, text } from "./fields.ts";
import {
  emptyValues,
  formLayout,
  isDirty,
  nextSlug,
  seoPlaceholders,
  slugPrefix,
  toPayload,
  valuesFromEntry,
} from "./form.ts";

const blog = blogCollection();

function products() {
  return defineCollection({
    fields: {
      title: text({ label: "Name", required: true }),
      slug: slug(),
      summary: text({ label: "Summary", multiline: true, placement: "side" }),
      description: richText({ label: "Description" }),
      photo: media({ label: "Photo", placement: "main" }),
    },
    label: "Products",
    name: "products",
    singular: "Product",
  });
}

describe("formLayout", () => {
  it("puts the blog's title, slug and body in the main column", () => {
    const { main } = formLayout(blog);
    assert.deepEqual(
      main.map((entry) => entry.key),
      ["title", "slug", "body"]
    );
  });

  it("puts the blog's cover, excerpt and SEO in the side column, in order", () => {
    const { side } = formLayout(blog);
    assert.deepEqual(
      side.map((entry) => entry.key),
      ["cover", "excerpt", "seo"]
    );
  });

  it("follows a field's placement over its kind's default", () => {
    const layout = formLayout(products());
    assert.deepEqual(
      layout.main.map((entry) => entry.key),
      ["title", "slug", "description", "photo"]
    );
    assert.deepEqual(
      layout.side.map((entry) => entry.key),
      ["summary"]
    );
  });
});

describe("emptyValues", () => {
  it("gives each field kind its empty value", () => {
    assert.deepEqual(emptyValues(blog), {
      data: {
        body: { content: [{ type: "paragraph" }], type: "doc" },
        cover: null,
        excerpt: "",
        seo: {},
      },
      slug: "",
      title: "",
    });
  });

  it("passes the collection's data schema once a title is set", () => {
    const values = emptyValues(blog);
    const payload = toPayload(blog, { ...values, slug: "hi", title: "Hi" });
    assert.equal(blog.dataSchema.safeParse(payload.data).success, true);
  });
});

describe("valuesFromEntry", () => {
  it("fills gaps in stored data with the empty values", () => {
    const values = valuesFromEntry(blog, {
      data: { body: { content: [], type: "doc" } },
      slug: "a",
      title: "A",
    });
    assert.equal(values.data.excerpt, "");
    assert.equal(values.data.cover, null);
    assert.deepEqual(values.data.seo, {});
    assert.deepEqual(values.data.body, { content: [], type: "doc" });
  });

  it("drops a key the collection no longer declares", () => {
    const values = valuesFromEntry(blog, {
      data: { gone: 1 },
      slug: "a",
      title: "A",
    });
    assert.equal("gone" in values.data, false);
  });
});

describe("toPayload", () => {
  it("trims the title and leaves out an empty optional text", () => {
    const values = emptyValues(blog);
    const payload = toPayload(blog, {
      ...values,
      data: { ...values.data, excerpt: "   " },
      slug: "hi",
      title: "  Hi  ",
    });
    assert.equal(payload.title, "Hi");
    assert.equal("excerpt" in payload.data, false);
  });

  it("leaves out empty SEO strings but keeps the ones set", () => {
    const values = emptyValues(blog);
    const payload = toPayload(blog, {
      ...values,
      data: {
        ...values.data,
        seo: { metaDescription: "", metaTitle: " Short " },
      },
      slug: "hi",
      title: "Hi",
    });
    assert.deepEqual(payload.data.seo, { metaTitle: "Short" });
  });

  it("keeps a removed image as null", () => {
    const payload = toPayload(blog, {
      ...emptyValues(blog),
      slug: "a",
      title: "A",
    });
    assert.equal(payload.data.cover, null);
  });
});

describe("isDirty", () => {
  it("ignores key order and whitespace a save would trim", () => {
    const values = { ...emptyValues(blog), slug: "a", title: "A" };
    const same = {
      ...values,
      data: { seo: {}, excerpt: "", cover: null, body: values.data.body },
      title: "A ",
    };
    assert.equal(isDirty(blog, values, same), false);
  });

  it("sees a changed field", () => {
    const values = { ...emptyValues(blog), slug: "a", title: "A" };
    assert.equal(
      isDirty(blog, values, {
        ...values,
        data: { ...values.data, excerpt: "New" },
      }),
      true
    );
  });
});

describe("nextSlug", () => {
  it("follows the title while the slug is empty", () => {
    assert.equal(
      nextSlug({ previousTitle: "", slug: "", title: "Hello there" }),
      "hello-there"
    );
  });

  it("follows the title while the slug still matches the old title", () => {
    assert.equal(
      nextSlug({ previousTitle: "Hello", slug: "hello", title: "Hello world" }),
      "hello-world"
    );
  });

  it("keeps a slug the admin typed", () => {
    assert.equal(
      nextSlug({
        previousTitle: "Hello",
        slug: "custom",
        title: "Hello world",
      }),
      "custom"
    );
  });
});

describe("slugPrefix", () => {
  it("uses the configured base path for the blog", () => {
    assert.equal(slugPrefix("blog", "/blog"), "/blog/");
    assert.equal(slugPrefix("blog", "/news/"), "/news/");
  });

  it("uses the collection name for any other collection", () => {
    assert.equal(slugPrefix("products", "/blog"), "/products/");
  });
});

describe("seoPlaceholders", () => {
  it("shows the title and the excerpt as the fallbacks", () => {
    const values = emptyValues(blog);
    assert.deepEqual(
      seoPlaceholders({
        ...values,
        data: { ...values.data, excerpt: "A short summary." },
        title: "Hello",
      }),
      { metaDescription: "A short summary.", metaTitle: "Hello" }
    );
  });

  it("says what fills an empty description when there is no excerpt", () => {
    assert.deepEqual(seoPlaceholders({ ...emptyValues(blog), title: "" }), {
      metaDescription: "Uses the excerpt when empty.",
      metaTitle: "Uses the title when empty.",
    });
  });
});
