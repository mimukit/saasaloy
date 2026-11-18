// The agent-use evidence of the benchmark scorer (plan 0110 phase 7, issue #348): the key
// the scorer seeds for the second agent, and the read-back through MCP that checks what
// that agent did.
//
// How the key is seeded. With the dev servers up, the scorer signs up a fresh user through
// the api (`/auth/sign-up/email`, then `/auth/sign-in/email` for the session cookie), and
// issues that user a key with `POST /auth/api-key/create` and `metadata.scope`. The scope
// is every read and write scope that `/openapi.json` states for the first entity of the
// spec, and never its delete scope, as the key form leaves delete off until a person ticks
// it. The scopes must be in the project's `API_KEY_SCOPES`, or the create answers 403, and
// the line fails with that answer. The user is new, so it owns no row of the entity: a row
// the scorer reads with the key afterwards is one the second agent created.
//
// Imports nothing but node globals. Node 24 strips the types.

const MCP_PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 15_000;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function kebab(table: string): string {
  return table.replaceAll("_", "-");
}

/**
 * The read and write scopes `/openapi.json` states for one entity, sorted, with no delete
 * scope. A scope belongs to the entity when its resource is the table's name, in snake or
 * kebab case.
 */
export function entityScopes(doc: unknown, table: string): string[] {
  const names = new Set([table, kebab(table)]);
  const scopes = new Set<string>();
  const paths = isObject(doc) && isObject(doc.paths) ? doc.paths : {};
  for (const item of Object.values(paths)) {
    if (!isObject(item)) {
      continue;
    }
    for (const operation of Object.values(item)) {
      const agent = isObject(operation) ? operation["x-agent"] : undefined;
      const scope = isObject(agent) ? agent.scope : undefined;
      if (typeof scope !== "string") {
        continue;
      }
      const [resource = "", action = ""] = scope.split(":");
      if (names.has(resource) && action !== "" && action !== "delete") {
        scopes.add(scope);
      }
    }
  }
  return [...scopes].toSorted();
}

/** `["books:read", "books:write"]` as the key's scope: `{ books: ["read", "write"] }`. */
export function scopeObject(scopes: string[]): Record<string, string[]> {
  const scope: Record<string, string[]> = {};
  for (const pair of scopes) {
    const [resource = "", action = ""] = pair.split(":");
    (scope[resource] ??= []).push(action);
  }
  return scope;
}

/**
 * The rows in a list tool's structured content: an array itself, the first array value of
 * the object (`{ body: [...] }` for a route that answers an array), or the first array one
 * level below (`{ data: { items: [...] } }`). Undefined when it holds no array.
 */
export function rowsIn(content: unknown): unknown[] | undefined {
  if (Array.isArray(content)) {
    return content as unknown[];
  }
  if (!isObject(content)) {
    return undefined;
  }
  const values = Object.values(content);
  const top = values.find((value) => Array.isArray(value));
  if (top !== undefined) {
    return top as unknown[];
  }
  for (const value of values) {
    const below = isObject(value)
      ? Object.values(value).find((inner) => Array.isArray(inner))
      : undefined;
    if (below !== undefined) {
      return below as unknown[];
    }
  }
  return undefined;
}

interface ToolEvent {
  type?: string;
  message?: { content?: { type?: string; input?: unknown }[] };
}

/**
 * How many MCP `tools/call` requests the second agent's transcript holds. In a stream-json
 * transcript only tool inputs count (a command, a script it wrote), never its prose; a
 * plain-text line counts as written.
 */
export function mcpToolCalls(transcript: string): number {
  const count = (text: string) => text.split("tools/call").length - 1;
  let calls = 0;
  for (const line of transcript.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      continue;
    }
    const parsed = parseJson(trimmed);
    if (!isObject(parsed)) {
      calls += count(trimmed);
      continue;
    }
    const event = parsed as ToolEvent;
    if (event.type !== "assistant") {
      continue;
    }
    for (const block of event.message?.content ?? []) {
      if (block.type === "tool_use") {
        calls += count(JSON.stringify(block.input ?? {}));
      }
    }
  }
  return calls;
}

