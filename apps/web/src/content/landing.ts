// Every word the landing page shows, in one file.
//
// The blocks in ../blocks/*.tsx import this directly — NOT through props from
// index.astro. Astro serializes island props, so feeding a content object into
// `<Navbar client:idle />` would write every string into the HTML payload *and*
// still ship the defaults inside the island's bundle. A direct import keeps the static
// blocks at zero JavaScript.
//
// TWO NAMESPACES, and the split is the point:
//
//   landing.*  Marketing copy — what the product is and how a project grows.
//              This is the surface a copywriting agent rewrites. Own it, edit it freely.
//   ui.*       Chrome and accessibility labels — "Copy", "Close menu", "Skip to content".
//              Nothing here says anything about the product, so a copy pass never
//              *rewrites* it. It does get *translated*, key for key, when landing.* is
//              written in some language other than English — otherwise the page ships
//              Bangla marketing copy under an English "Copied" label.
//
// SHAPE RULES. These are not style preferences; each one keeps this file mechanically
// translatable, because a translation layer reads a keyed record and nothing else:
//
//   1. Max three levels below a namespace (`landing.faq.title`). Compiler-based
//      i18n libraries emit one flat identifier per message and cannot see deeper nesting.
//   2. Position is never the key. Lists are arrays whose items carry a stable `id`, so
//      reordering the FAQ cannot silently reattach the wrong translation.
//   3. Placeholders are single-brace `{token}`, never a template literal. A catalog is
//      data; a function is not serializable and no extraction tool can read it. Render
//      them with `interpolate()` from ../lib/interpolate.ts.
//   4. No runtime concatenation. A sentence with a value in it is one message with a
//      `{token}` (`ui.commandField.copyLabel`), because word order does not survive the
//      seam in every language.
//   5. Only user-visible strings live here. Section `id`s and the same-page anchors that
//      point at them are structure and stay in the block. A few things break that rule,
//      all for the same reason — a thing rewritten *with* the copy belongs *near* the
//      copy, or a rewrite leaves it stranded:
//        a. Every outbound link — the docs, the repository, the changelog and the
//           license. They leave the page, so they cannot break a section link, and the
//           person being interviewed about the product is the only one who knows the URL.
//           An empty `*Href` hides its link.
//        b. Code the page quotes — terminal commands, module names, file paths, an `.env`
//           line. They are not prose and no translation touches them.
//      A translation layer reads `id`, every `*Href` and the quoted code as non-message
//      data.
//
// Inline code: a pair of backticks inside a message (`saasaloy add`) renders as <code>.
// Translators keep the backticked part as is.
//
// The brand is not in this file. `{siteName}` comes from ../site.ts.
//
// One chrome string set deliberately lives elsewhere: the theme toggle's labels, in
// ../lib/theme.ts. That file is inlined verbatim into a pre-paint <script> and is
// declared import-free on purpose, so it keeps its own constants.

// The project's own links, in one place so the copy below stays readable.
import { repoUrl } from "@web/site";

const REPO = repoUrl;
const DOCS = `${REPO}/blob/main/docs/wiki`;

