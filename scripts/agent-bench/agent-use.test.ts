// The agent-use helpers of the benchmark scorer (plan 0110 phase 7, issue #348): the key
// the scorer seeds, and the read-back through MCP that checks the second agent's work.
// The IO helpers run against a fake product: a node HTTP server that answers the four
// requests the scorer makes. Run with `pnpm test:scripts`, or
// `node --test scripts/agent-bench/agent-use.test.ts`.

import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, describe, it } from "node:test";

import {
  entityScopes,
  mcpToolCalls,
  readBackId,
  readEntityRows,
  rowsIn,
  scopeObject,
  seedAgentKey,
} from "./agent-use.ts";

const DOC = {
  openapi: "3.1.0",
  paths: {
    "/books": {
      get: {
        operationId: "books_list",
        "x-agent": { callable: true, readOnly: true, scope: "books:read" },
      },
      post: {
        operationId: "books_create",
        "x-agent": { callable: true, readOnly: false, scope: "books:write" },
      },
    },
    "/books/{id}": {
      patch: {
        operationId: "books_update",
        "x-agent": { callable: true, readOnly: false, scope: "books:write" },
      },
      delete: {
        operationId: "books_delete",
        "x-agent": { callable: true, readOnly: false, scope: "books:delete" },
      },
    },
    "/notifications": {
      get: {
        operationId: "notifications_list",
        "x-agent": {
          callable: true,
          readOnly: true,
          scope: "notifications:read",
        },
      },
    },
  },
};

describe("entityScopes", () => {
  it("takes the entity's read and write scopes and leaves delete off", () => {
    assert.deepEqual(entityScopes(DOC, "books"), ["books:read", "books:write"]);
    assert.deepEqual(scopeObject(entityScopes(DOC, "books")), {
      books: ["read", "write"],
    });
  });

  it("matches a kebab-case resource for a snake_case table, and finds none for another table", () => {
    const doc = {
      paths: {
        "/reading-sessions": {
          get: { "x-agent": { scope: "reading-sessions:read" } },
        },
      },
    };
    assert.deepEqual(entityScopes(doc, "reading_sessions"), [
      "reading-sessions:read",
    ]);
    assert.deepEqual(entityScopes(DOC, "shelves"), []);
    assert.deepEqual(entityScopes("not a document", "books"), []);
  });
});

describe("rowsIn", () => {
  it("finds the rows of a list in each shape a route may answer", () => {
    assert.deepEqual(rowsIn({ body: [{ id: 1 }] }), [{ id: 1 }]);
    assert.deepEqual(rowsIn({ books: [{ id: 1 }], total: 1 }), [{ id: 1 }]);
    assert.deepEqual(rowsIn({ data: { items: [{ id: 2 }] } }), [{ id: 2 }]);
    assert.deepEqual(rowsIn([{ id: 3 }]), [{ id: 3 }]);
    assert.equal(rowsIn({ error: { code: "forbidden" } }), undefined);
  });
});

describe("the second agent's transcript and reply", () => {
  it("counts the MCP tools/call requests in tool inputs only, not in prose", () => {
    const event = (content: unknown[]) =>
      JSON.stringify({ type: "assistant", message: { content } });
    const transcript = [
      event([{ type: "text", text: "I will send tools/call next." }]),
      event([
        {
          type: "tool_use",
          name: "Bash",
          input: { command: 'curl -d \'{"method":"tools/call"}\' x/mcp' },
        },
      ]),
      event([
        {
          type: "tool_use",
          name: "Write",
          input: {
            file_path: "call.mjs",
            content: 'send("tools/call", a); send("tools/call", b);',
          },
        },
      ]),
      'plain text line with "method":"tools/call"',
    ].join("\n");
    assert.equal(mcpToolCalls(transcript), 4);
    assert.equal(
      mcpToolCalls(event([{ type: "text", text: "tools/call" }])),
      0
    );
  });

  it("reads the id from the reply's last READ BACK line", () => {
    assert.equal(readBackId("Done.\nREAD BACK: bk_123\n"), "bk_123");
    assert.equal(readBackId("READ BACK: `42`"), "42");
    assert.equal(readBackId("Done, the id is bk_1."), undefined);
  });
});

// --- A fake product ---------------------------------------------------------------

interface Seen {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

const seen: Seen[] = [];
let rows: { id: string }[] = [];
let createStatus = 200;
let server: Server;
let api = "";

function body(request: IncomingMessage): Promise<string> {
  return new Promise((done) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      done(Buffer.concat(chunks).toString("utf-8"));
    });
  });
}

