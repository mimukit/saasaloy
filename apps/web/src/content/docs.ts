// The words the docs shell shows around a wiki page. The pages' own prose lives in
// docs/wiki/, and the sidebar titles live in docs/wiki/.wikimap.yaml, so this file holds only
// the chrome: the search control, the menus, the links under a title and the previous and
// next labels. A `{token}` is replaced by lib/interpolate.ts.

export const docsUi = {
  /** The docs root's tab title. */
  rootTitle: "{siteName} docs: an open source SaaS starter kit for Cloudflare",
  /** A page's tab title, when it fits the length a search result shows. */
  title: "{page} | {siteName} docs: SaaS starter kit",
  /** A page's tab title, when `title` would be cut in a search result. */
  shortTitle: "{page} | Docs | {siteName}",
  /** A module page's `{page}` in its tab title. */
  moduleTitle: "{name} module",
  /** Added to a module page's meta description when its first paragraph is short. */
  moduleDescription:
    "A {siteName} {tier} module. Add it to a project with saasaloy add {name}.",
  /** The tag after the wordmark in the header, a link to the docs home. */
  headerTag: "Docs",
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
    /** The key hint in the search field: `shortcut` by default, `shortcutApple` on a Mac. */
    shortcut: "Ctrl K",
    shortcutApple: "⌘K",
  },
  copy: {
    label: "Copy",
    copied: "Copied",
    announcement: "Copied to the clipboard.",
  },
} as const;
