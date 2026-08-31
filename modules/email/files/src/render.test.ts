// Tests for the two security-relevant halves of ./render.ts: the escaping the `html`
// tag applies to every interpolation, and the scheme check `safeUrl` runs before a value
// reaches an `href`. This file is NOT in the descriptor's `files`/`scaffolds[].files`
// list, so `add email` never copies it into a user's project — it exists for this repo
// only.
//
// It runs on `node:test`, not on the CLI's vitest instance, and the reason is mechanical:
// vite has to load a tsconfig for every file it transforms, the payload's own
// `modules/email/files/tsconfig.json` extends `@repo/tsconfig/base.json`, and that package
// resolves only inside a scaffolded project. Vitest therefore fails the file with
// TSCONFIG_ERROR before a single assertion runs. Node 24 strips the types with no tsconfig
// at all. Run them with `pnpm test:modules`; `pnpm test` runs that after the turbo pass.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess. Shipped payload code keeps the extensionless
// style the rest of the modules use; only this repo-only file differs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { html, raw, safeUrl } from "./render.ts";

describe("html — escaping", () => {
  it("neutralises markup in an interpolated value", () => {
    const name = "<script>alert(1)</script>";
    const out = html`<p>Hi ${name}</p>`.value;
    assert.ok(!out.includes("<script>"));
    assert.ok(out.includes("&lt;script&gt;"));
  });

  it("escapes the quote characters that would close an attribute", () => {
    const out = html`<a title="${`say "hi" it's me`}">x</a>`.value;
    assert.ok(!out.includes('title=""say'));
    assert.ok(out.includes("&quot;"));
    assert.ok(out.includes("&#39;"));
  });

  // An unquoted attribute is the position escaping usually forgets: a space, a backtick
  // or an `=` ends the value there, so a value carrying one grafts a second attacker-
  // chosen attribute onto the tag.
  it("escapes space, backtick and equals, so an unquoted attribute cannot be extended", () => {
    const out = html`<a href=${`x onmouseover=alert\`1\``}>x</a>`.value;
    assert.ok(!out.includes(" onmouseover"));
    assert.ok(out.includes("&#32;"));
    assert.ok(out.includes("&#61;"));
    assert.ok(out.includes("&#96;"));
  });

  it("escapes the ampersand first, so an entity cannot be smuggled in", () => {
    assert.equal(html`${"&lt;b&gt;"}`.value, "&amp;lt;b&amp;gt;");
  });

  it("leaves a SafeHtml fragment alone, so fragments compose", () => {
    const fragment = html`<b>bold</b>`;
    assert.equal(html`<p>${fragment}</p>`.value, "<p><b>bold</b></p>");
  });

  it("passes a raw() value through untouched", () => {
    assert.equal(html`${raw("<hr>")}`.value, "<hr>");
  });

  it("drops null, undefined and false, and escapes everything else", () => {
    assert.equal(html`${null}${undefined}${false}`.value, "");
    assert.equal(html`${0}`.value, "0");
    assert.equal(html`${["<a>", "<b>"]}`.value, "&lt;a&gt;&lt;b&gt;");
  });
});

describe("safeUrl", () => {
  it("returns an https URL unchanged", () => {
    assert.equal(
      safeUrl("https://app.example.com/verify?token=abc"),
      "https://app.example.com/verify?token=abc"
    );
  });

  // Escaping cannot help here: `javascript:alert(1)` contains no character the `html`
  // tag touches, so the scheme has to be checked on its own.
  it("refuses a javascript: URL", () => {
    assert.throws(
      () => safeUrl("javascript:alert(document.cookie)"),
      /must use https/
    );
  });

  it("refuses a data: URL", () => {
    assert.throws(
      () => safeUrl("data:text/html,<script>alert(1)</script>"),
      /must use https/
    );
  });

  it("refuses plain http on a public host", () => {
    assert.throws(() => safeUrl("http://app.example.com"), /must use https/);
  });

  it("accepts http on a loopback host, which is the local dev CTA", () => {
    for (const url of [
      "http://localhost:4321/verify",
      "http://127.0.0.1:4321/verify",
      "http://[::1]:4321/verify",
    ]) {
      assert.equal(safeUrl(url), url);
    }
  });

  it("refuses a relative URL, which an inbox has nothing to resolve against", () => {
    assert.throws(() => safeUrl("/verify?token=abc"), /not an absolute URL/);
  });
});
