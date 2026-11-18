import { config } from "@repo/config";
import { McpServer } from "@modelcontextprotocol/server";
import type {
  CallToolResult,
  StandardSchemaWithJSON,
} from "@modelcontextprotocol/server";
import type { Context } from "hono";
import type { AgentTool, ObjectSchema, RoutedApp } from "./document";

// The MCP server: one tool per callable route, and a tool call that runs the route.
//
// **One code path** (plan 0110). A `tools/call` is an in-process request to the route the
// tool came from, `app.fetch(new Request(...))`, with the caller's own `Authorization`
// header. The route's validator, its gate, its scope check and its error envelope answer
// the call, exactly as they answer the same request over HTTP. Nothing here decides who
// may do what.
//
// A server is built per request, because each tool call needs that request's `c`: its
// header, its bindings and its execution context. The tool list is cached per isolate.

/** The key a tool's confirm mark travels under in its `_meta`. */
export const CONFIRM_META = "saasaloy/confirm";

/** The key a tool's scope word travels under in its `_meta`. */
export const SCOPE_META = "saasaloy/scope";

/**
 * The tool's input schema as the SDK takes it: advertised in `tools/list`, and passed
 * through on `tools/call` with no check of its own.
 *
 * The SDK validates a tool's arguments before the tool runs, and its refusal is a plain
 * text error. Passing every object through leaves the check to the route's own
 * `zValidator`, so a wrong argument gets the same `invalid_input` envelope it gets over
 * HTTP, with the same message. Anything that is not an object is refused here, because
 * no route takes one.
 */
export function routeChecked(
  schema: ObjectSchema
): StandardSchemaWithJSON<Record<string, unknown>> {
  return {
    "~standard": {
      jsonSchema: { input: () => schema, output: () => schema },
      validate: (value: unknown) =>
        typeof value === "object" && value !== null && !Array.isArray(value)
          ? { value: value as Record<string, unknown> }
          : { issues: [{ message: "The arguments must be one object." }] },
      vendor: "saasaloy",
      version: 1,
    },
  };
}

/** `c.executionCtx`, or `undefined` where the runtime gives none (a Node test). */
function executionContext(c: Context): ExecutionContext | undefined {
  try {
    return c.executionCtx as ExecutionContext;
  } catch {
    return undefined;
  }
}

/** The request a tool call becomes: path and query from the arguments, the rest as body. */
export function toolRequest(
  tool: AgentTool,
  args: Record<string, unknown>,
  origin: string,
  authorization: string | undefined
): Request {
  const rest: Record<string, unknown> = { ...args };
  let { path } = tool;
  for (const name of tool.pathParams) {
    path = path.replace(`{${name}}`, encodeURIComponent(String(rest[name])));
    delete rest[name];
  }
  const url = new URL(path, origin);
  for (const name of tool.queryParams) {
    const value = rest[name];
    if (value !== undefined && value !== null) {
      url.searchParams.set(
        name,
        typeof value === "object" ? JSON.stringify(value) : String(value)
      );
    }
    delete rest[name];
  }
  const headers = new Headers({ accept: "application/json" });
  if (authorization) {
    headers.set("authorization", authorization);
  }
  if (tool.hasBody) {
    headers.set("content-type", "application/json");
  }
  return new Request(url, {
    body: tool.hasBody ? JSON.stringify(rest) : undefined,
    headers,
    method: tool.method,
  });
}

/**
 * The route's answer as a tool result. A JSON object is the structured content, an error
 * envelope included, and `isError` follows the status. A redirect is not followed: the
 * result names its `location`, which is what `cms_entry_read` answers for an old slug.
 */
export async function toolResult(res: Response): Promise<CallToolResult> {
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Not JSON: the text is the answer.
  }
  const location = res.headers.get("location");
  const structured =
    typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : { body };
  const content =
    location === null
      ? structured
      : { ...structured, location, status: res.status };
  return {
    content: [{ text: JSON.stringify(content), type: "text" }],
    isError: res.status >= 400,
    structuredContent: content,
  };
}

/** One server for one request, holding every tool. */
export function mcpServer(
  app: RoutedApp,
  c: Context,
  tools: readonly AgentTool[]
): McpServer {
  const server = new McpServer(
    { name: config.app.name, version: config.agent.version },
    { instructions: config.agent.description }
  );
  const { origin } = new URL(c.req.url);
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        // MCP has no field for "a person must confirm". `destructiveHint` is the closest
        // one a client acts on, and `_meta` carries the exact mark and the scope word.
        _meta: {
          [CONFIRM_META]: tool.agent.confirm,
          [SCOPE_META]: tool.agent.scope,
        },
        annotations: {
          destructiveHint: !tool.agent.readOnly && tool.agent.confirm,
          openWorldHint: false,
          readOnlyHint: tool.agent.readOnly,
        },
        description: tool.description,
        inputSchema: routeChecked(tool.inputSchema),
      },
      async (args: Record<string, unknown>) =>
        toolResult(
          await app.fetch(
            toolRequest(tool, args, origin, c.req.header("authorization")),
            c.env,
            executionContext(c)
          )
        )
    );
  }
  return server;
}
