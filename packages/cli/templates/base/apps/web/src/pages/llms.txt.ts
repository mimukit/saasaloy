import type { APIRoute } from "astro";
import { agentDocument } from "../lib/agent-document";
import { llmsTxt } from "../lib/llms";

// `/llms.txt`, the index an agent reads first: the site's summary, a link to the Markdown
// copy of each public page, and one section per entry in src/lib/agent-entries.ts. Built
// at build time; the static host serves a `.txt` file as `text/plain`. The rules live in
// src/lib/llms.ts and src/lib/agent-document.ts.
export const GET: APIRoute = () =>
  new Response(llmsTxt(agentDocument()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