/** The id on the reply's last `READ BACK: <id>` line, without code quotes. */
export function readBackId(reply: string): string | undefined {
  const lines = [...reply.matchAll(/^\s*READ BACK:\s*`?([^`\s]+)`?\s*$/gm)];
  return lines.at(-1)?.[1];
}

// --- Requests against the running product ------------------------------------------

/** The JSON-RPC message in an MCP response: the body, or an event stream's last `data:`. */
function mcpMessage(body: string, contentType: string): unknown {
  if (!contentType.startsWith("text/event-stream")) {
    return parseJson(body);
  }
  return body
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => parseJson(line.slice("data:".length).trim()))
    .findLast((message) => message !== undefined);
}

async function mcp(
  api: string,
  key: string,
  id: number,
  method: string,
  params: Json
): Promise<{ status: number; message: unknown }> {
  const response = await fetch(`${api}/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": MCP_PROTOCOL_VERSION,
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const text = await response.text();
  return {
    status: response.status,
    message: mcpMessage(text, response.headers.get("content-type") ?? ""),
  };
}

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
}

async function answer(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `${String(response.status)} ${text.slice(0, 120)}`.trim();
}

export type Seeded = { key: string; scopes: string[] } | { problem: string };

/** Signs up a fresh user and issues it a key for one entity. See the header. */
export async function seedAgentKey(input: {
  api: string;
  appOrigin: string;
  table: string;
  email: string;
  password: string;
}): Promise<Seeded> {
  const { api, appOrigin, table, email, password } = input;
  try {
    const docResponse = await fetch(`${api}/openapi.json`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!docResponse.ok) {
      return { problem: `/openapi.json answered ${await answer(docResponse)}` };
    }
    const scopes = entityScopes(await docResponse.json(), table);
    if (scopes.length === 0) {
      return {
        problem: `/openapi.json states no \`${table}\` scope on a callable route`,
      };
    }
    const origin = { origin: appOrigin };
    const signUp = await postJson(
      `${api}/auth/sign-up/email`,
      { email, password, name: "Bench Agent Owner" },
      origin
    );
    if (!signUp.ok) {
      return { problem: `sign-up answered ${await answer(signUp)}` };
    }
    const signIn = await postJson(
      `${api}/auth/sign-in/email`,
      { email, password },
      origin
    );
    if (!signIn.ok) {
      return { problem: `sign-in answered ${await answer(signIn)}` };
    }
    const cookie = signIn.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    const create = await postJson(
      `${api}/auth/api-key/create`,
      {
        name: "agent-bench second agent",
        metadata: { scope: scopeObject(scopes) },
      },
      { ...origin, cookie }
    );
    if (!create.ok) {
      return {
        problem: `api-key/create returned ${await answer(create)}`,
      };
    }
    const created = (await create.json()) as { key?: unknown };
    return typeof created.key === "string"
      ? { key: created.key, scopes }
      : { problem: "api-key/create answered no `key`" };
  } catch (error) {
    return { problem: `a request failed: ${(error as Error).message}` };
  }
}

export type Read = { tool: string; rows: unknown[] } | { problem: string };

/**
 * Lists the tools with the key, takes the entity's read tool that needs no input (its list
 * route), calls it with the key, and returns its rows.
 */
export async function readEntityRows(
  api: string,
  key: string,
  table: string
): Promise<Read> {
  const reads = new Set([`${table}:read`, `${kebab(table)}:read`]);
  try {
    const listed = await mcp(api, key, 1, "tools/list", {});
    const result = isObject(listed.message) ? listed.message.result : undefined;
    if (listed.status !== 200 || !isObject(result)) {
      return { problem: `tools/list answered ${String(listed.status)}` };
    }
    const tools = Array.isArray(result.tools) ? result.tools : [];
    const tool = tools.find((candidate: unknown) => {
      if (!isObject(candidate)) {
        return false;
      }
      const meta = isObject(candidate._meta) ? candidate._meta : {};
      const schema = isObject(candidate.inputSchema)
        ? candidate.inputSchema
        : {};
      const required = Array.isArray(schema.required) ? schema.required : [];
      const scope = meta["saasaloy/scope"];
      return (
        typeof scope === "string" && reads.has(scope) && required.length === 0
      );
    }) as Json | undefined;
    if (!tool || typeof tool.name !== "string") {
      return { problem: `no read tool for ${table}:read that needs no input` };
    }
    const called = await mcp(api, key, 2, "tools/call", {
      name: tool.name,
      arguments: {},
    });
    const callResult = isObject(called.message)
      ? called.message.result
      : undefined;
    if (!isObject(callResult) || callResult.isError === true) {
      return {
        problem: `${tool.name} answered ${JSON.stringify(callResult ?? called.message).slice(0, 120)}`,
      };
    }
    const rows = rowsIn(callResult.structuredContent);
    return rows === undefined
      ? { problem: `${tool.name} answered no list of rows` }
      : { tool: tool.name, rows };
  } catch (error) {
    return { problem: `a request failed: ${(error as Error).message}` };
  }
}
