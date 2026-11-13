// Tests for the link rule both the editor and the renderer apply. Repo-only: the descriptor
// ships `links.ts`, never this file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isSafeHref } from "./links.ts";

describe("isSafeHref", () => {
  it("accepts http, https, mailto and tel", () => {
    for (const href of [
      "http://example.com",
      "https://example.com/a?b=c#d",
      "HTTPS://EXAMPLE.COM",
      "mailto:team@example.com",
      "tel:+8801700000000",
    ]) {
      assert.equal(isSafeHref(href), true, href);
    }
  });

  it("accepts relative URLs", () => {
    for (const href of [
      "/blog/hello",
      "#intro",
      "?page=2",
      "./a",
      "../b",
      "about",
    ]) {
      assert.equal(isSafeHref(href), true, href);
    }
  });

  it("refuses javascript, data, vbscript and file URLs", () => {
    for (const href of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      " javascript:alert(1)",
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      "\u0000javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
    ]) {
      assert.equal(isSafeHref(href), false, JSON.stringify(href));
    }
  });

  it("refuses protocol-relative URLs and empty values", () => {
    for (const href of [
      "//evil.example",
      "/\\evil.example",
      "\\/evil.example",
      "\\\\evil.example",
      "",
      "   ",
      undefined,
      null,
    ]) {
      assert.equal(isSafeHref(href), false, JSON.stringify(href));
    }
  });
});
