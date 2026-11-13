import { describe, expect, it } from "vitest";
import app from "../index";
import { staleActions, unauditedRoutes } from "../lib/audit-actions";

// The audit coverage test. Every admin write route the api serves (`POST`, `PUT`, `PATCH`
// and `DELETE` under `/admin/`, outside Better Auth's `/admin/auth/*`) must be named by an
// action some installed module registers in `../lib/audit-actions.ts`. A new route fails
// here until its module's action file in `../audit/` names it, and there is no exempt
// list.
//
// It reads the route table from `app.routes`, so a route a module or a project adds later
// is checked with no edit to this file. It cannot see whether the handler really runs
// through `adminWrite`; the route's own test proves the row is written.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

describe("the audit action registry", () => {
  it("names every admin write route the api serves", () => {
    expect(unauditedRoutes(app.routes)).toStrictEqual([]);
  });

  it("names only routes the api serves", () => {
    expect(staleActions(app.routes)).toStrictEqual([]);
  });

  it("catches a write route no action names", () => {
    const found = unauditedRoutes([
      ...app.routes,
      { method: "POST", path: "/admin/widgets" },
      { method: "GET", path: "/admin/widgets" },
    ]);

    expect(found).toContain("POST /admin/widgets");
    expect(found).not.toContain("GET /admin/widgets");
  });
});
