import { defineSection } from "@repo/config/define";

// `agent`'s config section, installed by `saasaloy add agent`.
//
// What the product tells an agent about itself. The OpenAPI document, the MCP server's
// instructions, the Server Card and `llms.txt` on the api origin all read it, so one edit
// in `packages/config/src/project.ts` changes every agent surface at once.
//
// These are `config` values and not `env` values: two deployments of the same product
// describe it the same way. The api's address is per deployment, so it is not here; each
// surface takes it from the request it answers.

/** The `agent` section. Override either value in `packages/config/src/project.ts`. */
export function agentConfig() {
  return defineSection("agent", {
    /**
     * One or two sentences on what the product does, written for an agent that has to
     * decide whether to use it. The Server Card shows the first 100 characters, so lead
     * with the point. Replace it with your own in `project.ts`.
     */
    description:
      "This product's api for agents: call its tools over MCP or HTTP with a key.",
    /**
     * The version the OpenAPI document, the MCP server and the Server Card report. Raise
     * it when a tool changes its input or its output, so an agent knows to list again.
     */
    version: "1.0.0",
  });
}
