// Guards the route-test rule across every module (issue #243, plan 0080 Phase 5). A module
// that ships an api route also ships its route test, so a project that turns testing on
// gets a test for every route it installs: the success path, `401` with no session, `403`
// for the wrong tenant or role, and one `400`, as far as the route has each of them.
//
// A route is a descriptor entry whose target is `@api/routes/<name>.ts`. Its test is an
// entry, in the same descriptor, that targets `@api/routes/<name>.test.ts`. A route that
// ships with no test says why, in an `"untested": "<reason>"` key on the route's entry, and
// this guard prints the reason rather than failing the route.
//
// Like `./test-file-gates.test.ts`, it reads every `modules/*/registry-item.json` as JSON.
// Run it with `pnpm test:scripts`.

import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MODULES = join(ROOT, "modules");

const ROUTE = /^@api\/routes\/(?<name>[^/]+)\.ts$/;

export interface Entry {
  path: string;
  target: string;
  untested?: string;
}

export interface Descriptor {
  files?: Entry[];
}

export interface Finding {
  route: string;
  /** The `untested` reason, or undefined when the route has neither a test nor a reason. */
  reason: string | undefined;
}

/** Every api route a descriptor ships with no route test beside it. */
export function untestedRoutes(descriptor: Descriptor): Finding[] {
  const files = descriptor.files ?? [];
  const targets = new Set(files.map((entry) => entry.target));
  return files
    .filter((entry) => {
      const name = ROUTE.exec(entry.target)?.groups?.name;
      return (
        name !== undefined &&
        !name.endsWith(".test") &&
        !targets.has(`@api/routes/${name}.test.ts`)
      );
    })
    .map((entry) => ({ route: entry.target, reason: entry.untested }));
}

const modules = readdirSync(MODULES)
  .filter((module) => existsSync(join(MODULES, module, "registry-item.json")))
  .map((module) => ({
    module,
    descriptor: JSON.parse(
      readFileSync(join(MODULES, module, "registry-item.json"), "utf-8")
    ) as Descriptor,
  }));

describe("untestedRoutes", () => {
  const descriptor: Descriptor = {
    files: [
      {
        path: "files/api/routes/waitlist.ts",
        target: "@api/routes/waitlist.ts",
      },
      {
        path: "files/api/routes/waitlist.vitest.ts",
        target: "@api/routes/waitlist.test.ts",
      },
      {
        path: "files/db/schema/waitlist.sqlite.ts",
        target: "@db/schema/waitlist.ts",
      },
    ],
  };

  it("passes a descriptor whose route has its test", () => {
    assert.deepEqual(untestedRoutes(descriptor), []);
  });

  it("fails a descriptor that drops the route test", () => {
    const dropped = structuredClone(descriptor);
    dropped.files?.splice(1, 1);
    assert.deepEqual(untestedRoutes(dropped), [
      { route: "@api/routes/waitlist.ts", reason: undefined },
    ]);
  });

  it("reports the reason of a route marked untested", () => {
    const marked = structuredClone(descriptor);
    marked.files?.splice(1, 1);
    const route = marked.files?.[0];
    assert.ok(route);
    route.untested = "a static page";
    assert.deepEqual(untestedRoutes(marked), [
      { route: "@api/routes/waitlist.ts", reason: "a static page" },
    ]);
  });
});

describe("module api routes have a route test or a reason", () => {
  it("finds the route-owning modules", () => {
    // A renamed alias or a moved folder would otherwise leave the check below passing on
    // nothing. Ten modules owned an api route when the guard landed (#243).
    const owners = modules.filter(({ descriptor }) =>
      (descriptor.files ?? []).some((entry) => ROUTE.test(entry.target))
    );
    assert.ok(owners.length >= 10, `found only ${owners.length} route owners`);
  });

  // oxlint-disable-next-line vitest/prefer-each -- node:test's describe has no .each
  for (const { module, descriptor } of modules) {
    it(module, (t) => {
      const findings = untestedRoutes(descriptor);
      for (const { route, reason } of findings) {
        if (reason !== undefined) {
          t.diagnostic(`untested ${route}: ${reason}`);
        }
      }
      assert.deepEqual(
        findings
          .filter((finding) => finding.reason === undefined)
          .map((f) => f.route),
        [],
        `${module} ships api routes with no route test and no "untested" reason`
      );
    });
  }
});
