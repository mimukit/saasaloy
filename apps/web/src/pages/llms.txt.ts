// /llms.txt, prerendered at build time from the repo root's `llms.txt`, the file an AI
// agent reads first when it wants to build a product with Saasaloy. Vite inlines the
// file through `?raw`, so the site serves the same bytes the repo holds and the two
// cannot drift; a change to the root file reaches the site on its next build. turbo.json
// lists the root file as a build input, so a cached build does not serve an old copy.

import type { APIRoute } from "astro";
import llms from "../../../../llms.txt?raw";

export const GET: APIRoute = () =>
  new Response(llms, {
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
