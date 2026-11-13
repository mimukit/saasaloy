// Tests for the RSS 2.0 and sitemap builders behind /blog/rss.xml and /blog/sitemap.xml.
// Repo-only.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildRss, buildSitemap, escapeXml, rfc822 } from "./feeds.ts";

const CHANNEL = {
  title: "Blog",
  description: "The latest posts.",
  link: "https://example.com/blog",
  feedUrl: "https://example.com/blog/rss.xml",
  language: "en",
};

describe("escapeXml", () => {
  it("escapes the five XML specials", () => {
    assert.equal(
      escapeXml(`a & b < c > d " e ' f`),
      "a &amp; b &lt; c &gt; d &quot; e &apos; f"
    );
  });

  it("drops characters XML 1.0 cannot carry", () => {
    assert.equal(escapeXml("a\u0000b\u0008c\u000Bd\tok\n"), "abcd\tok\n");
  });
});

describe("rfc822", () => {
  it("formats a date as an RFC 822 date in GMT", () => {
    assert.equal(
      rfc822("2026-10-12T09:05:00.000Z"),
      "Mon, 12 Oct 2026 09:05:00 GMT"
    );
  });
});

describe("buildRss", () => {
  const items = [
    {
      title: "Tom & Jerry <3",
      link: "https://example.com/blog/tom",
      description: 'A "quoted" excerpt.',
      pubDate: "2026-10-12T09:00:00.000Z",
    },
    {
      title: "Older",
      link: "https://example.com/blog/older",
      description: "Older post.",
      pubDate: "2026-09-01T00:00:00.000Z",
    },
  ];
  const xml = buildRss({ ...CHANNEL, items });

  it("starts with the XML declaration and an RSS 2.0 root", () => {
    assert.ok(
      xml.startsWith(
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"'
      )
    );
    assert.match(xml, /<\/rss>\n?$/);
  });

  it("carries the required channel elements", () => {
    assert.match(xml, /<channel>\s*<title>Blog<\/title>/);
    assert.match(xml, /<link>https:\/\/example\.com\/blog<\/link>/);
    assert.match(xml, /<description>The latest posts\.<\/description>/);
    assert.match(xml, /<language>en<\/language>/);
  });

  it("links itself with atom:link rel=self", () => {
    assert.match(xml, /xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom"/);
    assert.match(
      xml,
      /<atom:link href="https:\/\/example\.com\/blog\/rss\.xml" rel="self" type="application\/rss\+xml"\/>/
    );
  });

  it("dates the channel from its newest item", () => {
    assert.match(
      xml,
      /<lastBuildDate>Mon, 12 Oct 2026 09:00:00 GMT<\/lastBuildDate>/
    );
  });

  it("writes one escaped item per post with a permalink guid", () => {
    assert.equal(xml.match(/<item>/g)?.length, 2);
    assert.match(xml, /<title>Tom &amp; Jerry &lt;3<\/title>/);
    assert.match(
      xml,
      /<description>A &quot;quoted&quot; excerpt\.<\/description>/
    );
    assert.match(
      xml,
      /<guid isPermaLink="true">https:\/\/example\.com\/blog\/tom<\/guid>/
    );
    assert.match(xml, /<pubDate>Mon, 12 Oct 2026 09:00:00 GMT<\/pubDate>/);
  });

  it("writes a valid empty channel with no lastBuildDate", () => {
    const empty = buildRss({ ...CHANNEL, items: [] });
    assert.doesNotMatch(empty, /<item>/);
    assert.doesNotMatch(empty, /lastBuildDate/);
    assert.match(empty, /<\/channel>/);
  });
});

describe("buildSitemap", () => {
  it("writes a urlset with one url per page, lastmod as a W3C date", () => {
    const xml = buildSitemap([
      { loc: "https://example.com/blog" },
      {
        loc: "https://example.com/blog/a?x=1&y=2",
        lastmod: "2026-10-12T09:00:00.000Z",
      },
    ]);
    assert.ok(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n'));
    assert.match(
      xml,
      /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/
    );
    assert.equal(xml.match(/<url>/g)?.length, 2);
    assert.match(
      xml,
      /<loc>https:\/\/example\.com\/blog\/a\?x=1&amp;y=2<\/loc>/
    );
    assert.match(xml, /<lastmod>2026-10-12T09:00:00\.000Z<\/lastmod>/);
    assert.match(
      xml,
      /<url>\s*<loc>https:\/\/example\.com\/blog<\/loc>\s*<\/url>/
    );
  });
});
