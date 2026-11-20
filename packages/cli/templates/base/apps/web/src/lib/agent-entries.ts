import { webAgentEntries } from "./agent-entries.generated";
import type { AgentContext, AgentSection } from "./llms";

/** One registered entry: given this deployment's origins, the section it adds. */
export type AgentEntry = (context: AgentContext) => AgentSection;

/** Identity: it types the entries and gives the registry one place to read them. */
function defineAgentEntries(config: { entries: AgentEntry[] }) {
  return config;
}

// The registration table for the public files for agents: `/llms.txt` and
// `/llms-full.txt`. Each entry adds one `##` section of links, after the site's own pages.
//
// A module adds a factory call to `./agent-entries.generated.ts`, which the CLI writes on
// every run, from a file it ships at `src/lib/agent-entries/<module>.ts`. The call returns
// an `AgentEntry`. `agent` adds the api's MCP address, its OpenAPI document and its own
// `llms.txt`; `cms` adds the blog. `saasaloy remove` takes the call back out.
//
// A section of your own goes here too: write the factory in `./agent-entries/` and add
// the call after the spread.
export const agentEntries = defineAgentEntries({
  entries: [...webAgentEntries],
});
