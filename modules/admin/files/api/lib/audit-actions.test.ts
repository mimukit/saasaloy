// Tests for ./audit-actions.ts. This file is NOT in the admin descriptor's `files` list,
// so `add admin` never copies it into a project. It exists for this repo only.
//
// It checks the helpers against made-up maps and route lists. The shipped
// `../routes/audit-coverage.vitest.ts` checks the project's real map against the routes
// its api serves. Run it with `pnpm test:modules`; the import carries `.ts` because Node's
// type stripping resolves the real file.

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  actionsOfArea,
  adminWriteRoutes,
  areaOfAction,
  auditAreas,
  defineAuditActions,
  labelOfAction,
  labelOfArea,
  staleActions,
  targetOfAction,
  unauditedRoutes,
} from "./audit-actions.ts";

const payment = {
  "payment.refund.create": {
    area: "payments",
    route: "POST /admin/payment/payments/:id/refunds",
    target: "payment",
  },
  "payment.review.confirm": {
    area: "payments",
    route: "POST /admin/payment/payments/:id/review",
    target: "payment",
  },
  "payment.review.reject": {
    area: "payments",
    route: "POST /admin/payment/payments/:id/review",
    target: "payment",
  },
} as const;

const members = {
  "member.remove": {
    area: "members",
    areaLabel: "Team",
    label: "Removed a member",
    route: "DELETE /admin/members/:id",
    target: "member",
  },
} as const;

const actions = defineAuditActions({ actions: [payment, members, {}] });

describe("defineAuditActions", () => {
  it("merges every module's map into one", () => {
    assert.deepEqual(Object.keys(actions).toSorted(), [
      "member.remove",
      "payment.refund.create",
      "payment.review.confirm",
      "payment.review.reject",
    ]);
  });

  it("is empty with no map registered", () => {
    assert.deepEqual(defineAuditActions({ actions: [] }), {});
  });

  it("throws on an action two maps both name", () => {
    assert.throws(
      () => defineAuditActions({ actions: [members, members] }),
      /"member\.remove"/
    );
  });

  it("freezes the merged map", () => {
    assert.ok(Object.isFrozen(actions));
  });
});

describe("actionsOfArea", () => {
  it("answers the actions of one area", () => {
    assert.deepEqual(actionsOfArea("payments", actions), [
      "payment.refund.create",
      "payment.review.confirm",
      "payment.review.reject",
    ]);
    assert.deepEqual(actionsOfArea("widgets", actions), []);
  });
});

describe("areaOfAction and targetOfAction", () => {
  it("answer the area and target of a known action", () => {
    assert.equal(areaOfAction("member.remove", actions), "members");
    assert.equal(targetOfAction("payment.refund.create", actions), "payment");
  });

  it("answer null for an action no map names, prototype keys included", () => {
    assert.equal(areaOfAction("widget.polish", actions), null);
    assert.equal(areaOfAction("toString", actions), null);
    assert.equal(targetOfAction("constructor", actions), null);
  });
});

describe("adminWriteRoutes", () => {
  it("keeps the admin write methods once each, sorted", () => {
    assert.deepEqual(
      adminWriteRoutes([
        { method: "POST", path: "/admin/orders" },
        { method: "POST", path: "/admin/orders" },
        { method: "DELETE", path: "/admin/members/:id" },
        { method: "PATCH", path: "/admin/members/:id" },
        { method: "PUT", path: "/admin/flags/:key" },
        { method: "GET", path: "/admin/orders" },
        { method: "ALL", path: "/admin/orders" },
        { method: "PATCH", path: "/me/profile" },
        { method: "PUT", path: "/administrator/x" },
      ]),
      [
        "DELETE /admin/members/:id",
        "PATCH /admin/members/:id",
        "POST /admin/orders",
        "PUT /admin/flags/:key",
      ]
    );
  });

  it("leaves out Better Auth's own handler under /admin/auth/", () => {
    assert.deepEqual(
      adminWriteRoutes([
        { method: "POST", path: "/admin/auth/sign-in/email" },
        { method: "POST", path: "/admin/auth/organization/create" },
      ]),
      []
    );
  });
});

describe("unauditedRoutes", () => {
  it("answers the admin write routes no action names", () => {
    assert.deepEqual(
      unauditedRoutes(
        [
          { method: "POST", path: "/admin/payment/payments/:id/review" },
          { method: "DELETE", path: "/admin/members/:id" },
          { method: "PUT", path: "/admin/widgets/:id" },
        ],
        actions
      ),
      ["PUT /admin/widgets/:id"]
    );
  });
});

describe("staleActions", () => {
  it("answers the actions whose route the api does not serve", () => {
    assert.deepEqual(
      staleActions(
        [
          { method: "POST", path: "/admin/payment/payments/:id/review" },
          { method: "POST", path: "/admin/payment/payments/:id/refunds" },
        ],
        actions
      ),
      ["member.remove"]
    );
  });
});

describe("labelOfAction, labelOfArea and auditAreas", () => {
  it("answer an action's words, or its key without any", () => {
    assert.equal(labelOfAction("member.remove", actions), "Removed a member");
    assert.equal(
      labelOfAction("payment.refund.create", actions),
      "payment.refund.create"
    );
    assert.equal(labelOfAction("toString", actions), "toString");
  });

  it("answer an area's words, or the area capitalized without any", () => {
    assert.equal(labelOfArea("members", actions), "Team");
    assert.equal(labelOfArea("payments", actions), "Payments");
  });

  it("list every area once, in registry order", () => {
    assert.deepEqual(auditAreas(actions), [
      { id: "payments", label: "Payments" },
      { id: "members", label: "Team" },
    ]);
  });
});
