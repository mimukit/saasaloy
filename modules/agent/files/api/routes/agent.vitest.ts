import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { declare, zValidator } from "../contract";
import app from "../index";

// The agent surface: `/openapi.json`, `/llms.txt`, `/mcp/server-card` and `/mcp`.
//
// The tools come from the routes the api has, so this file adds one sample entity of its
// own to the app before the first request: a `notes` list, create and delete, with a stub
// gate that reads two fixed keys. That keeps the test free of a database and of a key
// owner module, and it still proves the one claim that matters: a tool call runs the
// route in process, with the caller's key, and the route's own gate and envelope answer.
//
// The MCP requests use the older stateless handshake (`mcp-protocol-version: 2025-06-18`,
// no session), which answers one JSON-RPC message as server-sent events.
//
// In the saasaloy repo this file is named `.vitest.ts`, so `pnpm test:modules`, which runs
// `node --test` over `*.test.ts`, does not collect it. The descriptor renames it.

// `KV_PROVIDER` is read only when `ratelimit` is installed: `/mcp` then spends a budget.
const ENV = {
  CORS_ORIGINS: "http://localhost:3000",
  KV_PROVIDER: "memory",
  LOGGER_PROVIDER: "console",
};
const KEYS: Record<string, string[]> = {
  "Bearer test-read": ["notes:read"],
  "Bearer test-write": ["notes:read", "notes:write"],
};

/** The stub gate: 401 for an unknown key, 403 for a missing scope, as a real gate does. */
function requireTestScope(header: string | undefined, scope: string): void {
  const held = header === undefined ? undefined : KEYS[header];
  if (!held) {
    throw new HTTPException(401, { message: "invalid api key" });
  }
  if (!held.includes(scope)) {
    throw new HTTPException(403, { message: `permission required: ${scope}` });
  }
}

const noteInput = z.object({ title: z.string().min(1).max(200) });
const note = z.object({ id: z.string(), title: z.string() });
const rows: z.infer<typeof note>[] = [];

const testNotes = new Hono()
  .get(
    "/",
    declare({
      agent: {
        callable: true,
        confirm: false,
        readOnly: true,
        scope: "notes:read",
      },
      description: "List the caller's notes.",
      name: "test_notes_list",
      output: z.object({ notes: z.array(note) }),
    }),
    (c) => {
      requireTestScope(c.req.header("authorization"), "notes:read");
      return c.json({ notes: rows }, 200);
    }
  )
  .post(
    "/",
    declare({
      agent: {
        callable: true,
        confirm: false,
        readOnly: false,
        scope: "notes:write",
      },
      description: "Create one note.",
      name: "test_note_create",
      output: note,
      status: 201,
    }),
    zValidator("json", noteInput, (result, c) => {
      if (!result.success) {
        return c.json(
          { error: { code: "invalid_input", message: "title" } },
          400
        );
      }
    }),
    (c) => {
      requireTestScope(c.req.header("authorization"), "notes:write");
      const row = { id: String(rows.length + 1), ...c.req.valid("json") };
      rows.push(row);
      return c.json(row, 201);
    }
  )
  .delete(
    "/:id",
    declare({
      agent: {
        callable: true,
        confirm: true,
        readOnly: false,
        scope: "notes:delete",
      },
      description: "Delete one note.",
      name: "test_note_delete",
      output: z.object({ id: z.string() }),
    }),
    (c) => {
      requireTestScope(c.req.header("authorization"), "notes:delete");
      return c.json({ id: c.req.param("id") }, 200);
    }
  );

const MCP_HEADERS = {
  accept: "application/json, text/event-stream",
  "content-type": "application/json",
  host: "localhost:4000",
  "mcp-protocol-version": "2025-06-18",
};

function post(body: unknown, headers: Record<string, string>) {
  return app.request(
    "/mcp",
    { body: JSON.stringify(body), headers, method: "POST" },
    ENV
  );
}

/** One JSON-RPC call; the answer is the one `data:` frame, or the JSON body. */
async function rpc(
  method: string,
  params: Record<string, unknown>,
  key = "Bearer test-write"
): Promise<{ result?: Record<string, unknown>; error?: unknown }> {
  const res = await post(
    { id: 1, jsonrpc: "2.0", method, params },
    { ...MCP_HEADERS, authorization: key }
  );
  expect(res.status).toBe(200);
  const text = await res.text();
  const data = /^data: (.*)$/m.exec(text)?.[1] ?? text;
  return JSON.parse(data) as {
    result?: Record<string, unknown>;
    error?: unknown;
  };
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  key?: string
) {
  const { result } = await rpc("tools/call", { arguments: args, name }, key);
  return result as {
    isError: boolean;
    structuredContent: Record<string, unknown>;
  };
}

interface Document {
  openapi: string;
  paths: Record<string, Record<string, Record<string, unknown>>>;
  servers: { url: string }[];
}

async function openApi(): Promise<Document> {
  const res = await app.request("/openapi.json", {}, ENV);
  expect(res.status).toBe(200);
  return (await res.json()) as Document;
}

