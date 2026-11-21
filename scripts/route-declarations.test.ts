// Guards the agent statement on every api route a module ships (issue #348, plan 0110).
// Each route states, with one `declare({...})` link from `apps/api/src/contract.ts`,
// whether agents may call it, and the `agent` module builds its OpenAPI document and its
// MCP tools from those statements. A route with no statement is a decision nobody took,
// so this test goes red on it before the module ships.
//
// The rules it holds:
//
// - every method link on a mounted route chain carries exactly one `declare(...)`;
// - a statement names the route (snake_case, unique across every module) and says
//   `callable: true` or `callable: false`;
// - a closed route gives its `reason`, and a callable one gives its `output` schema,
//   both marks, `readOnly` and `confirm`, and its `scope`: a `resource:action` word, or
//   `null` for a public read that demands no key;
// - admin, auth and payment callback routes are never callable (plan 0110, "Shipped
//   module routes");
// - the product reads the plan names, the notification list and the public CMS pages,
//   are callable and read only.
//
// The files are read as text by `route-declarations.ts`. Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  fullPath,
  mountedChains,
  routeLinks,
  stripComments,
} from "./route-declarations.ts";
import type { MountedChain, RouteLink } from "./route-declarations.ts";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface Route extends RouteLink {
  chain: MountedChain;
  full: string;
}

const chains = mountedChains(ROOT);
const routes: Route[] = chains.flatMap((chain) =>
  routeLinks(
    readFileSync(join(ROOT, chain.file), "utf-8"),
    chain.exportName
  ).map((link) => ({ ...link, chain, full: fullPath(chain.mount, link.path) }))
);

function where(route: Route): string {
  return `${route.chain.file}:${String(route.line)} (${route.method.toUpperCase()} ${route.full})`;
}

/** Admin, auth and payment callback routes stay closed to agents. */
function mustBeClosed(route: Route): boolean {
  const segments = route.full.split("/");
  return (
    segments.includes("admin") ||
    segments.includes("callback") ||
    route.chain.module === "auth"
  );
}

function find(method: string, full: string): Route {
  const found = routes.find((r) => r.method === method && r.full === full);
  assert.ok(found, `no shipped route ${method.toUpperCase()} ${full}`);
  return found;
}

describe("the route reader", () => {
  it("reads every link of a chain, and a link with no declare has no statement", () => {
    const source = `
      import { Hono } from "hono";
      // .get("/commented", declare({ name: "x", agent: { callable: false } }))
      export const things = new Hono<{ Bindings: { A: string } }>()
        .get("/", declare({ name: "things_list", description: "List.", output: list,
          agent: { callable: true, readOnly: true, confirm: false, scope: "things:read" } }), (c) => c.json([], 200))
        .post("/", validate, (c) => c.json({ ok: /a,(b/.test("x") }, 201))
        .on(["GET", "POST"], "/*", declare({ name: "things_auth", description: "Auth.",
          agent: { callable: false, reason: "Sign-in." } }), (c) => c.text(\`\${"a"})\`));
    `;
    const links = routeLinks(source, "things");
    assert.deepEqual(
      links.map((l) => [l.method, l.path, l.statements.length]),
      [
        ["get", "/", 1],
        ["post", "/", 0],
        ["on", "/*", 1],
      ]
    );
    assert.deepEqual(links[0]?.statements[0], {
      callable: true,
      confirm: false,
      hasOutput: true,
      hasReason: false,
      name: "things_list",
      readOnly: true,
      scope: "things:read",
    });
    assert.equal(links[2]?.statements[0]?.hasReason, true);
  });

  it("keeps offsets when it blanks comments", () => {
    const source = 'a // b\n/* c\nd */ "// e"';
    const stripped = stripComments(source);
    assert.equal(stripped.length, source.length);
    assert.equal(stripped.split("\n").length, 3);
    assert.ok(stripped.includes('"// e"'));
    assert.ok(!stripped.includes("c"));
  });

  it("joins a mount and a link path", () => {
    assert.equal(fullPath("/notifications", "/"), "/notifications");
    assert.equal(
      fullPath("/cms", "/:collection/entries"),
      "/cms/:collection/entries"
    );
  });
});

