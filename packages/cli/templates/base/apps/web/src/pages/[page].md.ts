import type { APIRoute, GetStaticPaths } from "astro";
import { publicPages } from "../lib/agent-document";

// The Markdown copy of each public page: `/index.md`, `/privacy.md`, `/terms.md`. One file
// per element of `publicPages` in src/lib/agent-document.ts, built at build time. The
// static host serves a `.md` file as `text/markdown`.
export const getStaticPaths = (() =>
  publicPages.map((page) => ({
    params: { page: page.slug },
    props: { markdown: page.markdown() },
  }))) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(String(props.markdown), {
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
