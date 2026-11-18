import { createMcpHonoApp } from "@modelcontextprotocol/hono";
import {
  DEFAULT_MAX_REQUEST_BODY_SIZE,
  createMcpHandler,
  isJsonContentType,
  readRequestBody,
  validateHostHeader,
  validateOriginHeader,
} from "@modelcontextprotocol/server";
import { env } from "cloudflare:workers";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { MiddlewareHandler } from "hono";
import { declare } from "../contract";
import { agentGuards } from "../agent/guards";
import { llmsText, serverCard } from "../agent/discovery";
import { agentTools, openApiDocument, withServer } from "../agent/document";
import type { RoutedApp } from "../agent/document";
import { mcpHostnames } from "../agent/hosts";
import { mcpServer } from "../agent/mcp";
import type { Bindings } from "../index";

// The agent surface of the api: the OpenAPI document, `llms.txt`, the MCP Server Card and
// the MCP endpoint, all built from the route statements (plan 0110, ADR 0063).
//
// This module's `chained-route` patch mounts the chain on `base`, at `/`, not on the
// typed chain: none of these routes belongs in `AppType`, and `hc` has nothing to say
// about a JSON-RPC endpoint. Mounted on `base`, it still runs after api's CORS and request
// logger, and api's `onError` and `notFound` answer for it.
//
// Every surface reads the finished app, every route of every module. That app is
// `apps/api/src/index.ts`'s default export, which imports this file, so it is loaded on
// the first request rather than at import time: by then both modules have finished
// loading, and the import costs nothing after the first one.

/** The finished api, every module's routes mounted. */
async function rootApp(): Promise<RoutedApp> {
  const api = await import("../index");
  return api.default;
}

function originOf(url: string): string {
  return new URL(url).origin;
}

// The hostnames `/mcp` answers on, from the api's own origin (`./agent/hosts.ts`). Read
// once, when the module loads: a Worker's bindings do not change inside an isolate.
const HOSTNAMES = mcpHostnames(env as unknown as Record<string, unknown>);

interface AgentEnv {
  Bindings: Bindings;
  Variables: { parsedBody?: unknown };
}

/**
 * No key, no work. A request with no bearer credential is refused before the host check,
 * the rate limit, the body or any server. The key itself is checked by each route's own
 * gate when a tool runs, so a key that fails gets that route's 401.
 */
const requireKey: MiddlewareHandler<AgentEnv> = async (c, next) => {
  if (!/^bearer\s+\S/i.test(c.req.header("authorization") ?? "")) {
    throw new HTTPException(401, {
      message: "A key is required: send Authorization: Bearer <key>.",
    });
  }
  return next();
};

/**
 * The adapter's DNS rebinding check, answered in api's envelope. The same functions and
 * the same lists the adapter runs after it, so the adapter's own JSON-RPC 403 never fires;
 * it stays as the second line.
 */
const checkHost: MiddlewareHandler<AgentEnv> = async (c, next) => {
  const host = validateHostHeader(c.req.header("host"), HOSTNAMES.hosts);
  if (!host.ok) {
    throw new HTTPException(403, { message: host.message });
  }
  const origin = validateOriginHeader(
    c.req.header("origin"),
    HOSTNAMES.origins
  );
  if (!origin.ok) {
    throw new HTTPException(403, { message: origin.message });
  }
  return next();
};

/**
 * The JSON body, read once and bounded, as the adapter reads it, so a malformed or an
 * oversized body gets api's envelope rather than the adapter's plain text. The adapter
 * finds `parsedBody` set and does not read it again.
 */
const readBody: MiddlewareHandler<AgentEnv> = async (c, next) => {
  if (!isJsonContentType(c.req.header("content-type"))) {
    return next();
  }
  // The SDK types its `Request` with the DOM's lib, the api with the Workers lib; the
  // object is the same one.
  const body = await readRequestBody(
    c.req.raw.clone() as Parameters<typeof readRequestBody>[0],
    DEFAULT_MAX_REQUEST_BODY_SIZE
  );
  if (body.tooLarge) {
    throw new HTTPException(413, {
      message: `The body is over ${String(DEFAULT_MAX_REQUEST_BODY_SIZE)} bytes.`,
    });
  }
  try {
    c.set("parsedBody", JSON.parse(body.text));
  } catch {
    throw new HTTPException(400, {
      message: "Malformed JSON in request body",
    });
  }
  return next();
};

export const agent = new Hono<AgentEnv>()
  .get(
    "/openapi.json",
    declare({
      agent: {
        callable: false,
        reason: "The agent surface itself, not a product action.",
      },
      description: "The OpenAPI document of every route an agent may call.",
      name: "agent_openapi_read",
    }),
    async (c) =>
      c.json(
        withServer(await openApiDocument(await rootApp()), originOf(c.req.url)),
        200
      )
  )
  .get(
    "/llms.txt",
    declare({
      agent: {
        callable: false,
        reason: "The agent surface itself, not a product action.",
      },
      description:
        "What this api offers an agent, and how to connect, as text.",
      name: "agent_llms_read",
    }),
    async (c) =>
      c.text(llmsText(originOf(c.req.url), await agentTools(await rootApp())))
  )
  .get(
    "/mcp/server-card",
    declare({
      agent: {
        callable: false,
        reason: "The agent surface itself, not a product action.",
      },
      description: "The MCP Server Card: where and how to connect.",
      name: "agent_server_card_read",
    }),
    // SEP-2127: its own media type, open to any origin, and cacheable. The card holds
    // only public metadata, so `*` is safe, as the extension's discovery rules say.
    (c) =>
      c.body(JSON.stringify(serverCard(originOf(c.req.url))), 200, {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=3600",
        "Content-Type": "application/mcp-server-card+json",
      })
  )
  .use("/mcp", requireKey, checkHost, ...agentGuards.guards, readBody)
  // `@modelcontextprotocol/hono`: Host and Origin validation and the bounded JSON body
  // parser, as plain Hono middleware. It runs after the checks above, which answer every
  // refusal it would make, so in practice it only passes requests on.
  .route(
    "/mcp",
    createMcpHonoApp({
      allowedHosts: HOSTNAMES.hosts,
      allowedOrigins: HOSTNAMES.origins,
    })
  )
  .on(
    ["GET", "POST", "DELETE"],
    "/mcp",
    declare({
      agent: {
        callable: false,
        reason: "The agent surface itself, not a product action.",
      },
      description:
        "The MCP endpoint: one tool for each route an agent may call.",
      name: "agent_mcp",
    }),
    async (c) => {
      const app = await rootApp();
      const tools = await agentTools(app);
      // Stateless: a fresh server per request, which serves the 2026-07-28 revision and
      // the older `initialize` handshake alike. The older leg answers over SSE.
      const handler = createMcpHandler(() => mcpServer(app, c, tools), {
        legacy: "stateless",
        responseMode: "json",
      });
      return handler.fetch(c.req.raw, { parsedBody: c.get("parsedBody") });
    }
  );
