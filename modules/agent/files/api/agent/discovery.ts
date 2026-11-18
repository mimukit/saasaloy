import { config } from "@repo/config";
import { SUPPORTED_PROTOCOL_VERSIONS } from "@modelcontextprotocol/server";
import type { AgentTool } from "./document";

// The two documents an agent reads before it connects: `llms.txt` on the api origin, and
// the MCP Server Card at `/mcp/server-card`. Both are built from the request's own origin,
// so each deployment names its own address, and from the `agent` config section.

/** Where each surface lives, relative to the api origin. */
export const AGENT_PATHS = {
  llms: "/llms.txt",
  mcp: "/mcp",
  openapi: "/openapi.json",
  serverCard: "/mcp/server-card",
} as const;

/** One tool's line: name, what it does, the scope it needs, and its marks. */
function toolLine(tool: AgentTool): string {
  const marks = [
    tool.agent.scope === null
      ? "public, any key"
      : `needs scope \`${tool.agent.scope}\``,
    tool.agent.readOnly ? "read only" : "writes",
    ...(tool.agent.confirm ? ["ask the user to confirm first"] : []),
  ];
  return `- \`${tool.name}\` (${tool.method} ${tool.path}): ${tool.description} (${marks.join("; ")})`;
}

/**
 * `llms.txt` for the api origin, in the llmstxt.org shape: a title, a one-line summary,
 * then sections of links and notes. It names the OpenAPI document, the MCP address, how
 * to sign in with a key, and each tool.
 */
export function llmsText(origin: string, tools: readonly AgentTool[]): string {
  const url = (path: string) => `${origin}${path}`;
  return [
    `# ${config.app.name} api`,
    "",
    `> ${config.agent.description}`,
    "",
    'Every action here is one api route. Call it as an MCP tool or as plain HTTP; both run the same route, with the same checks and the same error body: `{ "error": { "code", "message" } }`.',
    "",
    "## Connect",
    "",
    `- [MCP server](${url(AGENT_PATHS.mcp)}): Streamable HTTP. Send \`Authorization: Bearer <key>\` on every request.`,
    `- [OpenAPI document](${url(AGENT_PATHS.openapi)}): every tool as an HTTP operation, with its input and output schemas.`,
    `- [MCP Server Card](${url(AGENT_PATHS.serverCard)}): the connection details as JSON.`,
    "",
    "## Sign in with a key",
    "",
    "A person makes an API key in the product and gives it to you. Send it as `Authorization: Bearer <key>`. A request with no key gets 401 `unauthorized`. A key holds scopes written `resource:action`, such as `notes:read`; a tool that needs a scope the key lacks answers 403 `forbidden` and names the missing scope. Each delete is its own scope, off unless the person turned it on.",
    "",
    "## Tools",
    "",
    ...(tools.length === 0
      ? ["No tool is open to agents yet."]
      : tools.map(toolLine)),
    "",
  ].join("\n");
}

/**
 * A reverse-DNS server name for the card, from the api hostname: `api.example.com`
 * becomes `com.example.api/mcp`. `localhost` stays `localhost/mcp`.
 */
function serverName(origin: string): string {
  const host = new URL(origin).hostname.replaceAll(/[^a-zA-Z0-9.-]/g, "");
  return `${host.split(".").toReversed().join(".") || "localhost"}/mcp`;
}

/**
 * The MCP Server Card (SEP-2127, schema v1). It says where to connect and how, and
 * carries no tool list, by the extension's design: tools come from `tools/list`.
 */
export function serverCard(origin: string) {
  const { description } = config.agent;
  return {
    $schema:
      "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    description:
      description.length > 100 ? `${description.slice(0, 99)}…` : description,
    name: serverName(origin),
    remotes: [
      {
        headers: [
          {
            description:
              "An API key from the product, sent as `Bearer <key>`. Its scopes limit what it may call.",
            isRequired: true,
            isSecret: true,
            name: "Authorization",
          },
        ],
        // The SDK's own list: the current revision and the older `initialize` handshakes.
        supportedProtocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        type: "streamable-http" as const,
        url: `${origin}${AGENT_PATHS.mcp}`,
      },
    ],
    title: config.app.name.slice(0, 100),
    version: config.agent.version,
  };
}
