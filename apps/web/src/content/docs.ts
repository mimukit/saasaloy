// The words the docs shell shows around a wiki page. The pages' own prose lives in
// docs/wiki/, and the sidebar titles live in docs/wiki/.wikimap.yaml, so this file holds only
// the chrome: the search control, the menus, the links under a title and the previous and
// next labels. A `{token}` is replaced by lib/interpolate.ts.

export const docsUi = {
  /** The Docs title in the page's tab: `{page} | Docs | {siteName}`. */
  titleSuffix: "Docs",
  breadcrumbLabel: "Breadcrumb",
  breadcrumbRoot: "docs",
  sidebarLabel: "Docs pages",
  /** The disclosure that holds the sidebar below the `lg` width. */
  menuLabel: "Docs menu",
  tocLabel: "On this page",
  /** The tag after the title on a module page: the module's tier. */
  tierLabel: "Tier",
  editOnGithub: "Edit on GitHub",
  /** A generated page has no hand edit, so its link says view. */
  viewOnGithub: "View on GitHub",
  rawMarkdown: "Markdown",
  /** The CLI version in the page header. `{version}` is the number without the `v`. */
  versionLabel: "saasaloy v{version}",
  /** A page's stamp. `{sha}` is the short commit, and the label links to it. */
  verifiedLabel: "Verified against {sha}",
  previous: "Previous",
  next: "Next",
  /** The landmark around the previous and next links. */
  pagerLabel: "Previous and next pages",
  /** `{count}` is the number of module pages the sidebar folds away. */
  moreModules: "+{count} more",
  /** The module names the sidebar always shows. A name the wiki lacks drops out. */
  featuredModules: ["api", "auth", "database", "email", "payment", "teams"],
  search: {
    /** The field's text and the button's accessible name. */
    placeholder: "Search docs",
    openLabel: "Search the docs",
    dialogLabel: "Search the docs",
    inputLabel: "Search",
    closeLabel: "Close search",
    closeKey: "Esc",
    resultsLabel: "Search results",
    hintMove: "move",
    hintOpen: "open",
    hintClose: "close",
    empty: "No page matches {query}.",
    /** Read out by a screen reader when results arrive. `{count}` is the number shown. */
    foundOne: "1 result.",
    found: "{count} results.",
    /** `astro dev` has no search index, because Pagefind runs after `astro build`. */
    unavailable: "Search has no index here. Build the site to create it.",
    shortcutKey: "/",
  },
  copy: {
    label: "Copy",
    copied: "Copied",
    announcement: "Copied to the clipboard.",
  },
} as const;