describe("the agent surface", () => {
  beforeAll(() => {
    // The finished api is one Hono instance, and `.route()` adds to it, so the agent
    // surface sees this entity like any module's routes.
    app.route("/test-notes", testNotes);
  });

  describe("GET /openapi.json", () => {
    it("answers an OpenAPI document for the origin that asks", async () => {
      const doc = await openApi();
      expect(doc.openapi).toMatch(/^3\./);
      expect(doc.servers).toStrictEqual([{ url: "http://localhost" }]);
    });

    it("writes each callable route with its statement and its input", async () => {
      const doc = await openApi();
      const create = doc.paths["/test-notes"]?.post;
      expect(create?.operationId).toBe("test_note_create");
      expect(create?.["x-agent"]).toStrictEqual({
        callable: true,
        confirm: false,
        readOnly: false,
        scope: "notes:write",
      });
      expect(create?.requestBody).toBeDefined();
    });

    it("leaves every closed route out, the agent surface included", async () => {
      const doc = await openApi();
      expect(doc.paths["/mcp"]).toBeUndefined();
      expect(doc.paths["/openapi.json"]).toBeUndefined();
    });
  });

  describe("GET /llms.txt", () => {
    async function llms(): Promise<string> {
      const res = await app.request("/llms.txt", {}, ENV);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
      return res.text();
    }

    it("names the document, the MCP address and how to send a key", async () => {
      const text = await llms();
      expect(text).toContain("http://localhost/openapi.json");
      expect(text).toContain("http://localhost/mcp");
      expect(text).toContain("Authorization: Bearer <key>");
    });

    it("names each tool with its scope", async () => {
      const text = await llms();
      expect(text).toContain("`test_note_create`");
      expect(text).toContain("needs scope `notes:delete`");
    });
  });

  describe("GET /mcp/server-card", () => {
    it("answers its own media type to any origin, with no key", async () => {
      const res = await app.request("/mcp/server-card", {}, ENV);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe(
        "application/mcp-server-card+json"
      );
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("says where to connect, and lists no tools", async () => {
      const res = await app.request("/mcp/server-card", {}, ENV);
      const card = (await res.json()) as Record<string, unknown>;
      expect(card.$schema).toBe(
        "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json"
      );
      expect(card.name).toBe("localhost/mcp");
      expect(card.remotes).toMatchObject([
        { type: "streamable-http", url: "http://localhost/mcp" },
      ]);
      expect(card).not.toHaveProperty("tools");
    });
  });

  describe("/mcp", () => {
    it("refuses a request with no key, in the shared envelope", async () => {
      const res = await post(
        { id: 1, jsonrpc: "2.0", method: "tools/list", params: {} },
        MCP_HEADERS
      );
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "unauthorized" },
      });
    });

    it("refuses a foreign Host in the shared envelope", async () => {
      const res = await post(
        { id: 1, jsonrpc: "2.0", method: "tools/list", params: {} },
        {
          ...MCP_HEADERS,
          authorization: "Bearer test-read",
          host: "evil.example",
        }
      );
      expect(res.status).toBe(403);
      await expect(res.json()).resolves.toStrictEqual({
        error: { code: "forbidden", message: "Invalid Host: evil.example" },
      });
    });

    it("refuses a malformed body in the shared envelope", async () => {
      const res = await app.request(
        "/mcp",
        {
          body: "{",
          headers: { ...MCP_HEADERS, authorization: "Bearer test-read" },
          method: "POST",
        },
        ENV
      );
      expect(res.status).toBe(400);
      await expect(res.json()).resolves.toMatchObject({
        error: { code: "invalid_input" },
      });
    });

    it("lists one tool for each callable route, with its marks", async () => {
      const { result } = await rpc("tools/list", {});
      const tools = result?.tools as {
        name: string;
        annotations: Record<string, boolean>;
        _meta: Record<string, unknown>;
        inputSchema: { required?: string[] };
      }[];
      const create = tools.find((t) => t.name === "test_note_create");
      expect(create?.annotations).toMatchObject({
        destructiveHint: false,
        readOnlyHint: false,
      });
      expect(create?.inputSchema.required).toStrictEqual(["title"]);
      expect(tools.map((t) => t.name)).not.toContain("agent_mcp");
    });

    it("marks a tool that needs a person, and names its scope", async () => {
      const { result } = await rpc("tools/list", {});
      const tools = result?.tools as {
        name: string;
        annotations: Record<string, boolean>;
        _meta: Record<string, unknown>;
      }[];
      const remove = tools.find((t) => t.name === "test_note_delete");
      expect(remove?.annotations.destructiveHint).toBeTruthy();
      expect(remove?._meta).toStrictEqual({
        "saasaloy/confirm": true,
        "saasaloy/scope": "notes:delete",
      });
    });

    it("runs the route in process: a create, then a list that holds it", async () => {
      const created = await callTool("test_note_create", { title: "from mcp" });
      expect(created.isError).toBeFalsy();
      expect(created.structuredContent).toMatchObject({ title: "from mcp" });

      const listed = await callTool("test_notes_list", {}, "Bearer test-read");
      expect(listed.isError).toBeFalsy();
      expect(listed.structuredContent.notes).toContainEqual(
        created.structuredContent
      );
    });

    it("answers a key without the scope with the route's own refusal", async () => {
      const refused = await callTool(
        "test_note_create",
        { title: "no" },
        "Bearer test-read"
      );
      expect(refused.isError).toBeTruthy();
      expect(refused.structuredContent).toStrictEqual({
        error: {
          code: "forbidden",
          message: "permission required: notes:write",
        },
      });
    });

    it("answers a key that fails with the route's own 401", async () => {
      const refused = await callTool("test_notes_list", {}, "Bearer nobody");
      expect(refused.isError).toBeTruthy();
      expect(refused.structuredContent).toMatchObject({
        error: { code: "unauthorized" },
      });
    });

    it("leaves a wrong argument to the route's validator", async () => {
      const refused = await callTool("test_note_create", { title: "" });
      expect(refused.isError).toBeTruthy();
      expect(refused.structuredContent).toStrictEqual({
        error: { code: "invalid_input", message: "title" },
      });
    });
  });
});
