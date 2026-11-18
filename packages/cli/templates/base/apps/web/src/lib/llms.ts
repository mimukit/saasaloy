// The public files for agents, kept apart from the routes so a test can call them: a `.ts`
// file in src/pages/ is itself a route.
//
// `/llms.txt` follows the llmstxt.org shape: a title, a one-line summary, then `##`
// sections of links. It links the Markdown copy of each public page, then one section per
// entry in the registration table (./agent-entries.ts), then `/llms-full.txt`, which holds
// the same pages and entries written out in one file. All of it is built at build time.
//
// The JSON-LD for the organization and the site is built here too, from `@repo/config`
// values the layout passes in.

/** What an entry is built from: the two origins of this deployment. */
export interface AgentContext {
  /** This site's origin, `PUBLIC_SITE_URL`. */
  site: URL;
  /** The api's origin, `PUBLIC_API_URL`. */
  apiUrl: string;
}

/** One link line: `- [title](url): note`. */
export interface AgentLink {
  title: string;
  /** Absolute. */
  url: string;
  note?: string;
}

/** One `##` section of `llms.txt`, which a registered entry returns. */
export interface AgentSection {
  title: string;
  /** One line under the heading. */
  summary?: string;
  links: AgentLink[];
  /** Markdown that `llms-full.txt` adds under the section's links. */
  full?: string;
}

/** A public page and its Markdown copy. */
export interface PublicPageDoc {
  title: string;
  /** The Markdown copy's path on the site, such as `/index.md`. */
  path: string;
  markdown: string;
}

/** Everything both files are built from. */
export interface AgentDocument {
  name: string;
  summary: string;
  site: URL;
  pages: PublicPageDoc[];
  sections: AgentSection[];
}

/** `base` and `path` with one slash between them. A path prefix on `base` stays. */
export function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function linkLine(link: AgentLink): string {
  return `- [${link.title}](${link.url})${link.note ? `: ${link.note}` : ""}`;
}

function sectionLines(section: AgentSection): string[] {
  return [
    `## ${section.title}`,
    "",
    ...(section.summary ? [section.summary, ""] : []),
    ...section.links.map(linkLine),
    "",
  ];
}

/** The sections with at least one link; an entry with none adds nothing. */
function linkedSections(doc: AgentDocument): AgentSection[] {
  return doc.sections.filter((section) => section.links.length > 0);
}

function header(doc: AgentDocument): string[] {
  return [`# ${doc.name}`, "", `> ${doc.summary}`, ""];
}

/** `/llms.txt`. */
export function llmsTxt(doc: AgentDocument): string {
  return [
    ...header(doc),
    "## Pages",
    "",
    ...doc.pages.map((page) =>
      linkLine({ title: page.title, url: new URL(page.path, doc.site).href })
    ),
    "",
    ...linkedSections(doc).flatMap(sectionLines),
    "## Optional",
    "",
    linkLine({
      title: "Full text",
      url: new URL("/llms-full.txt", doc.site).href,
      note: "every page above, and every section, in one file.",
    }),
    "",
  ].join("\n");
}

/** `/llms-full.txt`: the summary, each page's Markdown, then each section in full. */
export function llmsFullTxt(doc: AgentDocument): string {
  const pages = doc.pages.flatMap((page) => [
    "---",
    "",
    `Source: ${new URL(page.path, doc.site).href}`,
    "",
    page.markdown.trim(),
    "",
  ]);
  const sections = linkedSections(doc).flatMap((section) => [
    "---",
    "",
    ...sectionLines(section),
    ...(section.full ? [section.full.trim(), ""] : []),
  ]);
  return [...header(doc), ...pages, ...sections].join("\n");
}

/**
 * The JSON-LD for the organization and the site, as one `@graph`, for a
 * `<script type="application/ld+json">`. Every `<` is escaped, so no value can close the
 * script element.
 */
export function siteJsonLd(args: {
  name: string;
  site: URL;
  logoPath: string;
  description: string;
}): string {
  const url = new URL("/", args.site).href;
  const organization = `${url}#organization`;
  return JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": organization,
        name: args.name,
        url,
        logo: new URL(args.logoPath, args.site).href,
      },
      {
        "@type": "WebSite",
        "@id": `${url}#website`,
        name: args.name,
        url,
        description: args.description,
        publisher: { "@id": organization },
      },
    ],
  }).replaceAll("<", String.raw`\u003c`);
}
