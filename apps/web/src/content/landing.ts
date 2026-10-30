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
  // `description` names the category, because the title does not, and its last
  // sentence repeats the README's opening paragraph.
  hero: {
    titleLead: "A landing page today.",
    titleAccent: "Your next module tomorrow.",
    description:
      "An open source SaaS starter kit for Cloudflare. Start small, and add each module as source files you own. Think shadcn/ui for a full-stack SaaS.",
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
  // is aria-hidden, so the names stay readable and searchable. Each name is a runtime
  // service, framework, library or tool from the README stack table (5b), shown as is.
  // The `frameworks` and `libraries` groups are the drawing's two rings, so keep those
  // ids; `runtime` shows as chips only. The free tier claim repeats README line 27.
  builtOn: {
    title: "Built on Cloudflare and tools you already know.",
    description:
      "Every project runs on Cloudflare, where Workers, D1, KV and R2 keep most modules on the free tier. Astro, TanStack Router and Hono build the apps, with Drizzle and Better Auth for data and sign-in.",
    groups: [
      {
        id: "runtime",
        label: "Runtime",
        items: [
          { id: "workers", label: "Workers" },
          { id: "d1", label: "D1" },
          { id: "kv", label: "KV" },
          { id: "r2", label: "R2" },
          { id: "queues", label: "Queues" },
        ],
      },
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

  // The stages. One stage per registry `stage`, in `CATALOG_STAGES` order, and the
  // stage's name is its catalog tab label (`catalog.tabs`), so the two sections say one
  // thing. `module` names the folder on the stage's slab in the drawing, `command` is the
  // command beside the name (5b), and `href` links the name to that module's docs (5a).
  // The row link uses a text fragment, because a Markdown table row has no anchor; a
  // browser without text fragments opens the page at the top. `modulesLabel` takes
  // `{count}`, the stage's tile count, and selects the stage's catalog tab.
  stages: {
    title: "Add code when the product needs it.",
    description: "Each module adds source files to your repository.",
    modulesLabel: "{count} modules in the catalog",
    items: [
      {
        id: "validate",
        module: "waitlist",
        command: "add waitlist",
        description:
          "Start with the landing page, then collect sign-ups to test the idea.",
        href: `${DOCS}/modules.md#:~:text=a%20waitlist%20form%20plus%20its%20API%20route`,
      },
      {
        id: "mvp",
        module: "auth",
        command: "add auth",
        description:
          "Add sign-in, the user app and the admin console when people sign up.",
        href: `${DOCS}/modules.md#:~:text=workspace%20wrapping%20Better%20Auth`,
      },
      {
        id: "teams",
        module: "teams",
        command: "add teams",
        description:
          "Add team accounts and tenant isolation when users ask for them.",
        href: `${DOCS}/modules.md#:~:text=Better%20Auth%20organizations%2C%20memberships`,
      },
      {
        id: "money",
        module: "payment",
        command: "add payment",
        description:
          "Add one-off payments and subscriptions when someone wants to pay.",
        href: `${DOCS}/modules.md#:~:text=workspace%20with%20the%20provider%20contract%2C%20the%20status%20machine`,
      },
      {
        id: "scale",
        module: "queue",
        command: "add queue",
        description:
          "Add background jobs, file uploads, feature flags, API keys and rate limits as usage grows.",
        href: `${DOCS}/modules.md#:~:text=a%20job%20table%2C%20a%20schedule%20table`,
      },
    ],
  },

  // The module catalog. The rows are not copy: the page reads them from
  // modules/*/registry-item.json at build time, so a renamed or new module needs no edit
  // here. These are the words around the rows. An empty `description` hides the lead.
  // `{total}` and the tier tokens in `counts` are module counts, read from the registry
  // at build time; `{modules}` counts the tiles. A tab is a registry `stage`; `variants`
  // labels the provider and driver chips on a tile. `needs` takes `{modules}`, the
  // tile's needs from `dependsOn`, and `addCommand` takes `{name}` (5b).
  //
  // `summaries` is the founder-facing line on each tile, keyed by module name. The
  // registry `description` is written for a contributor; a tile with no summary shows
  // it instead. The summaries live here and not in registry-item.json, because the
  // descriptor schema refuses an unknown key and a released CLI would fail on it.
  catalog: {
    title: "Choose the modules you need.",
    description:
      "Each module adds its source files to your repository. You read and edit every line it writes.",
    counts: "{modules} modules · {provider} providers · {driver} drivers",
    filterLabel: "Filter modules by stage",
    tabs: {
      all: "All",
      validate: "Validate",
      mvp: "MVP",
      teams: "Teams",
      money: "Money",
      scale: "Scale",
    },
    variants: {
      provider: "Providers",
      driver: "Drivers",
    },
    showAll: "Show all modules",
    needs: "Needs {modules}",
    addCommand: "npx saasaloy add {name}",
    summaries: {
      api: "A Hono API on Cloudflare Workers for every route the product needs.",
      database: "A Drizzle database on D1 or Postgres, with migrations.",
      logger: "Structured logs with levels and field redaction.",
      validators:
        "Shared Zod schemas, so the API and the browser check the same input.",
      waitlist: "A waitlist form and its API route, to collect early sign-ups.",
      admin:
        "A staff console behind sign-in. Later modules add their screens to it.",
      app: "The signed-in app for your users, with sign-in, sign-up and a home screen.",
      auth: "Sign-in and sessions with Better Auth.",
      e2e: "Playwright tests that sign in and walk through each installed module.",
      email:
        "Send email through one interface. The local provider logs each message.",
      shell:
        "The layout, navigation, user menu and data table of every signed-in screen.",
      command:
        "A Cmd+K command palette and keyboard shortcuts in every signed-in app.",
      "email-react": "Write email templates in JSX, with a preview server.",
      multitenant:
        "Tenant isolation, where a query without the tenant filter does not compile, plus custom roles.",
      teams:
        "Organizations, members, roles and invitations, with an admin screen.",
      billing:
        "Subscriptions with plans and entitlements, and a 402 gate on paid features.",
      payment:
        "One-off payments with a status machine and a staff review screen.",
      kv: "A key-value store with tenant-scoped keys and a cache helper.",
      queue: "Background jobs and cron schedules.",
      sms: "Send SMS through one interface, with segment counting.",
      storage: "File storage with signed links.",
      "api-keys":
        "Scoped API keys, stored as a hash, owned by a user or an organization.",
      "env-infisical": "Load secrets from Infisical for setup and deploy.",
      "feature-flags":
        "Feature flags with per-tenant overrides, rollouts and kill switches.",
      "file-uploads":
        "File uploads with an upload block, an admin screen and a cleanup job.",
      ratelimit: "Rate limits per route, with a 429 and Retry-After.",
    } as Record<string, string>,
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

  // The closing block after the FAQ. `command` is the command field's text (5b), and the
  // links are the hero's. `source` is the line that says this site began as the base
  // template's landing page; `sourceHref` leaves the page (5a).
  start: {
    title: "Start with a landing page today.",
    description: "Add the next module when the product needs it.",
    command: "npx saasaloy init my-app",
    source:
      "This site began as the landing page `saasaloy init` writes. Its source lives at `apps/web`.",
    sourceLabel: "View this site's source",
    sourceHref: `${REPO}/tree/main/apps/web`,
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
        id: "boilerplate",
        question: "How is it different from a boilerplate?",
        answer:
          "A boilerplate gives you every feature on day one, and you spend the first week deleting the ones you do not need. {siteName} starts with a landing page and adds each module when the product needs it. Later fixes reach the files you own through `saasaloy update`.",
      },
      {
        id: "first",
        question: "Which modules should I add first?",
        answer:
          "Follow the stages. Add `waitlist` to test the idea, `auth` when people sign up, `teams` when they ask for a team account, and `payment` when someone wants to pay. `saasaloy add` installs the modules each one needs first.",
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
        id: "cost",
        question: "What does it cost to host?",
        answer:
          "Close to nothing while you test the idea. The base, `api`, `database-d1`, `auth`, `admin`, `waitlist` and `teams` run on the Cloudflare free tier. `email-cloudflare` and `queue-cloudflare` need a paid Workers plan, and a vendor provider such as `email-plunk` needs that vendor's account.",
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
