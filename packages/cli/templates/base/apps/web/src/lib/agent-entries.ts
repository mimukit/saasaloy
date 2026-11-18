import type { AgentContext, AgentSection } from "./llms";

/** One registered entry: given this deployment's origins, the section it adds. */
export type AgentEntry = (context: AgentContext) => AgentSection;

/** Identity, so `agentEntries` keeps the call shape the `plugin-array` codemod reads. */
function defineAgentEntries(config: { entries: AgentEntry[] }) {
  return config;
}

// The registration table for the public files for agents: `/llms.txt` and
// `/llms-full.txt`. Each entry adds one `##` section of links, after the site's own pages.
//
// A module appends a factory call here with a `plugin-array` patch (`exportName:
// "agentEntries"`, `arrayProp: "entries"`), from a file it ships at
// `src/lib/agent-entries/<module>.ts`. The call returns an `AgentEntry`. `agent` adds the
// api's MCP address, its OpenAPI document and its own `llms.txt`; `cms` adds the blog.
// `saasaloy remove` takes the call and its import back out. Keep the line in this exact
// shape and never omit `entries`, even while it is empty.
//
// A section of your own goes here too: write the factory in `./agent-entries/` and add
// the call to the array.
export const agentEntries = defineAgentEntries({ entries: [] });
