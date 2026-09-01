// Tests for the two redirect rules in ./redirect.ts. This file is NOT in the descriptor's
// `scaffolds[].files` list, so `add admin` never copies it into a user's project — it
// exists for this repo only.
//
// It runs on `node:test` for the same reason the auth module's env test does: vite has to
// load a tsconfig for every file it transforms, and this payload's tsconfig resolves only
// inside a scaffolded project. Run them with `pnpm test:modules`.
//
// The import needs the explicit `.ts` extension because Node's type stripping resolves the
// real file rather than a bundler's guess. Shipped payload code keeps the extensionless
// style; only this repo-only file differs.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_DESTINATION,
  resolveDestination,
  toInternalPath,
} from "./redirect.ts";

// Stands in for the router: every path under /users is a route, nothing else is.
const knowsUsers = (pathname: string) =>
  pathname === "/" || pathname.startsWith("/users");

describe("toInternalPath", () => {
  it("keeps a plain absolute path", () => {
    assert.equal(toInternalPath("/users"), "/users");
  });

  it("keeps the search and the hash", () => {
    assert.equal(toInternalPath("/users?page=2#row-3"), "/users?page=2#row-3");
  });

  it("drops a value that is not a string", () => {
    // A missing search param arrives as undefined, bound here so the lint rule against a
    // useless literal argument does not fire on it.
    const missing: unknown = undefined;
    assert.equal(toInternalPath(missing), undefined);
    assert.equal(toInternalPath(42), undefined);
    assert.equal(toInternalPath(["/users"]), undefined);
  });

  it("drops a path that does not start with a slash", () => {
    assert.equal(toInternalPath("users"), undefined);
    assert.equal(toInternalPath(""), undefined);
  });

  it("drops an absolute url", () => {
    assert.equal(toInternalPath("https://evil.example/users"), undefined);
    assert.equal(toInternalPath("javascript:alert(1)"), undefined);
  });

  it("drops a protocol-relative path, which points off-origin", () => {
    assert.equal(toInternalPath("//evil.example/users"), undefined);
  });

  it("drops a backslash path, which some browsers read as protocol-relative", () => {
    assert.equal(toInternalPath("/\\evil.example"), undefined);
    assert.equal(toInternalPath("\\\\evil.example"), undefined);
  });

  it("drops a path carrying a control character or whitespace", () => {
    assert.equal(toInternalPath("/\t/evil.example"), undefined);
    assert.equal(toInternalPath("/users /x"), undefined);
    assert.equal(toInternalPath("/users\n"), undefined);
  });
});

describe("resolveDestination", () => {
  it("returns a path the route tree matches", () => {
    assert.equal(resolveDestination("/users", knowsUsers), "/users");
  });

  it("matches on the pathname, keeping the search and the hash", () => {
    assert.equal(
      resolveDestination("/users?page=2#row-3", knowsUsers),
      "/users?page=2#row-3"
    );
  });

  it("falls back when the route tree matches nothing", () => {
    assert.equal(resolveDestination("/nope", knowsUsers), DEFAULT_DESTINATION);
  });

  it("falls back when there is no destination at all", () => {
    assert.equal(
      resolveDestination(undefined, knowsUsers),
      DEFAULT_DESTINATION
    );
  });

  it("falls back on an off-origin destination without asking the route tree", () => {
    assert.equal(
      resolveDestination("//evil.example/users", () => true),
      DEFAULT_DESTINATION
    );
  });

  it("never sends the visitor back to the login screen", () => {
    assert.equal(
      resolveDestination("/login", () => true),
      DEFAULT_DESTINATION
    );
  });
});
