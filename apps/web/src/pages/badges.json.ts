import type { APIRoute } from "astro";

// Count descriptors, including providers and drivers, rather than catalog tiles.
const descriptors = import.meta.glob(
  "../../../../modules/*/registry-item.json"
);

export const prerender = true;

export const GET: APIRoute = () =>
  Response.json({ modules: Object.keys(descriptors).length });
