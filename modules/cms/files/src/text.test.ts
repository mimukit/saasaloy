// Tests for the plain-text helpers behind the excerpt and SEO fallbacks. Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { excerptOf, plainText, seoFallbacks } from "./text.ts";

function paragraph(text: string) {
  return { type: "paragraph", content: [{ type: "text", text }] };
}

describe("plainText", () => {
  it("joins block text with spaces and skips images", () => {
    const doc = {
      type: "doc" as const,
      content: [
        {
          type: "heading",
          attrs: { level: 2 },
          content: [{ type: "text", text: "Intro" }],
        },
        paragraph("One"),
        { type: "image", attrs: { storageKey: "k" } },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Two " },
            { type: "text", text: "bold", marks: [{ type: "bold" }] },
          ],
        },
      ],
    };
    assert.equal(plainText(doc), "Intro One Two bold");
  });

  it("returns an empty string for an empty or missing document", () => {
    assert.equal(plainText({ type: "doc" }), "");
    // oxlint-disable-next-line unicorn/no-useless-undefined -- the missing value is the case under test
    assert.equal(plainText(undefined), "");
  });
});

describe("excerptOf", () => {
  const long = "word ".repeat(60).trim();
  const doc = { type: "doc" as const, content: [paragraph(long)] };

  it("uses the manual excerpt when it has text", () => {
    assert.equal(excerptOf({ excerpt: "  Mine  ", body: doc }), "Mine");
  });

  it("falls back to the first 160 characters of the body", () => {
    const result = excerptOf({ excerpt: "", body: doc });
    assert.ok(
      result.length <= 160 && result.length > 150,
      String(result.length)
    );
    assert.ok(result.endsWith("…"));
    assert.ok(long.startsWith(result.slice(0, -1).trimEnd()));
  });

  it("keeps a short body whole", () => {
    assert.equal(
      excerptOf({ body: { type: "doc", content: [paragraph("Short.")] } }),
      "Short."
    );
  });
});

describe("seoFallbacks", () => {
  const cover = { objectId: "o1", key: "k1", alt: "Cover" };

  it("falls back to the title, the excerpt and the cover", () => {
    assert.deepEqual(
      seoFallbacks({ title: "Hello", excerpt: "About it", cover }),
      { metaTitle: "Hello", metaDescription: "About it", ogImage: cover }
    );
  });

  it("prefers the SEO overrides", () => {
    const og = { objectId: "o2", key: "k2" };
    assert.deepEqual(
      seoFallbacks({
        title: "Hello",
        excerpt: "About it",
        cover,
        seo: { metaTitle: "T", metaDescription: "D", ogImage: og },
      }),
      { metaTitle: "T", metaDescription: "D", ogImage: og }
    );
  });

  it("treats blank overrides as empty", () => {
    assert.equal(
      seoFallbacks({ title: "Hello", excerpt: "", seo: { metaTitle: " " } })
        .metaTitle,
      "Hello"
    );
    assert.equal(seoFallbacks({ title: "Hello", excerpt: "" }).ogImage, null);
  });
});
