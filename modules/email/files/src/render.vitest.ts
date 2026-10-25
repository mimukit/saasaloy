// Tests for the two security-relevant halves of ./render.ts: the escaping the `html`
// tag applies to every interpolation, and the scheme check `safeUrl` runs before a value
// reaches an `href`. It ships as `render.test.ts` when testing is on, and
// `pnpm test:modules` runs it in place on Vitest in the saasaloy repo.

import { describe, expect, it } from "vitest";
import { html, raw, safeUrl } from "./render";

describe("html — escaping", () => {
  it("neutralises markup in an interpolated value", () => {
    const name = "<script>alert(1)</script>";
    const out = html`<p>Hi ${name}</p>`.value;
    expect(!out.includes("<script>")).toBeTruthy();
    expect(out.includes("&lt;script&gt;")).toBeTruthy();
  });

  it("escapes the quote characters that would close an attribute", () => {
    const out = html`<a title="${`say "hi" it's me`}">x</a>`.value;
    expect(!out.includes('title=""say')).toBeTruthy();
    expect(out.includes("&quot;")).toBeTruthy();
    expect(out.includes("&#39;")).toBeTruthy();
  });

  // An unquoted attribute is the position escaping usually forgets: a space, a backtick
  // or an `=` ends the value there, so a value carrying one grafts a second attacker-
  // chosen attribute onto the tag.
  it("escapes space, backtick and equals, so an unquoted attribute cannot be extended", () => {
    const out = html`<a href=${`x onmouseover=alert\`1\``}>x</a>`.value;
    expect(!out.includes(" onmouseover")).toBeTruthy();
    expect(out.includes("&#32;")).toBeTruthy();
    expect(out.includes("&#61;")).toBeTruthy();
    expect(out.includes("&#96;")).toBeTruthy();
  });

  it("escapes the ampersand first, so an entity cannot be smuggled in", () => {
    expect(html`${"&lt;b&gt;"}`.value).toBe("&amp;lt;b&amp;gt;");
  });

  it("leaves a SafeHtml fragment alone, so fragments compose", () => {
    const fragment = html`<b>bold</b>`;
    expect(html`<p>${fragment}</p>`.value).toBe("<p><b>bold</b></p>");
  });

  it("passes a raw() value through untouched", () => {
    expect(html`${raw("<hr>")}`.value).toBe("<hr>");
  });

  it("drops null, undefined and false, and escapes everything else", () => {
    expect(html`${null}${undefined}${false}`.value).toBe("");
    expect(html`${0}`.value).toBe("0");
    expect(html`${["<a>", "<b>"]}`.value).toBe("&lt;a&gt;&lt;b&gt;");
  });
});

describe(safeUrl, () => {
  it("returns an https URL unchanged", () => {
    expect(safeUrl("https://app.example.com/verify?token=abc")).toBe(
      "https://app.example.com/verify?token=abc"
    );
  });

  // Escaping cannot help here: `javascript:alert(1)` contains no character the `html`
  // tag touches, so the scheme has to be checked on its own.
  it("refuses a javascript: URL", () => {
    // oxlint-disable-next-line no-script-url -- the test proves safeUrl refuses this scheme
    expect(() => safeUrl("javascript:alert(document.cookie)")).toThrow(
      /must use https/
    );
  });

  it("refuses a data: URL", () => {
    expect(() => safeUrl("data:text/html,<script>alert(1)</script>")).toThrow(
      /must use https/
    );
  });

  it("refuses plain http on a public host", () => {
    expect(() => safeUrl("http://app.example.com")).toThrow(/must use https/);
  });

  it("accepts http on a loopback host, which is the local dev CTA", () => {
    for (const url of [
      "http://localhost:4321/verify",
      "http://127.0.0.1:4321/verify",
      "http://[::1]:4321/verify",
    ]) {
      expect(safeUrl(url)).toBe(url);
    }
  });

  it("refuses a relative URL, which an inbox has nothing to resolve against", () => {
    expect(() => safeUrl("/verify?token=abc")).toThrow(/not an absolute URL/);
  });
});
