import { config } from "@repo/config";
import type { AgentEntry } from "../agent-entries";
import type { AgentSection } from "../llms";
import { joinUrl } from "../llms";

// `agent`'s entry in the web app's agent files, installed by `saasaloy add agent` at
// `apps/web/src/lib/agent-entries/agent.ts` and registered in `../agent-entries.ts`. It
// puts the api's MCP address, its OpenAPI document, its own `llms.txt` (every tool, with
// its scope) and the Server Card into the site's `/llms.txt`, under the description from
// `config.agent`. The paths match `AGENT_PATHS` in `apps/api/src/agent/discovery.ts`; the
// web app cannot import api code, so they are written out here.

/** The `## API for agents` section of `/llms.txt`, on `PUBLIC_API_URL`. */
export function agentApiEntry(): AgentEntry {
  return ({ apiUrl }): AgentSection => ({
    title: "API for agents",
    summary: config.agent.description,
    links: [
      {
        title: "MCP server",
        url: joinUrl(apiUrl, "/mcp"),
        note: "Streamable HTTP. Send `Authorization: Bearer <key>` on every request.",
      },
      {
        title: "OpenAPI document",
        url: joinUrl(apiUrl, "/openapi.json"),
        note: "every tool as an HTTP operation, with its input and output schemas.",
      },
      {
        title: "API llms.txt",
        url: joinUrl(apiUrl, "/llms.txt"),
        note: "every tool, the scope it needs, and whether it writes.",
      },
      {
        title: "MCP Server Card",
        url: joinUrl(apiUrl, "/mcp/server-card"),
        note: "the connection details as JSON.",
      },
    ],
    full: [
      "A person makes an API key in the product and gives it to you. Send it as `Authorization: Bearer <key>`. A request with no key gets 401 `unauthorized`.",
      "",
      'A key holds scopes written `resource:action`, such as `notes:read`. A tool that needs a scope the key lacks answers 403 `forbidden` and names the missing scope. Every error has the body `{ "error": { "code", "message" } }`.',
    ].join("\n"),
  });
}