before(async () => {
  server = createServer((request, response) => {
    void answer(request, response);
  });
  async function answer(
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    const text = await body(request);
    seen.push({
      method: request.method ?? "",
      url: request.url ?? "",
      headers: request.headers,
      body: text,
    });
    const json = (
      status: number,
      value: unknown,
      type = "application/json"
    ) => {
      response.writeHead(status, { "content-type": type });
      response.end(typeof value === "string" ? value : JSON.stringify(value));
    };
    if (request.url === "/openapi.json") {
      json(200, DOC);
    } else if (request.url === "/auth/sign-up/email") {
      json(200, { user: { id: "u1" } });
    } else if (request.url === "/auth/sign-in/email") {
      response.setHeader("set-cookie", ["sid=abc; Path=/; HttpOnly"]);
      json(200, { user: { id: "u1" } });
    } else if (request.url === "/auth/api-key/create") {
      json(
        createStatus,
        createStatus === 200
          ? { id: "k1", key: "sk_fake_key" }
          : { message: "permission required: books:write" }
      );
    } else if (request.url === "/mcp") {
      const rpc = JSON.parse(text) as {
        id: number;
        method: string;
        params?: { name?: string };
      };
      if (request.headers.authorization !== "Bearer sk_fake_key") {
        json(401, { error: { code: "unauthorized" } });
      } else if (rpc.method === "tools/list") {
        json(200, {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            tools: [
              {
                name: "notifications_list",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: true },
                _meta: { "saasaloy/scope": "notifications:read" },
              },
              {
                name: "books_create",
                inputSchema: { type: "object", required: ["title"] },
                annotations: { readOnlyHint: false },
                _meta: { "saasaloy/scope": "books:write" },
              },
              {
                name: "books_read",
                inputSchema: { type: "object", required: ["id"] },
                annotations: { readOnlyHint: true },
                _meta: { "saasaloy/scope": "books:read" },
              },
              {
                name: "books_list",
                inputSchema: { type: "object", properties: {} },
                annotations: { readOnlyHint: true },
                _meta: { "saasaloy/scope": "books:read" },
              },
            ],
          },
        });
      } else if (rpc.method === "tools/call") {
        const message = {
          jsonrpc: "2.0",
          id: rpc.id,
          result: {
            content: [{ type: "text", text: "" }],
            isError: false,
            structuredContent: { body: rows },
          },
        };
        json(
          200,
          `event: message\ndata: ${JSON.stringify(message)}\n\n`,
          "text/event-stream"
        );
      }
    } else {
      json(404, { error: { code: "not_found" } });
    }
  }
  await new Promise<void>((done) => {
    server.listen(0, "127.0.0.1", done);
  });
  api = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
});

after(() => {
  server.close();
});

describe("seedAgentKey", () => {
  it("signs up a fresh user and issues it a key for the entity's read and write scopes", async () => {
    seen.length = 0;
    const result = await seedAgentKey({
      api,
      appOrigin: "http://localhost:10002",
      table: "books",
      email: "agent@bench.test",
      password: "bench-password-1234",
    });
    assert.deepEqual(result, {
      key: "sk_fake_key",
      scopes: ["books:read", "books:write"],
    });
    const create = seen.find((s) => s.url === "/auth/api-key/create");
    assert.equal(create?.headers.cookie, "sid=abc");
    assert.equal(create?.headers.origin, "http://localhost:10002");
    assert.deepEqual(JSON.parse(create?.body ?? "{}"), {
      name: "agent-bench second agent",
      metadata: { scope: { books: ["read", "write"] } },
    });
  });

  it("names the step that failed instead of returning a key", async () => {
    createStatus = 403;
    const refused = await seedAgentKey({
      api,
      appOrigin: "http://localhost:10002",
      table: "books",
      email: "agent2@bench.test",
      password: "bench-password-1234",
    });
    createStatus = 200;
    assert.ok("problem" in refused);
    assert.match(refused.problem, /api-key\/create returned 403.*books:write/);
    const none = await seedAgentKey({
      api,
      appOrigin: "http://localhost:10002",
      table: "shelves",
      email: "agent3@bench.test",
      password: "bench-password-1234",
    });
    assert.ok("problem" in none);
    assert.match(none.problem, /\/openapi\.json states no `shelves` scope/);
  });
});

describe("readEntityRows", () => {
  it("calls the entity's read tool that needs no input, with the key, and returns its rows", async () => {
    rows = [{ id: "bk_1" }];
    const result = await readEntityRows(api, "sk_fake_key", "books");
    assert.deepEqual(result, { tool: "books_list", rows: [{ id: "bk_1" }] });
    const call = seen.findLast((s) => s.url === "/mcp");
    assert.equal(call?.headers.authorization, "Bearer sk_fake_key");
    assert.match(call?.body ?? "", /"name":"books_list"/);
  });

  it("names the gap when the key is refused or the entity has no read tool", async () => {
    const refused = await readEntityRows(api, "sk_wrong", "books");
    assert.ok("problem" in refused);
    assert.match(refused.problem, /tools\/list answered 401/);
    const none = await readEntityRows(api, "sk_fake_key", "shelves");
    assert.ok("problem" in none);
    assert.match(
      none.problem,
      /no read tool for shelves:read that needs no input/
    );
  });
});
