import { describe, expect, it } from "vitest";

import {
  DEFAULT_TENANT,
  hasPublicUrl,
  imageTransformsEnabled,
  publicImageUrl,
  publicUrl,
  resolveScope,
  resolveTenant,
} from "./file-uploads";

// The four decisions this file makes that nothing else in the module may repeat: which
// tenant a request acts for, whether a public upload is allowed at all, and the two URLs a
// public object is reachable at.

describe(resolveTenant, () => {
  it("returns the active organization when there is one", () => {
    expect(
      resolveTenant({
        session: { id: "s1", activeOrganizationId: "org_123" },
        user: { id: "u1" },
      })
    ).toBe("org_123");
  });

  // The `multitenant`-is-absent case, and the reason this needs no dynamic import: the
  // column is declared by `auth` either way and is simply null.
  it("falls back to `default` with no active organization", () => {
    expect(
      resolveTenant({
        session: { id: "s1", activeOrganizationId: null },
        user: { id: "u1" },
      })
    ).toBe(DEFAULT_TENANT);
  });

  it("treats an empty string as no organization", () => {
    expect(
      resolveTenant({
        session: { id: "s1", activeOrganizationId: "" },
        user: { id: "u1" },
      })
    ).toBe(DEFAULT_TENANT);
  });
});

describe(resolveScope, () => {
  it("scopes to the organization alone when one is active", () => {
    expect(
      resolveScope({
        session: { id: "s1", activeOrganizationId: "org_123" },
        user: { id: "u1" },
      })
    ).toStrictEqual({ tenantId: "org_123" });
  });

  // With no organization every user shares `default`, so the owner is what separates them.
  it("scopes to the session user under `default` with no organization", () => {
    expect(
      resolveScope({
        session: { id: "s1", activeOrganizationId: null },
        user: { id: "u1" },
      })
    ).toStrictEqual({ ownerId: "u1", tenantId: DEFAULT_TENANT });
  });
});

describe(hasPublicUrl, () => {
  it("is false when STORAGE_PUBLIC_URL is unset", () => {
    expect(hasPublicUrl({})).toBeFalsy();
  });

  it("is false when it is empty", () => {
    expect(hasPublicUrl({ STORAGE_PUBLIC_URL: "" })).toBeFalsy();
  });

  it("is true when it holds an origin", () => {
    expect(
      hasPublicUrl({ STORAGE_PUBLIC_URL: "https://files.example.com" })
    ).toBeTruthy();
  });
});

describe(publicUrl, () => {
  const key = "t/acme/public-uploads/abc/logo.png";

  it("appends the key verbatim", () => {
    expect(
      publicUrl({ STORAGE_PUBLIC_URL: "https://files.example.com" }, key)
    ).toBe(`https://files.example.com/${key}`);
  });

  it("does not double the separator on a trailing slash", () => {
    expect(
      publicUrl({ STORAGE_PUBLIC_URL: "https://files.example.com/" }, key)
    ).toBe(`https://files.example.com/${key}`);
  });

  it("returns nothing when the origin is unset", () => {
    expect(publicUrl({}, key)).toBeUndefined();
  });
});

describe(imageTransformsEnabled, () => {
  it("is off by default", () => {
    expect(imageTransformsEnabled({})).toBeFalsy();
  });

  it("reads the string a Worker env actually carries", () => {
    expect(
      imageTransformsEnabled({ STORAGE_IMAGE_TRANSFORMS: "true" })
    ).toBeTruthy();
  });

  it("refuses anything else", () => {
    expect(
      imageTransformsEnabled({ STORAGE_IMAGE_TRANSFORMS: "yes" })
    ).toBeFalsy();
  });
});

describe(publicImageUrl, () => {
  const key = "t/acme/public-uploads/abc/logo.png";
  const origin = "https://files.example.com";

  it("returns the plain url with transformations off", () => {
    expect(
      publicImageUrl({ STORAGE_PUBLIC_URL: origin }, key, { width: 96 })
    ).toBe(`${origin}/${key}`);
  });

  it("inserts the cdn-cgi prefix with them on", () => {
    expect(
      publicImageUrl(
        { STORAGE_IMAGE_TRANSFORMS: "true", STORAGE_PUBLIC_URL: origin },
        key,
        { fit: "cover", height: 96, width: 96 }
      )
    ).toBe(`${origin}/cdn-cgi/image/fit=cover,height=96,width=96/${key}`);
  });

  it("returns nothing when there is no public origin to build on", () => {
    expect(
      publicImageUrl({ STORAGE_IMAGE_TRANSFORMS: "true" }, key, { width: 96 })
    ).toBeUndefined();
  });
});