/** Marketing copy. The whole of what a landing-copy pass may rewrite. */
export const landing = {
  // The browser tab, the meta description and the link preview. `{siteName}` comes from
  // ../site.ts. `imageAlt` describes public/og.png, the preview image.
  meta: {
    // Both lines repeat claims from the README's opening paragraph. Keep the
    // description under about 155 characters, where Google cuts a snippet.
    title: "{siteName}: an open source SaaS starter kit for Cloudflare",
    description:
      "{siteName} is an open source SaaS starter kit for Cloudflare. Start with a landing page, then add the API, database, auth and more as source files you own.",
    imageAlt:
      "The {siteName} wordmark beside a module map: api, auth, database, email and payment.",
  },

  // Header. Every navbar link leaves the page, so each one opens in a new tab through
  // externalLinkProps (shape rule 5a). An empty label hides its link.
  navbar: {
    links: [
      { id: "docs", label: "Docs", href: `${DOCS}/index.md` },
      { id: "github", label: "GitHub", href: REPO },
      { id: "guide", label: "Guide", href: `${DOCS}/getting-started.md` },
    ],
  },

  // The hero. The title is two sentences: the first renders in `foreground`, the second
  // in `highlight`. `command` is the command field's text (5b). Every link leaves the page
  // (5a). `note` is the proof-of-concept line, which stays visible (README, WARNING).
  // `{version}` is the CLI version, read from packages/cli/package.json at build time.
  // `description` names the category, because the title does not.
  hero: {
    titleLead: "A landing page today.",
    titleAccent: "Your next module tomorrow.",
    description:
      "An open source SaaS starter kit for Cloudflare. Start small, and add each module as source files you own.",
    command: "npx saasaloy init my-app",
    links: [
      {
        id: "getting-started",
        label: "Getting started",
        href: `${DOCS}/getting-started.md`,
      },
      { id: "github", label: "GitHub", href: REPO },
    ],
    note: "Version {version}. Proof of concept. Not for production use yet.",
  },

  // The problem section (plan 0092). `title` and `description` repeat README line 23,
  // whose "billing" is the word a boilerplate uses, not a module name. `contrast` sits in
  // the bordered block under them.
  problem: {
    title: "Boilerplates make you delete code for a week.",
    description:
      "You clone one and inherit forty features, twelve environment variables and someone else's opinions about billing.",
    contrast:
      "A boilerplate gives you forty features on day one. Saasaloy gives you one, and adds the next when the product needs it.",
  },

  // The built-on section (plan 0092). The chips name every part of the drawing, which
  // is aria-hidden, so the names stay readable and searchable. Each name is a framework,
  // library or tool from the README stack table (5b), shown as is. The page names no
  // hosting vendor here: the providers section says where a project runs.
  builtOn: {
    title: "Built on tools you already know.",
    description:
      "Astro, TanStack Router and Hono for the apps, Drizzle and Better Auth for data and sign-in, all in one Turborepo monorepo.",
    groups: [
      {
        id: "frameworks",
        label: "Frameworks",
        items: [
          { id: "astro", label: "Astro" },
          { id: "tanstack-router", label: "TanStack Router" },
          { id: "vite", label: "Vite" },
          { id: "hono", label: "Hono" },
        ],
      },
      {
        id: "libraries",
        label: "Libraries and tools",
        items: [
          { id: "drizzle", label: "Drizzle" },
          { id: "better-auth", label: "Better Auth" },
          { id: "postgres", label: "Postgres" },
          { id: "turborepo", label: "Turborepo" },
          { id: "pnpm", label: "pnpm" },
        ],
      },
    ],
  },

  // The stages. Each stage names the command that adds it (5b) and links to its docs
  // (5a): the landing page to the getting started guide, every other stage to its
  // module's row in the modules page. The row link uses a text fragment, because a
  // Markdown table row has no anchor; a browser without text fragments opens the page
  // at the top. The page never says `billing`: payments come from the `payment` module.
  stages: {
    title: "Add code when the product needs it.",
    description: "Each module adds source files to your repository.",
    items: [
      {
        id: "landing",
        title: "Landing page",
        command: "init",
        description: "Start with an Astro landing page and a UI package.",
        href: `${DOCS}/getting-started.md`,
      },
      {
        id: "waitlist",
        title: "Waitlist",
        command: "add waitlist",
        description: "Add a waitlist to collect early interest.",
        href: `${DOCS}/modules.md#:~:text=a%20waitlist%20form%20plus%20its%20API%20route`,
      },
      {
        id: "auth",
        title: "Sign-in",
        command: "add auth",
        description: "Add auth so people can sign in as registered users.",
        href: `${DOCS}/modules.md#:~:text=workspace%20wrapping%20Better%20Auth`,
      },
      {
        id: "teams",
        title: "Teams",
        command: "add teams",
        description: "Add teams when users ask for a team account.",
        href: `${DOCS}/modules.md#:~:text=Better%20Auth%20organizations%2C%20memberships`,
      },
      {
        id: "payment",
        title: "Payments",
        command: "add payment",
        description: "Add payments when someone wants to pay.",
        href: `${DOCS}/modules.md#:~:text=workspace%20with%20the%20provider%20contract%2C%20the%20status%20machine`,
      },
    ],
  },

  // The module catalog. The rows are not copy: the page reads them from
  // modules/*/registry-item.json at build time, so a renamed or new module needs no edit
  // here. These are the words around the rows. An empty `description` hides the lead.
  // `{total}` and the tier tokens in `counts` are module counts, read from the registry
  // at build time. A tab is a registry `stage`; `variants` labels the provider and driver
  // chips on a tile.
  catalog: {
    title: "Choose the modules you need.",
    description:
      "{total} modules, and each one adds its source files to your repository. You read and edit every line it writes.",
    counts:
      "{capability} capabilities · {feature} features · {provider} providers · {driver} drivers",
    filterLabel: "Filter modules by stage",
    tabs: {
      all: "All",
      validate: "Validate",
      mvp: "MVP",
      teams: "Teams",
      money: "Money",
      scale: "Scale",
    },
    tiers: {
      capability: "Capability",
      feature: "Feature",
      provider: "Provider",
      driver: "Driver",
    },
    variants: {
      provider: "Providers",
      driver: "Drivers",
    },
    showAll: "Show all modules",
  },

  // The providers. `description` is the lead under the title. `envExample` is the `.env`
  // line the panel shows (5b). Each point is a title and a sentence; the drawing beside
  // them repeats the same parts as labels.
  providers: {
    title: "Change the vendor, not your code.",
    description:
      "Cloudflare is the default provider. One env var moves a capability such as email to another vendor.",
    envLabel: ".env (example)",
    envExample: "EMAIL_PROVIDER=console",
    points: [
      {
        id: "interface",
        title: "One interface.",
        description:
          "A capability such as `email` exposes one interface. Your code calls it, whichever provider sits behind it.",
      },
      {
        id: "select",
        title: "Pick the vendor with an env var.",
        description:
          "A `*_PROVIDER` env var selects the provider module, such as `email-cloudflare` or `email-plunk`.",
      },
      {
        id: "local",
        title: "Local development without a vendor account.",
        description:
          "Every capability ships a `-console` or `-memory` provider, so you build the whole project offline.",
      },
    ],
  },

  // Project instructions and the skill files installed with each module.
  siteSource: {
    title: "Ready for coding agents from the first commit.",
    description:
      "A new project starts with `AGENTS.md`, `CLAUDE.md`, a `DESIGN.md` and seven base skills for setup, config, env, design, testing, deploy and landing copy.",
    detail:
      "Every module you add brings its own skill file, and one `pnpm check` tells the agent whether its change holds.",
    sourceLabel: "Read the agent guide",
    sourceHref: `${DOCS}/how-to/make-it-yours.md`,
  },

  faq: {
    title: "Before you start.",
    description: "",
    items: [
      {
        id: "what",
        question: "What is {siteName}?",
        answer:
          "{siteName} is an open source, composable SaaS starter kit for Cloudflare. It is a CLI plus a module registry, not a boilerplate. You start with a landing page, then add the API, database, auth, payments and other modules one command at a time. Each module copies source files into your repository under the MIT license.",
      },
      {
        id: "own",
        question: "Do I own the generated code?",
        answer:
          "Yes. The CLI copies source files into your repository, and nothing is imported from a {siteName} package at runtime. Edit anything.",
      },
      {
        id: "account",
        question: "Do I need a Cloudflare account?",
        answer:
          "Not until you deploy. Every capability ships a console or in-memory provider, so the whole project runs on your machine with no cloud account.",
      },
      {
        id: "providers",
        question: "Can I change providers?",
        answer:
          "Yes. Every vendor sits behind a swappable provider. Pick the vendor with a `*_PROVIDER` env var, and the database takes a Postgres driver in place of D1.",
      },
      {
        id: "updates",
        question: "How do module updates work?",
        answer:
          "`saasaloy update` re-applies the base and modules at a newer version, with a merge plan for the files you edited. `saasaloy remove` undoes a module from its manifest.",
      },
      {
        id: "production",
        question: "Is {siteName} ready for production?",
        answer:
          "Not yet. It is a working proof of concept. The CLI, the module contracts and the generated code can change between releases until a stable `1.x.x` version ships. Pin the version you install and read the changelog before you update.",
      },
    ],
    /** The line under the list. An empty `moreLinkHref` hides it. */
    moreLabel: "",
    moreLinkLabel: "",
    moreLinkHref: "",
  },

  // Footer navigation. Every link leaves the page (5a). An empty label or href drops a
  // link. An empty `tagline` hides it.
  //
  // `notice` labels the dimension line under the large wordmark, and `analytics` joins it
  // only when the build carries an analytics token (../lib/analytics.ts), so the line
  // stays true. An empty `notice` hides the label and keeps the line.
  //
  // The colophon sits under the dimension line, the copyright on the left and the credit
  // on the right. `copyright` takes `{year}`, which the build fills and a one-line script
  // brings up to the visitor's year, and `{holder}`, the name in LICENSE.md, linked to
  // the holder's site. `credit` takes `{heart}` and `{sponsor}`, and the sponsor is a
  // link (5a). An empty `copyright` or `credit` hides its line.
  footer: {
    tagline: "Start small. Own the source.",
    notice: "Open source · MIT license",
    analytics: "Cookieless analytics",
    links: [
      { id: "github", label: "GitHub", href: REPO },
      {
        id: "getting-started",
        label: "Getting started",
        href: `${DOCS}/getting-started.md`,
      },
      {
        id: "changelog",
        label: "Changelog",
        href: `${REPO}/blob/main/packages/cli/CHANGELOG.md`,
      },
      {
        id: "license",
        label: "MIT license",
        href: `${REPO}/blob/main/LICENSE.md`,
      },
    ],
    copyright: "© {year} {holder}",
    copyrightHolder: {
      label: "Mukitul Islam Mukit",
      href: "https://mimukit.com",
    },
    credit: "Developed with {heart} from Bangladesh · Sponsored by {sponsor}",
    sponsor: { label: "Brainaloy Labs", href: "https://brainaloy.com" },
  },
};

/** Chrome and accessibility labels. Says nothing about your product; translate, don't rewrite. */
export const ui = {
  layout: {
    /** The skip link, the first thing a keyboard reaches on every page. */
    skipToContent: "Skip to content",
  },

  link: {
    /** Screen-reader text after every link that opens another site in a new tab. */
    newTab: "(opens in a new tab)",
  },

  navbar: {
    /** Accessible name for the desktop nav landmark. */
    mainNavLabel: "Main",
    /** Accessible name for the nav landmark inside the mobile panel. */
    mobileNavLabel: "Mobile",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    /** Accessible name for the brand link back to the top of the page. */
    homeLabel: "{siteName} home",
  },

  commandField: {
    /** The copy button's label at rest, and once the command is on the clipboard. */
    copy: "Copy",
    copied: "Copied",
    /** Accessible name for the button; `{command}` is the command it copies. */
    copyLabel: "Copy the command {command}",
    /** Announced through a polite live region once the copy lands. */
    copiedAnnouncement: "Command copied to the clipboard.",
  },

  footer: {
    /** Accessible name for the footer nav landmark. */
    navLabel: "Footer",
    /** Screen-reader text for the heart in the credit line. */
    heart: "love",
  },
};
