// Tests for the collection registry and the field builders. Repo-only: the descriptor ships
// `define.ts` and `fields.ts`, never this file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defineCms, defineCollection } from "./define.ts";
import { media, richText, seo, slug, slugify, text } from "./fields.ts";
import { blogCollection } from "./collections/blog.ts";

const DOC = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Hi" }] }],
};

function pages() {
  return defineCollection({
    name: "pages",
    label: "Pages",
    singular: "Page",
    fields: {
      title: text({ label: "Title", required: true }),
      slug: slug(),
      body: richText({ label: "Body" }),
    },
  });
}

describe("field builders", () => {
  it("text checks required and length", () => {
    const field = text({ label: "Title", required: true, maxLength: 5 });
    assert.equal(field.kind, "text");
    assert.equal(field.schema.safeParse("Hello").success, true);
    assert.equal(field.schema.safeParse("").success, false);
    assert.equal(field.schema.safeParse("Too long").success, false);
    const optional = text({ label: "Note" }).schema;
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the missing value is the case under test
    assert.equal(optional.safeParse(undefined).success, true);
  });

  it("slug accepts lower-case kebab and refuses the rest", () => {
    const field = slug();
    assert.equal(field.kind, "slug");
    assert.equal(field.from, "title");
    assert.equal(field.schema.safeParse("hello-world-2").success, true);
    for (const bad of ["Hello", "hello world", "-a", "a-", "a--b", "", "a/b"]) {
      assert.equal(field.schema.safeParse(bad).success, false, bad);
    }
  });

  it("slugify turns a title into a slug the slug field accepts", () => {
    assert.equal(
      slugify("  Hello, World! Ünïcode — 2026 "),
      "hello-world-unicode-2026"
    );
    assert.equal(
      slug().schema.safeParse(slugify("Ship it: v2.0")).success,
      true
    );
  });

  it("richText accepts a Tiptap doc and refuses anything else", () => {
    const field = richText({ label: "Body", required: true });
    assert.equal(field.schema.safeParse(DOC).success, true);
    assert.equal(field.schema.safeParse("<p>Hi</p>").success, false);
    assert.equal(field.schema.safeParse({ type: "paragraph" }).success, false);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the missing value is the case under test
    assert.equal(field.schema.safeParse(undefined).success, false);
  });

  it("media holds a storage key and alt text, and may be empty when optional", () => {
    const field = media({ label: "Cover" });
    const image = {
      objectId: "o1",
      key: "t/default/public-uploads/o1/a.png",
      alt: "A",
    };
    assert.equal(field.schema.safeParse(image).success, true);
    assert.equal(field.schema.safeParse(null).success, true);
    assert.equal(field.schema.safeParse({ alt: "A" }).success, false);
    assert.equal(
      media({ label: "Cover", required: true }).schema.safeParse(null).success,
      false
    );
  });

  it("seo holds an optional meta title, description and Open Graph image", () => {
    const field = seo();
    assert.equal(field.schema.safeParse({}).success, true);
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the missing value is the case under test
    assert.equal(field.schema.safeParse(undefined).success, true);
    assert.equal(
      field.schema.safeParse({ metaTitle: "x".repeat(71) }).success,
      false
    );
    assert.equal(
      field.schema.safeParse({ metaDescription: "x".repeat(161) }).success,
      false
    );
  });
});

describe("defineCollection", () => {
  it("builds a data schema from every field except title and slug", () => {
    const collection = pages();
    assert.deepEqual(Object.keys(collection.dataSchema.shape), ["body"]);
    assert.equal(collection.dataSchema.safeParse({ body: DOC }).success, true);
  });

  it("refuses unknown keys in data", () => {
    const result = pages().dataSchema.safeParse({ body: DOC, extra: 1 });
    assert.equal(result.success, false);
  });

  it("requires a text title field and a slug field", () => {
    assert.throws(
      () =>
        defineCollection({
          name: "x",
          label: "X",
          singular: "X",
          fields: { slug: slug(), body: richText({ label: "Body" }) },
        } as never),
      /title/
    );
    assert.throws(
      () =>
        defineCollection({
          name: "x",
          label: "X",
          singular: "X",
          fields: { title: text({ label: "Title" }) },
        } as never),
      /slug/
    );
  });

  it("refuses a name that is not lower-case kebab", () => {
    assert.throws(
      () =>
        defineCollection({
          name: "Blog Posts",
          label: "X",
          singular: "X",
          fields: { title: text({ label: "Title" }), slug: slug() },
        }),
      /name/
    );
  });
});

describe("defineCms", () => {
  it("looks a collection up by name", () => {
    const cms = defineCms({ collections: [pages(), blogCollection()] });
    assert.equal(cms.collection("pages").name, "pages");
    assert.equal(cms.has("blog"), true);
    assert.equal(cms.has("nope"), false);
    assert.deepEqual(
      cms.collections.map((collection) => collection.name),
      ["pages", "blog"]
    );
  });

  it("throws on an unknown collection", () => {
    const cms = defineCms({ collections: [pages()] });
    assert.throws(() => cms.collection("nope" as never), /not registered/);
  });

  it("throws on a collection registered twice", () => {
    assert.throws(
      () => defineCms({ collections: [pages(), pages()] }),
      /registered twice/
    );
  });

  it("accepts an empty registry", () => {
    assert.deepEqual(defineCms({ collections: [] }).collections, []);
  });
});

describe("blog collection", () => {
  const blog = blogCollection();

  it("declares title, slug, body, cover, excerpt and seo", () => {
    assert.deepEqual(Object.keys(blog.fields), [
      "title",
      "slug",
      "body",
      "cover",
      "excerpt",
      "seo",
    ]);
  });

  it("accepts a post with only a body", () => {
    assert.equal(blog.dataSchema.safeParse({ body: DOC }).success, true);
  });

  it("refuses a post with no body", () => {
    assert.equal(blog.dataSchema.safeParse({}).success, false);
  });
});