describe("every shipped api route states whether agents may call it", () => {
  it("finds the mounted route files", () => {
    // 23 route-table rows in 17 modules: the 21 of plan 0110 phase 3, the agent module's
    // own surface, and api's own /health.
    assert.equal(chains.length, 23);
    assert.equal(new Set(chains.map((c) => c.module)).size, 17);
    assert.ok(routes.length > 100, `only ${String(routes.length)} routes read`);
  });

  it("gives every route exactly one declare(...) link", () => {
    const missing = routes
      .filter((r) => r.statements.length !== 1)
      .map((r) => `${where(r)}: ${String(r.statements.length)} statements`);
    assert.deepEqual(missing, []);
  });

  it("names every route once, in snake_case", () => {
    const seen = new Map<string, string>();
    const problems: string[] = [];
    for (const route of routes) {
      const name = route.statements[0]?.name;
      if (name === undefined || !/^[a-z][a-z0-9]*(?:_[a-z0-9]+)*$/.test(name)) {
        problems.push(`${where(route)}: name ${String(name)}`);
        continue;
      }
      const other = seen.get(name);
      if (other !== undefined) {
        problems.push(`${where(route)}: name ${name} is also ${other}`);
      }
      seen.set(name, where(route));
    }
    assert.deepEqual(problems, []);
  });

  it("completes each statement", () => {
    const problems = routes.flatMap((route) => {
      const s = route.statements[0];
      if (!s) {
        return [];
      }
      if (s.callable === undefined) {
        return [`${where(route)}: no callable flag`];
      }
      if (!s.callable) {
        return s.hasReason ? [] : [`${where(route)}: closed with no reason`];
      }
      const gaps = [
        s.hasOutput ? "" : "output",
        s.readOnly === undefined ? "readOnly" : "",
        s.confirm === undefined ? "confirm" : "",
        s.scope === undefined ? "scope" : "",
      ].filter(Boolean);
      return gaps.length > 0
        ? [`${where(route)}: callable with no ${gaps.join(", ")}`]
        : [];
    });
    assert.deepEqual(problems, []);
  });

  it("writes each scope as resource:action, or null for a public read", () => {
    const wrong = routes
      .filter((r) => {
        const scope = r.statements[0]?.scope;
        return (
          r.statements[0]?.callable === true &&
          typeof scope === "string" &&
          !/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(scope)
        );
      })
      .map((r) => `${where(r)}: scope ${String(r.statements[0]?.scope)}`);
    assert.deepEqual(wrong, []);
  });

  it("gives every callable read of a signed-in caller a scope word", () => {
    for (const [method, path, scope] of [
      ["get", "/notifications", "notifications:read"],
      ["get", "/notifications/unread-count", "notifications:read"],
      ["get", "/notifications/preferences", "notifications:read"],
      ["get", "/files", "files:read"],
      ["get", "/projects", "project:read"],
      ["get", "/cms/:collection/entries", null],
    ] as const) {
      assert.equal(find(method, path).statements[0]?.scope, scope, path);
    }
  });

  it("never opens an admin, auth or payment callback route", () => {
    const open = routes
      .filter((r) => mustBeClosed(r) && r.statements[0]?.callable !== false)
      .map(where);
    assert.deepEqual(open, []);
  });

  it("opens the product reads the plan names", () => {
    for (const [method, path] of [
      ["get", "/notifications"],
      ["get", "/cms/:collection/entries"],
      ["get", "/cms/:collection/entries/:slug"],
    ] as const) {
      const s = find(method, path).statements[0];
      assert.equal(s?.callable, true, `${path} is callable`);
      assert.equal(s?.readOnly, true, `${path} is read only`);
    }
  });
});
