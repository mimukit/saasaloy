// Tests for the two redirect rules in ./redirect.ts. `add app` ships this file as
// `redirect.test.ts` when the project's testing mode is on. In the saasaloy repo
// `pnpm test:modules` runs it in place on Vitest, and its import resolves by the project
// path, as it would in a project.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_DESTINATION,
  resolveDestination,
  toInternalPath,
} from "./redirect";

// Stands in for the router: every path under /users is a route, nothing else is.
const knowsUsers = (pathname: string) =>
  pathname === "/" || pathname.startsWith("/users");

describe(toInternalPath, () => {
  it("keeps a plain absolute path", () => {
    expect(toInternalPath("/users")).toBe("/users");
  });

  it("keeps the search and the hash", () => {
    expect(toInternalPath("/users?page=2#row-3")).toBe("/users?page=2#row-3");
  });

  it("drops a value that is not a string", () => {
    // A missing search param arrives as undefined, bound here so the lint rule against a
    // useless literal argument does not fire on it.
    const missing: unknown = undefined;
    expect(toInternalPath(missing)).toBeUndefined();
    expect(toInternalPath(42)).toBeUndefined();
    expect(toInternalPath(["/users"])).toBeUndefined();
  });

  it("drops a path that does not start with a slash", () => {
    expect(toInternalPath("users")).toBeUndefined();
    expect(toInternalPath("")).toBeUndefined();
  });

  it("drops an absolute url", () => {
    expect(toInternalPath("https://evil.example/users")).toBeUndefined();
    // oxlint-disable-next-line no-script-url -- the test proves a javascript: url is refused
    expect(toInternalPath("javascript:alert(1)")).toBeUndefined();
  });

  it("drops a protocol-relative path, which points off-origin", () => {
    expect(toInternalPath("//evil.example/users")).toBeUndefined();
  });

  it("drops a backslash path, which some browsers read as protocol-relative", () => {
    expect(toInternalPath("/\\evil.example")).toBeUndefined();
    expect(toInternalPath("\\\\evil.example")).toBeUndefined();
  });

  it("drops a path carrying a control character or whitespace", () => {
    expect(toInternalPath("/\t/evil.example")).toBeUndefined();
    expect(toInternalPath("/users /x")).toBeUndefined();
    expect(toInternalPath("/users\n")).toBeUndefined();
  });
});

describe(resolveDestination, () => {
  it("returns a path the route tree matches", () => {
    expect(resolveDestination("/users", knowsUsers)).toBe("/users");
  });

  it("matches on the pathname, keeping the search and the hash", () => {
    expect(resolveDestination("/users?page=2#row-3", knowsUsers)).toBe(
      "/users?page=2#row-3"
    );
  });

  it("falls back when the route tree matches nothing", () => {
    expect(resolveDestination("/nope", knowsUsers)).toBe(DEFAULT_DESTINATION);
  });

  it("falls back when there is no destination at all", () => {
    expect(resolveDestination(undefined, knowsUsers)).toBe(DEFAULT_DESTINATION);
  });

  it("falls back on an off-origin destination without asking the route tree", () => {
    expect(resolveDestination("//evil.example/users", () => true)).toBe(
      DEFAULT_DESTINATION
    );
  });

  it("never sends the visitor back to the sign-in screen", () => {
    expect(resolveDestination("/sign-in", () => true)).toBe(
      DEFAULT_DESTINATION
    );
  });

  it("never sends the visitor back to the sign-up screen", () => {
    expect(resolveDestination("/sign-up?redirect=/", () => true)).toBe(
      DEFAULT_DESTINATION
    );
  });
});
