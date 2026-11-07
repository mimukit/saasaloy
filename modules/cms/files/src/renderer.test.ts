// Tests for the publish-time renderer: Tiptap JSON in, HTML out, in plain Node with no DOM.
// Repo-only. The Tiptap packages resolve from this repo's root devDependencies, the same
// exact versions `packages/cms/package.json` pins.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { renderRichText } from "./renderer.ts";

function linkDoc(href: string) {
  return {
    type: "doc" as const,
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Click ", marks: [] },
          {
            type: "text",
            text: "here",
            marks: [{ type: "link", attrs: { href } }],
          },
        ],
      },
    ],
  };
}

const imageUrl = (key: string) => `https://files.example.com/${key}`;

describe("renderRichText", () => {
  it("renders paragraphs, headings and marks", () => {
    const html = renderRichText(
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 2 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "paragraph",
            content: [
              { type: "text", text: "A " },
              { type: "text", text: "bold", marks: [{ type: "bold" }] },
              { type: "text", text: " word" },
            ],
          },
        ],
      },
      { imageUrl }
    );
    assert.equal(html, "<h2>Title</h2><p>A <strong>bold</strong> word</p>");
  });

  it("escapes text", () => {
    const html = renderRichText(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "<script>x</script>" }],
          },
        ],
      },
      { imageUrl }
    );
    assert.equal(html, "<p>&lt;script&gt;x&lt;/script&gt;</p>");
  });

  it("keeps an https link", () => {
    const html = renderRichText(linkDoc("https://example.com/a?b=1&c=2"), {
      imageUrl,
    });
    assert.equal(
      html,
      '<p>Click <a href="https://example.com/a?b=1&amp;c=2" rel="noopener noreferrer">here</a></p>'
    );
  });

  it("keeps a relative link with no rel", () => {
    const html = renderRichText(linkDoc("/blog/other"), { imageUrl });
    assert.equal(html, '<p>Click <a href="/blog/other">here</a></p>');
  });

  it("drops a javascript: link and keeps its text", () => {
    const html = renderRichText(linkDoc("javascript:alert(1)"), { imageUrl });
    assert.equal(html, "<p>Click here</p>");
    assert.doesNotMatch(html, /javascript|<a/i);
  });

  it("drops a data: link hidden behind whitespace and case", () => {
    const html = renderRichText(linkDoc(" DaTa:text/html,<b>x</b>"), {
      imageUrl,
    });
    assert.equal(html, "<p>Click here</p>");
  });

  it("renders a media image through the image URL resolver", () => {
    const html = renderRichText(
      {
        type: "doc",
        content: [
          {
            type: "image",
            attrs: {
              storageKey: "t/default/public-uploads/o1/a b.png",
              alt: 'A "quoted" alt',
            },
          },
        ],
      },
      { imageUrl: (key) => `https://files.example.com/${key}` }
    );
    assert.equal(
      html,
      '<img src="https://files.example.com/t/default/public-uploads/o1/a b.png" alt="A &quot;quoted&quot; alt" loading="lazy">'
    );
  });

  it("drops an image whose URL cannot be built", () => {
    const html = renderRichText(
      { type: "doc", content: [{ type: "image", attrs: { storageKey: "k" } }] },
      // oxlint-disable-next-line unicorn/no-useless-undefined -- the missing value is the case under test
      { imageUrl: () => undefined }
    );
    assert.equal(html, "");
  });

  it("drops an image with a javascript: src and no storage key", () => {
    const html = renderRichText(
      {
        type: "doc",
        content: [{ type: "image", attrs: { src: "javascript:alert(1)" } }],
      },
      { imageUrl }
    );
    assert.equal(html, "");
  });

  it("renders an empty document as an empty string", () => {
    assert.equal(renderRichText({ type: "doc" }, { imageUrl }), "");
  });
});

describe("renderCollectionHtml", () => {
  it("renders the collection's first richText field", async () => {
    const { renderCollectionHtml } = await import("./renderer.ts");
    const { blogCollection } = await import("./collections/blog.ts");
    const html = renderCollectionHtml(
      blogCollection(),
      {
        body: {
          type: "doc",
          content: [
            { type: "paragraph", content: [{ type: "text", text: "Body" }] },
          ],
        },
        excerpt: "Not this",
      },
      { imageUrl }
    );
    assert.equal(html, "<p>Body</p>");
  });

  it("renders an empty string when the field is empty or the collection has none", async () => {
    const { renderCollectionHtml } = await import("./renderer.ts");
    const { blogCollection } = await import("./collections/blog.ts");
    const { defineCollection } = await import("./define.ts");
    const { slug, text } = await import("./fields.ts");
    assert.equal(renderCollectionHtml(blogCollection(), {}, { imageUrl }), "");
    const plain = defineCollection({
      name: "notes",
      label: "Notes",
      singular: "Note",
      fields: { title: text({ label: "Title" }), slug: slug() },
    });
    assert.equal(renderCollectionHtml(plain, {}, { imageUrl }), "");
  });
});
