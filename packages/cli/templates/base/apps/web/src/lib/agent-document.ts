import { config } from "@repo/config";
import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { webEnv } from "@web/env";
import * as privacy from "../legal/privacy.md";
import * as terms from "../legal/terms.md";
import { agentEntries } from "./agent-entries";
import { landingMarkdown } from "./landing-markdown";
import type { AgentDocument, PublicPageDoc } from "./llms";

// What `/llms.txt`, `/llms-full.txt` and each Markdown copy are built from, read at build
// time. The site's own pages come first, then one section per entry in
// `./agent-entries.ts`.
//
// The legal pages are Markdown at `src/legal/`, so the page and its Markdown copy read one
// source. Write your own policy there; `src/pages/privacy.astro` and `terms.astro` render
// it. A new public page joins the agent files with one more element in `publicPages`.

/** The fill for `{siteName}`, the one token the page sources use. */
function fill(message: string): string {
  return interpolate(message, { siteName: config.app.name });
}

/** A legal page's Markdown file, as Astro's Markdown import gives it. */
interface LegalFile {
  frontmatter: Record<string, unknown>;
  rawContent: () => string;
  compiledContent: () => Promise<string>;
}

/** A page's title from its frontmatter, or `fallback`. */
function titleOf(file: LegalFile, fallback: string): string {
  const { title } = file.frontmatter;
  return typeof title === "string" && title !== "" ? title : fallback;
}

/** One public page with a Markdown copy at `/<slug>.md`. */
export interface PublicPage {
  slug: string;
  title: string;
  markdown: () => string;
}

function legalPage(
  slug: string,
  file: LegalFile,
  fallback: string
): PublicPage {
  return {
    slug,
    title: titleOf(file, fallback),
    markdown: () => `${fill(file.rawContent()).trim()}\n`,
  };
}

/** Every public page with a Markdown copy, in the order `llms.txt` lists them. */
export const publicPages: PublicPage[] = [
  {
    slug: "index",
    title: fill(landing.meta.title),
    markdown: () => landingMarkdown(landing, config.app.name),
  },
  legalPage("privacy", privacy, "Privacy Policy"),
  legalPage("terms", terms, "Terms of Service"),
];

/** A legal page's body as HTML, `{siteName}` filled, for the `.astro` page to render. */
export async function legalHtml(slug: "privacy" | "terms"): Promise<string> {
  const file: LegalFile = slug === "privacy" ? privacy : terms;
  const html = await file.compiledContent();
  return interpolate(html, { siteName: escapeHtml(config.app.name) });
}

/** A legal page's title, for the `.astro` page's `<title>`. */
export function legalTitle(slug: "privacy" | "terms"): string {
  return slug === "privacy"
    ? titleOf(privacy, "Privacy Policy")
    : titleOf(terms, "Terms of Service");
}

function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** The whole document, for this deployment's origins. */
export function agentDocument(): AgentDocument {
  const env = webEnv();
  const site = new URL(env.PUBLIC_SITE_URL);
  const context = { site, apiUrl: env.PUBLIC_API_URL };
  const pages: PublicPageDoc[] = publicPages.map((page) => ({
    title: page.title,
    path: `/${page.slug}.md`,
    markdown: page.markdown(),
  }));
  return {
    name: config.app.name,
    summary: fill(landing.meta.description),
    site,
    pages,
    sections: agentEntries.entries.map((entry) => entry(context)),
  };
}
