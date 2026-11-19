// The remark plugin that makes a wiki page's links work on the site. The wiki is plain
// Markdown that reads correctly on GitHub, so its links are relative to the file. On the site:
//
//   - a link to another wiki page becomes its `/docs/...` URL;
//   - a link to any other file in the repo (`../adr/...`, `../../CONTEXT.md`) becomes a
//     `github.com/mimukit/saasaloy/blob/v<version>/...` URL at the release tag, as
//     scripts/build-cli-readme.ts does for the npm README;
//   - a link to a wiki page that does not exist fails the build.
//
// The rewrite itself is a pure function (`rewriteDocLink`) so a node:test file can hold it.
// The plugin is a plain remark plugin with no dependency, and it is the first of the
// docs pipeline's plugins: astro.config.mjs lists it in `markdown.remarkPlugins`, and a later
// plugin (the `saasaloy-*` interactive blocks, plan 0114 Phase 4) goes beside it there.

import { existsSync } from "node:fs";
import { posix, relative, resolve, sep } from "node:path";

import { pageUrl } from "./docs-slug.ts";

export interface LinkContext {
  /** The page holding the link, relative to the repo root, `/`-separated. */
  fromFile: string;
  /** The CLI version, such as `0.9.0`. Other repo files link at the tag `v<version>`. */
  version: string;
  /** Whether the wiki page at this repo-relative path exists. */
  hasPage: (repoPath: string) => boolean;
  /**
   * What a wiki link becomes. `html` (the default) gives the page's path, `/docs/<slug>`.
   * `markdown` gives the page's raw Markdown path, `/docs/<slug>.md`, for the raw routes.
   */
  target?: "html" | "markdown";
}

/** The repo's GitHub home. Kept here so the plugin needs no import from the site. */
export const REPO_URL = "https://github.com/mimukit/saasaloy";

const WIKI_DIR = "docs/wiki/";

/** Whether a link target already stands on its own: a URL, an anchor, a root path. */
export function isStandalone(link: string): boolean {
  return (
    link === "" ||
    link.startsWith("#") ||
    link.startsWith("/") ||
    /^[a-z][a-z0-9+.-]*:/i.test(link)
  );
}

/**
 * The link as the site serves it.
 *
 * Throws on a link to a wiki page that does not exist, and on a relative link that climbs
 * out of the repo.
 */
export function rewriteDocLink(link: string, context: LinkContext): string {
  if (isStandalone(link)) {
    return link;
  }
  const hashAt = link.search(/[?#]/);
  const target = hashAt === -1 ? link : link.slice(0, hashAt);
  const suffix = hashAt === -1 ? "" : link.slice(hashAt);
  const repoPath = posix.normalize(
    posix.join(posix.dirname(context.fromFile), decodeURI(target))
  );
  if (repoPath === ".." || repoPath.startsWith("../")) {
    throw new Error(
      `docs: ${context.fromFile} links to ${link}, which is outside the repository.`
    );
  }
  if (repoPath.startsWith(WIKI_DIR) && repoPath.endsWith(".md")) {
    if (!context.hasPage(repoPath)) {
      throw new Error(
        `docs: ${context.fromFile} links to ${link}, but ${repoPath} is not a wiki page.`
      );
    }
    const url = pageUrl(repoPath.slice(WIKI_DIR.length));
    if (context.target === "markdown") {
      return `${url === "/docs" ? "/docs/index" : url}.md${suffix}`;
    }
    return url + suffix;
  }
  return `${REPO_URL}/blob/v${context.version}/${repoPath}${suffix}`;
}

/**
 * The raw Markdown of a wiki page with every relative link made absolute, for the raw
 * routes and `/llms-full.txt`. A reader of `/docs/x.md` has no file tree to resolve `../y.md`
 * against, so a wiki link becomes `<origin>/docs/<slug>.md` and any other repo file becomes
 * its GitHub URL at the release tag. Inline links only, and none inside a code fence.
 */
export function absolutizeMarkdown(
  markdown: string,
  context: Omit<LinkContext, "target">,
  origin: string
): string {
  let fenced = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        fenced = !fenced;
        return line;
      }
      if (fenced) {
        return line;
      }
      return line.replaceAll(
        /\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g,
        (_whole, href: string, title: string) => {
          const out = rewriteDocLink(href, { ...context, target: "markdown" });
          return `](${out.startsWith("/") ? origin + out : out}${title})`;
        }
      );
    })
    .join("\n");
}

interface MdastNode {
  type: string;
  url?: string;
  children?: MdastNode[];
}

/**
 * Every `link`, `image` and `definition` node under `node`, `node` included.
 *
 * @yields {MdastNode} each node that carries a `url`.
 */
function* urlNodes(node: MdastNode): Generator<MdastNode> {
  if (
    (node.type === "link" ||
      node.type === "image" ||
      node.type === "definition") &&
    node.url !== undefined
  ) {
    yield node;
  }
  for (const child of node.children ?? []) {
    yield* urlNodes(child);
  }
}

export interface RemarkDocsLinksOptions {
  /** Absolute path of the repo root. */
  repoRoot: string;
  /** The CLI version, read from packages/cli/package.json. */
  version: string;
}

/** The remark plugin. A file outside `docs/wiki/` passes through untouched. */
export function remarkDocsLinks(options: RemarkDocsLinksOptions) {
  const { repoRoot, version } = options;
  return (tree: MdastNode, file: { path?: string }): void => {
    if (file.path === undefined) {
      return;
    }
    const fromFile = relative(repoRoot, file.path).split(sep).join("/");
    if (!fromFile.startsWith(WIKI_DIR)) {
      return;
    }
    const context: LinkContext = {
      fromFile,
      version,
      hasPage: (repoPath) => existsSync(resolve(repoRoot, repoPath)),
    };
    for (const node of urlNodes(tree)) {
      if (node.url !== undefined) {
        node.url = rewriteDocLink(node.url, context);
      }
    }
  };
}
