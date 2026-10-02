import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { imageUrl } from "./public-image";

// The browser half of the image path. Every case here is a URL the block hands an `<img>`,
// so a wrong answer is a broken image on a page rather than a failed request.

describe("imageUrl", () => {
  const url = "https://files.example.com/t/acme/public-uploads/abc/logo.png";

  it("returns the url unchanged when transformations are off", () => {
    assert.equal(imageUrl(url, { height: 96, width: 96 }), url);
  });

  it("ignores its options when transformations are off", () => {
    assert.equal(imageUrl(url, { fit: "cover", width: 4000 }, false), url);
  });

  it("inserts the prefix after the origin when they are on", () => {
    assert.equal(
      imageUrl(url, { fit: "cover", height: 96, width: 96 }, true),
      "https://files.example.com/cdn-cgi/image/fit=cover,height=96,width=96/t/acme/public-uploads/abc/logo.png"
    );
  });

  it("returns the url unchanged when no option was asked for", () => {
    assert.equal(imageUrl(url, {}, true), url);
  });

  it("drops an option that was left undefined", () => {
    assert.equal(
      imageUrl(url, { height: undefined, width: 96 }, true),
      "https://files.example.com/cdn-cgi/image/width=96/t/acme/public-uploads/abc/logo.png"
    );
  });

  // A dev origin may be root-relative, and `new URL` needs a base for that case. This is
  // why the origin is found by hand rather than parsed.
  it("handles a root-relative url", () => {
    assert.equal(
      imageUrl("/t/acme/public-uploads/abc/logo.png", { width: 96 }, true),
      "/cdn-cgi/image/width=96/t/acme/public-uploads/abc/logo.png"
    );
  });
});
