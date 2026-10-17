import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_TENANT,
  hasPublicUrl,
  imageTransformsEnabled,
  publicImageUrl,
  publicUrl,
  resolveTenant,
} from "./file-uploads";

// The four decisions this file makes that nothing else in the module may repeat: which
// tenant a request acts for, whether a public upload is allowed at all, and the two URLs a
// public object is reachable at.

describe("resolveTenant", () => {
  it("returns the active organization when there is one", () => {
    assert.equal(
      resolveTenant({
        session: { id: "s1", activeOrganizationId: "org_123" },
        user: { id: "u1" },
      }),
      "org_123"
    );
  });

  // The `multitenant`-is-absent case, and the reason this needs no dynamic import: the
  // column is declared by `auth` either way and is simply null.
  it("falls back to `default` with no active organization", () => {
    assert.equal(
      resolveTenant({
        session: { id: "s1", activeOrganizationId: null },
        user: { id: "u1" },
      }),
      DEFAULT_TENANT
    );
  });

  it("treats an empty string as no organization", () => {
    assert.equal(
      resolveTenant({
        session: { id: "s1", activeOrganizationId: "" },
        user: { id: "u1" },
      }),
      DEFAULT_TENANT
    );
  });
});

describe("hasPublicUrl", () => {
  it("is false when STORAGE_PUBLIC_URL is unset", () => {
    assert.equal(hasPublicUrl({}), false);
  });

  it("is false when it is empty", () => {
    assert.equal(hasPublicUrl({ STORAGE_PUBLIC_URL: "" }), false);
  });

  it("is true when it holds an origin", () => {
    assert.equal(
      hasPublicUrl({ STORAGE_PUBLIC_URL: "https://files.example.com" }),
      true
    );
  });
});

describe("publicUrl", () => {
  const key = "t/acme/public-uploads/abc/logo.png";

  it("appends the key verbatim", () => {
    assert.equal(
      publicUrl({ STORAGE_PUBLIC_URL: "https://files.example.com" }, key),
      `https://files.example.com/${key}`
    );
  });

  it("does not double the separator on a trailing slash", () => {
    assert.equal(
      publicUrl({ STORAGE_PUBLIC_URL: "https://files.example.com/" }, key),
      `https://files.example.com/${key}`
    );
  });

  it("returns nothing when the origin is unset", () => {
    assert.equal(publicUrl({}, key), undefined);
  });
});

describe("imageTransformsEnabled", () => {
  it("is off by default", () => {
    assert.equal(imageTransformsEnabled({}), false);
  });

  it("reads the string a Worker env actually carries", () => {
    assert.equal(
      imageTransformsEnabled({ STORAGE_IMAGE_TRANSFORMS: "true" }),
      true
    );
  });

  it("refuses anything else", () => {
    assert.equal(
      imageTransformsEnabled({ STORAGE_IMAGE_TRANSFORMS: "yes" }),
      false
    );
  });
});

describe("publicImageUrl", () => {
  const key = "t/acme/public-uploads/abc/logo.png";
  const origin = "https://files.example.com";

  it("returns the plain url with transformations off", () => {
    assert.equal(
      publicImageUrl({ STORAGE_PUBLIC_URL: origin }, key, { width: 96 }),
      `${origin}/${key}`
    );
  });

  it("inserts the cdn-cgi prefix with them on", () => {
    assert.equal(
      publicImageUrl(
        { STORAGE_IMAGE_TRANSFORMS: "true", STORAGE_PUBLIC_URL: origin },
        key,
        { fit: "cover", height: 96, width: 96 }
      ),
      `${origin}/cdn-cgi/image/fit=cover,height=96,width=96/${key}`
    );
  });

  it("returns nothing when there is no public origin to build on", () => {
    assert.equal(
      publicImageUrl({ STORAGE_IMAGE_TRANSFORMS: "true" }, key, { width: 96 }),
      undefined
    );
  });
});
