import type { APIRoute } from "astro";
import { agentDocument } from "../lib/agent-document";
import { llmsFullTxt } from "../lib/llms";

// `/llms-full.txt`: everything `/llms.txt` links, written out in one file, so an agent
// reads the whole site in one request. Built at build time.
export const GET: APIRoute = () =>
  new Response(llmsFullTxt(agentDocument()), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
