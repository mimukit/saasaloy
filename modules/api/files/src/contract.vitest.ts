import { Hono } from "hono";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { declare, routeContracts, zValidator } from "./contract";

// The route contract of `./contract.ts`: a `declare(...)` link changes nothing a caller
// sees, and `routeContracts` reads back the statement and the validators' schemas from a
// finished app, through a `.route()` mount, the way the `agent` module reads them, and
// `hono-openapi`'s `generateSpecs` writes the document from the same links.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

const query = z.object({ q: z.string().min(1) });
const item = z.object({ id: z.string() });

const sub = new Hono()
  .get(
    "/",
    declare({
      agent: { callable: true, confirm: false, readOnly: true },
      description: "List the items that match a search.",
      name: "items_list",
      output: z.object({ items: z.array(item) }),
    }),
    zValidator("query", query, (result, c) => {
      if (!result.success) {
        return c.json({ error: { code: "invalid_input", message: "q" } }, 400);
      }
    }),
    (c) => c.json({ items: [{ id: c.req.valid("query").q }] }, 200)
  )
  .post(
    "/:id/archive",
    declare({
      agent: { callable: false, reason: "A person archives from the app." },
      description: "Archive one item.",
      name: "items_archive",
    }),
    (c) => c.json({ ok: true }, 200)
  )
  .get("/undeclared", (c) => c.text("no statement"));

const app = new Hono().route("/items", sub);

describe("the route contract", () => {
  it("leaves a passing response as the route makes it", async () => {
    const ok = await app.request("/items?q=abc");
    expect(ok.status).toBe(200);
    await expect(ok.json()).resolves.toStrictEqual({ items: [{ id: "abc" }] });
  });

  it("leaves the validator's failure hook in charge of a refusal", async () => {
    const refused = await app.request("/items?q=");
    expect(refused.status).toBe(400);
    await expect(refused.json()).resolves.toStrictEqual({
      error: { code: "invalid_input", message: "q" },
    });
  });

  it("lists each route once, with its full path", () => {
    expect(
      routeContracts(app).map((r) => `${r.method} ${r.path}`)
    ).toStrictEqual([
      "GET /items",
      "POST /items/:id/archive",
      "GET /items/undeclared",
    ]);
  });

  it("reads a callable route's statement and its validator's schema", () => {
    const [list] = routeContracts(app);
    expect(list?.declaration?.name).toBe("items_list");
    expect(list?.declaration?.agent).toStrictEqual({
      callable: true,
      confirm: false,
      readOnly: true,
    });
    expect(list?.input.query).toBe(query);
  });

  it("reads a closed route, and a route with no statement", () => {
    const [, archive, undeclared] = routeContracts(app);
    expect(archive?.declaration?.agent).toStrictEqual({
      callable: false,
      reason: "A person archives from the app.",
    });
    expect(archive?.input).toStrictEqual({});
    expect(undeclared?.declaration).toBeUndefined();
  });

  it("keeps the statement when the sub-app sets its own onError", () => {
    const own = new Hono()
      .get(
        "/",
        declare({
          agent: { callable: false, reason: "Test." },
          description: "A route on a sub-app with its own error handler.",
          name: "wrapped_read",
        }),
        (c) => c.text("ok")
      )
      .onError((_err, c) => c.text("own", 500));
    const [contract] = routeContracts(new Hono().route("/wrapped", own));
    expect(contract?.declaration?.name).toBe("wrapped_read");
  });

  it("converts no schema until a document is built", async () => {
    // Not a schema any converter knows: building a document from it would throw, so the
    // route answering proves `declare` and `zValidator` converted nothing on the way in.
    const opaque = {
      "~standard": {
        validate: () => ({ value: {} }),
        vendor: "opaque",
        version: 1,
      },
    } as unknown as typeof item;
    const lazy = new Hono().get(
      "/",
      declare({
        agent: { callable: true, confirm: false, readOnly: true },
        description: "A route whose output schema no converter knows.",
        name: "lazy_read",
        output: opaque,
      }),
      (c) => c.json({}, 200)
    );
    const res = await lazy.request("/");
    expect(res.status).toBe(200);
  });

  it("writes the OpenAPI operation from the statement and the validator", async () => {
    const doc = await generateSpecs(app);
    const list = doc.paths?.["/items"]?.get;
    expect(list?.operationId).toBe("items_list");
    expect(list?.["x-agent"]).toStrictEqual({
      callable: true,
      confirm: false,
      readOnly: true,
    });
    expect(list?.parameters).toStrictEqual([
      {
        in: "query",
        name: "q",
        required: true,
        schema: { minLength: 1, type: "string" },
      },
    ]);
    expect(Object.keys(doc.paths ?? {})).toStrictEqual(["/items"]);
  });
});
