// Every word the landing page shows, in one file.
//
// The blocks in ../blocks/*.tsx import this directly — NOT through props from
// index.astro. Astro serializes island props, so feeding a content object into
// `<PricingTable client:visible />` would write every string into the HTML payload *and*
// still ship the defaults inside the island's bundle. A direct import keeps the static
// blocks at zero JavaScript.
//
// TWO NAMESPACES, and the split is the point:
//
//   landing.*  Marketing copy — what your product is, who it is for, what it costs.
//              This is the surface a copywriting agent rewrites. Own it, edit it freely.
//   ui.*       Chrome and accessibility labels — "Monthly", "Most popular", "Close menu",
//              "Billing period". Nothing here says anything about your product, so a copy
//              pass never *rewrites* it. It does get *translated*, key for key, when
//              landing.* is written in some language other than English — otherwise the
//              page ships Bangla marketing copy under an English "Most popular" badge.
//
// SHAPE RULES. These are not style preferences; each one keeps this file mechanically
// translatable, because a translation layer reads a keyed record and nothing else:
//
//   1. Max three levels below a namespace (`landing.features.title`). Compiler-based
//      i18n libraries emit one flat identifier per message and cannot see deeper nesting.
//   2. Position is never the key. Lists are arrays whose items carry a stable `id`, so
//      reordering the feature grid cannot silently reattach the wrong translation. One
//      list is exempt: a tier's `features` bullets (`landing.pricing.tiers[].features`)
//      stay a plain `string[]`. They are the only strings here that nothing else reads —
//      a `features.items[]` id and an `faq.items[]` id are both stable anchors for an item
//      that outlives its wording, while a tier bullet is read once, as part of one tier,
//      and is rewritten with that tier whenever the plan changes. An id
//      per bullet would have to be invented by whoever writes the bullet, for no reader.
//      The cost is real and accepted: reorder a tier's bullets *without* editing them and
//      a positional catalog follows the slot rather than the sentence.
//   3. Placeholders are single-brace `{token}`, never a template literal. A catalog is
//      data; a function is not serializable and no extraction tool can read it. Render
//      them with `interpolate()` from ../lib/interpolate.ts.
//   4. No runtime concatenation. `/month` + `", billed annually"` is two whole messages
//      (`ui.pricing.perMonth`, `ui.pricing.perMonthAnnual`) because word order does not
//      survive the seam in every language.
//   5. Only user-visible strings live here. Section `id`s and the same-page anchors that
//      point at them are structure and stay in the block. A few things break that rule,
//      all for the same reason — a thing rewritten *with* the copy belongs *near* the
//      copy, or a rewrite leaves it stranded:
//        a. Pricing tiers. The whole list, prices and `ctaHref`s included, so a plan
//           change is one file rather than a file plus a block.
//        b. Icons and logo marks, held as registry *names* (`"zap"`) and never a
//           component — a component cannot cross the .astro island boundary. Rewrite what
//           an item is about and its glyph has to be able to follow, or a page about IELTS
//           listening practice renders a terminal prompt. The icon names are listed in
//           ../lib/icons.ts; the logo marks in ../blocks/logo-cloud.tsx.
//        c. Every outbound link — the calls to action, the docs and changelog links, the
//           social profiles, the FAQ's contact link. They leave the page, so unlike
//           `#features` they cannot break a section link, and the person being interviewed
//           about the product is the only one who knows the URL. An empty `*Href` hides
//           its link.
//        d. Code the page quotes — terminal commands, module names, file paths, a showcase
//           row's `visual` name. They are not prose and no translation touches them.
//      A translation layer reads `id`, `icon`, `mark`, `visual`, every `*Href` and the
//      quoted code as non-message data, the same way it already has to for a tier's `id`.
//
// Inline code: a pair of backticks inside a message (`saasaloy add`) renders as <code>.
// Translators keep the backticked part as is.
//
// The brand is not in this file. `{siteName}` comes from ../index.ts, which the
// saasaloy-setup skill sets.
//
// One chrome string set deliberately lives elsewhere: the theme toggle's labels, in
// ../lib/theme.ts. That file is inlined verbatim into a pre-paint <script> and is
// declared import-free on purpose, so it keeps its own constants.

// The project's own links, in one place so the copy below stays readable. Replace them
// with your product's URLs when you rewrite the page.
const REPO = "https://github.com/mimukit/saasaloy";
const DOCS = `${REPO}/blob/main/docs/wiki`;

/** Marketing copy. The whole of what a landing-copy pass may rewrite. */
export const landing = {
  // The browser tab, the meta description and the link preview. `{siteName}` comes from
  // ../index.ts.
  meta: {
    title: "{siteName}: ship the SaaS, not the scaffolding",
    description:
      "{siteName} is an open source CLI for Cloudflare. Start with a landing page, then add the API, database, auth and billing one command at a time, as source files you own.",
  },

  // Header. The nav links' hrefs are same-page anchors owned by navbar.tsx; only their
  // words are here. An empty label hides that link, which is how a removed section loses
  // its nav entry. The two buttons leave the page (shape rule 5c), and an empty
  // `secondaryHref` hides the secondary one.
  navbar: {
    linkFeatures: "Features",
    linkHowItWorks: "How it works",
    linkShowcase: "Modules",
    linkPricing: "",
    linkFaq: "FAQ",
    secondaryLabel: "GitHub",
    secondaryHref: REPO,
    ctaLabel: "Get started",
    ctaHref: `${DOCS}/getting-started.md`,
  },

  // The pill above the headline links out (5c). Empty `announcement` hides the pill.
  // The terminal is the hero's product visual: the real quick start and the tree it
  // produces. Commands, paths and the module that added each path are code (5d); the
  // comment lines under a command are prose.
  hero: {
    announcement: "See what's new",
    announcementHref: `${REPO}/blob/main/packages/cli/CHANGELOG.md`,
    title: "Ship the SaaS, not the scaffolding.",
    description:
      "{siteName} is an open source CLI for Cloudflare. Start with a landing page, then add the API, database, auth and billing one command at a time, as source files you own.",
    primaryActionLabel: "Get started",
    primaryActionHref: `${DOCS}/getting-started.md`,
    secondaryActionLabel: "Star on GitHub",
    secondaryActionHref: REPO,
    terminalLabel: "Terminal running the {siteName} quick start",
    terminalTitle: "~/my-app",
    terminalLines: [
      { id: "install", kind: "command", text: "npm install -g saasaloy" },
      { id: "init", kind: "command", text: "saasaloy init my-app" },
      {
        id: "dev",
        kind: "command",
        text: "cd my-app && pnpm install && pnpm dev",
      },
      {
        id: "dev-out",
        kind: "output",
        text: "landing page on http://localhost:3000",
      },
      { id: "waitlist", kind: "command", text: "saasaloy add waitlist" },
      {
        id: "waitlist-out",
        kind: "output",
        text: "pulls api, validators and database, then asks for a database driver",
      },
      { id: "admin", kind: "command", text: "saasaloy add admin" },
      {
        id: "admin-out",
        kind: "output",
        text: "pulls auth, then an auth-gated admin SPA",
      },
      {
        id: "dry-run",
        kind: "command",
        text: "saasaloy add waitlist --dry-run",
      },
      {
        id: "dry-run-out",
        kind: "output",
        text: "prints what a module would do before it does it",
      },
    ],
    treeTitle: "my-app",
    tree: [
      { id: "web", icon: "folder", path: "apps/web", addedBy: "init" },
      { id: "api", icon: "folder", path: "apps/api", addedBy: "api" },
      { id: "admin", icon: "folder", path: "apps/admin", addedBy: "admin" },
      { id: "ui", icon: "package", path: "packages/ui", addedBy: "init" },
      { id: "env", icon: "package", path: "packages/env", addedBy: "init" },
      { id: "db", icon: "package", path: "packages/db", addedBy: "database" },
      { id: "auth", icon: "package", path: "packages/auth", addedBy: "auth" },
      { id: "agents", icon: "file", path: "AGENTS.md", addedBy: "init" },
      { id: "design", icon: "file", path: "DESIGN.md", addedBy: "init" },
      { id: "config", icon: "file", path: "saasaloy.json", addedBy: "init" },
    ],
  },

  // The logo row. `mark` names an SVG in the registry at the top of
  // ../blocks/logo-cloud.tsx; `name` is the accessible label. A mark the registry does
  // not know renders `name` as a text wordmark, which is what the default row does: the
  // real stack, by name, with no trademark artwork. Add a customer's logo to the
  // registry, then name it here.
  logos: {
    label: "Built on the stack you would pick anyway",
    items: [
      { id: "workers", name: "Cloudflare Workers", mark: "" },
      { id: "astro", name: "Astro", mark: "" },
      { id: "hono", name: "Hono", mark: "" },
      { id: "drizzle", name: "Drizzle ORM", mark: "" },
      { id: "better-auth", name: "Better Auth", mark: "" },
      { id: "tanstack", name: "TanStack Router", mark: "" },
      { id: "stripe", name: "Stripe", mark: "" },
      { id: "turborepo", name: "Turborepo", mark: "" },
      { id: "pnpm", name: "pnpm", mark: "" },
    ],
  },

  // The problem the product solves. Opening an item swaps the icon in the visual beside
  // the list, with no JavaScript.
  painPoints: {
    title: "Does this sound familiar?",
    description:
      "Every technical founder has a folder of SaaS projects that never met a customer.",
    intro:
      "It is Saturday morning, you have an idea, and you are sure about it. By Sunday night you have a login screen, an empty admin panel and no idea whether a single person wants the product.",
    items: [
      {
        id: "landing-page",
        icon: "clock",
        title: "The landing page never ships",
        description:
          "Three hours in, you are wiring OAuth callbacks and picking an ORM, and the landing page does not exist yet.",
      },
      {
        id: "dead-projects",
        icon: "folder",
        title: "A folder of dead projects",
        description:
          "Polished auth, a role system, a Stripe webhook handler with retries, and not one real user.",
      },
      {
        id: "boilerplates",
        icon: "package",
        title: "Boilerplates make it worse",
        description:
          "Clone one and inherit forty features, twelve environment variables and someone else's opinions about billing.",
      },
      {
        id: "bills",
        icon: "receipt",
        title: "Bills before customers",
        description:
          "Servers and paid tiers cost money every month, before the idea has earned any.",
      },
    ],
  },

  // Three ordered steps. The numbers come from the order, so keep it meaningful.
  howItWorks: {
    title: "From idea to live in three steps",
    description: "No platform to learn first. Each step is one command.",
    steps: [
      {
        id: "init",
        title: "Init",
        description:
          "`saasaloy init` gives you an Astro landing page and a UI package. Nothing else.",
      },
      {
        id: "add",
        title: "Add",
        description:
          "`saasaloy add waitlist`, then auth, teams and billing, on the day the product earns each one.",
      },
      {
        id: "deploy",
        title: "Deploy",
        description:
          "`pnpm deploy:production` ships every Worker with wrangler, its secrets and its resources included.",
      },
    ],
  },

  // `id` is the stable translation key and never the array position. `icon` names a
  // glyph from ../lib/icons.ts — rewrite what a feature is about and change its icon in
  // the same edit. A name the registry doesn't know renders the fallback glyph.
  features: {
    title: "Built like shadcn/ui, for a whole SaaS",
    description: "A CLI plus a module registry, not a boilerplate.",
    items: [
      {
        id: "own-the-code",
        icon: "terminal",
        title: "You own the code",
        description:
          "Nothing is imported from a {siteName} package at runtime. The CLI writes files into your repo and gets out of the way.",
      },
      {
        id: "add-on-demand",
        icon: "layers",
        title: "Start small, add on demand",
        description:
          "`init` gives you a landing page. Everything else arrives with `saasaloy add`, its dependencies resolved first.",
      },
      {
        id: "cloudflare",
        icon: "cloud",
        title: "Cloudflare-native",
        description:
          "Workers, D1, KV and R2 keep most modules on the free tier, from a Saturday idea to a first paying customer.",
      },
      {
        id: "providers",
        icon: "shuffle",
        title: "Swappable providers",
        description:
          "Email, SMS, queues, KV, storage, logs and billing each sit behind one interface. An env var picks the vendor.",
      },
      {
        id: "agents",
        icon: "bot",
        title: "Agent-native",
        description:
          "Every project ships AGENTS.md, CLAUDE.md, DESIGN.md and a skill per module for Claude Code and other agents.",
      },
      {
        id: "reversible",
        icon: "undo",
        title: "Reversible and updatable",
        description:
          "`saasaloy remove` undoes a module. `saasaloy update` brings newer versions with a merge plan for files you edited.",
      },
    ],
  },

  // Alternating rows, each with a visual. Set `imageSrc` (a file in apps/web/public) and
  // `imageAlt` to show a screenshot; leave `imageSrc` empty to draw the built-in visual
  // named by `visual` — `stages`, `modules` or `skills` — from the lists below it.
  showcase: {
    title: "See what you get",
    description:
      "Real output from the CLI and the registry, not a mock dashboard.",
    rows: [
      {
        id: "stages",
        title: "A project through its stages",
        description:
          "A SaaS has stages, and the scaffold matches the stage. Nothing from a later row lands in your repo until you ask for it.",
        points: [
          { id: "stacked", text: "Each row installs on top of the last" },
          { id: "free", text: "Validation runs on the Cloudflare free tier" },
        ],
        visual: "stages",
        imageSrc: "",
        imageAlt: "",
      },
      {
        id: "modules",
        title: "38 modules in one registry",
        description:
          "Capabilities set the conventions, features drop files into them, providers swap the vendor at runtime, and drivers pick the database.",
        points: [
          { id: "pinned", text: "Fetched from GitHub at a pinned commit" },
          {
            id: "registry",
            text: "Any repo with a modules folder is a registry",
          },
        ],
        visual: "modules",
        imageSrc: "",
        imageAlt: "",
      },
      {
        id: "skills",
        title: "Make it yours with agent skills",
        description:
          "Four skills ship with every project. Run them in Claude Code, and the page you are reading gets your product's words and your theme.",
        points: [
          {
            id: "files",
            text: "Real files in .agents/skills, linked for Claude Code",
          },
          { id: "per-module", text: "Each module brings its own skill" },
        ],
        visual: "skills",
        imageSrc: "",
        imageAlt: "",
      },
    ],
    stages: [
      {
        id: "validate",
        title: "Validate the idea",
        modules: ["init", "waitlist"],
      },
      {
        id: "mvp",
        title: "Build the MVP",
        modules: ["auth", "admin", "email"],
      },
      {
        id: "teams",
        title: "Onboard teams",
        modules: ["teams", "multitenant", "rbac"],
      },
      {
        id: "charge",
        title: "Charge money",
        modules: ["billing", "billing-stripe"],
      },
      {
        id: "scale",
        title: "Scale the backend",
        modules: ["queue", "kv", "storage", "ratelimit", "api-keys"],
      },
    ],
    moduleGroups: [
      {
        id: "capabilities",
        title: "Capabilities",
        modules: [
          "api",
          "database",
          "validators",
          "logger",
          "auth",
          "admin",
          "email",
          "sms",
          "queue",
          "kv",
          "storage",
          "billing",
        ],
      },
      {
        id: "features",
        title: "Features",
        modules: [
          "waitlist",
          "teams",
          "multitenant",
          "rbac",
          "api-keys",
          "email-react",
          "ratelimit",
          "feature-flags",
        ],
      },
      {
        id: "providers",
        title: "Providers",
        modules: [
          "email-cloudflare",
          "email-plunk",
          "email-console",
          "queue-cloudflare",
          "queue-memory",
          "kv-cloudflare",
          "kv-memory",
          "storage-cloudflare",
          "storage-memory",
          "billing-stripe",
          "billing-console",
          "sms-khudebarta",
          "sms-console",
          "logger-console",
        ],
      },
      {
        id: "drivers",
        title: "Drivers",
        modules: ["database-d1", "database-postgres"],
      },
    ],
    skills: [
      {
        id: "setup",
        name: "/saasaloy-setup",
        target: "docs/product-brief.md",
        description:
          "Interviews you once, ten questions, starting with the product's name.",
      },
      {
        id: "landing-copy",
        name: "/saasaloy-landing-copy",
        target: "packages/ui/src/content/landing.ts",
        description:
          "Drafts every word of this page from the brief, then writes it after you approve.",
      },
      {
        id: "design",
        name: "/saasaloy-design",
        target: "DESIGN.md",
        description:
          "Records the design system the blocks read, and swaps the theme preset.",
      },
      {
        id: "env",
        name: "/saasaloy-env",
        target: "packages/env",
        description:
          "The runbook for every environment key the installed modules need.",
      },
    ],
  },

  // Who the product is for. `icon` names a glyph from ../lib/icons.ts.
  audience: {
    title: "Built for the people who ship",
    description:
      "Whoever writes the first version, the scaffold stays out of the way.",
    items: [
      {
        id: "founders",
        icon: "user",
        title: "Solo technical founders",
        description:
          "Test the idea with a landing page and a waitlist this weekend, and add the rest when someone signs up.",
      },
      {
        id: "teams",
        icon: "users",
        title: "Small teams",
        description:
          "Share one design system, one env setup and one deploy, with no platform team to wait on.",
      },
      {
        id: "agencies",
        icon: "code",
        title: "Agencies",
        description:
          "Start every client project from the same tested base, and hand over code the client owns.",
      },
      {
        id: "agents",
        icon: "bot",
        title: "Coding agents",
        description:
          "AGENTS.md and a skill per module tell Claude Code how the project works before it writes a line.",
      },
    ],
  },

  // Placeholders that read as placeholders, on purpose. Replace each with a real quote,
  // with the person's permission, and remove the section from index.astro until you have
  // three. The initials circle is drawn from `name`; there is no avatar image.
  testimonials: {
    title: "What builders say",
    description:
      "{siteName} is new. These cards wait for the first real quotes.",
    items: [
      {
        id: "quote-1",
        quote:
          "Your customer's words go here. Two or three sentences about the problem they had before, and what changed after.",
        name: "Customer name",
        role: "Role, Company",
      },
      {
        id: "quote-2",
        quote: "A short quote fits here. One sentence is plenty.",
        name: "Customer name",
        role: "Role, Company",
      },
      {
        id: "quote-3",
        quote:
          "Your customer's words go here. Name the result they got, in their own words.",
        name: "Customer name",
        role: "Role, Company",
      },
      {
        id: "quote-4",
        quote:
          "Keep the real wording, even when it is plain. Plain quotes read as true.",
        name: "Customer name",
        role: "Role, Company",
      },
      {
        id: "quote-5",
        quote:
          "Your customer's words go here. Two sentences about the day-to-day difference the product made for their team.",
        name: "Customer name",
        role: "Role, Company",
      },
      {
        id: "quote-6",
        quote:
          "A third short quote. Remove this section until you have three real ones.",
        name: "Customer name",
        role: "Role, Company",
      },
    ],
  },

  pricing: {
    title: "What it costs to run",
    description:
      "{siteName} is free. You pay Cloudflare only when the product outgrows the free tier.",
    /** Shown beside the annual option. Empty string hides it. */
    annualNote: "Save 20%",
    currencySymbol: "$",
    // The exception to rule 5: the whole tier list lives here, prices and ctaHrefs
    // included, so pricing is rewritten in one place. `monthlyPrice`/`annualPrice` are
    // whole currency units; `null` renders ui.pricing.customPrice. The billing toggle
    // shows only when some tier's annual price differs from its monthly one. Set
    // `featured` on at most one tier; `badge` overrides ui.pricing.featuredBadge for it.
    // `priceSuffix` replaces the "/month" after a price; leave it empty for the default.
    // Each tier carries an `id`; its `features` bullets deliberately do not (rule 2's
    // stated exemption) — they are rewritten with the tier, never alone.
    tiers: [
      {
        id: "saasaloy",
        name: "{siteName}",
        description: "The CLI and every module in the registry. MIT licensed.",
        monthlyPrice: 0,
        annualPrice: 0,
        priceSuffix: "forever",
        features: [
          "Every capability and provider",
          "Local dev with no accounts",
          "Host your own module registry",
          "No runtime package to sync",
          "Upgrades via saasaloy update",
        ],
        ctaLabel: "Get started",
        ctaHref: `${DOCS}/getting-started.md`,
      },
      {
        id: "cloudflare-free",
        name: "Cloudflare free tier",
        description: "Where the first stages run while you validate the idea.",
        monthlyPrice: 0,
        annualPrice: 0,
        priceSuffix: "",
        features: [
          "base, api, database-d1",
          "auth, admin, waitlist, teams",
          "Workers, D1, KV and R2",
          "Static assets for this page",
          "A hosting bill close to zero",
        ],
        ctaLabel: "Read the deploy guide",
        ctaHref: `${DOCS}/how-to/deploy-to-cloudflare.md`,
        featured: true,
        badge: "Where most projects start",
      },
      {
        id: "workers-paid",
        name: "Workers Paid",
        description: "For the modules that need a paid Cloudflare plan.",
        monthlyPrice: 5,
        annualPrice: 5,
        priceSuffix: "/month and up",
        features: [
          "email-cloudflare sending",
          "queue-cloudflare jobs",
          "Higher Workers limits",
          "email-plunk avoids the upgrade",
          "Billed by Cloudflare, not by us",
        ],
        ctaLabel: "Compare providers",
        ctaHref: `${DOCS}/reference.md#email-providers`,
      },
    ],
  },

  faq: {
    title: "Questions, answered",
    description:
      "The things people ask before they commit a weekend to a new stack.",
    items: [
      {
        id: "production",
        question: "Is {siteName} ready for production?",
        answer:
          "Not yet. It is a working proof of concept at 0.x, and the CLI, the module contracts and the generated code can change between releases. Pin the version you install and read the changelog before you update.",
      },
      {
        id: "sync",
        question: "Is this a boilerplate I have to keep in sync?",
        answer:
          "No. The CLI copies source files into your repo, and nothing is imported from a {siteName} package at runtime. `saasaloy update` re-applies newer versions with a merge plan for the files you edited.",
      },
      {
        id: "account",
        question: "Do I need a Cloudflare account?",
        answer:
          "Not until you deploy. Every capability ships a console or in-memory provider, so the whole project runs on your machine with no cloud account.",
      },
      {
        id: "leave",
        question: "Can I leave Cloudflare later?",
        answer:
          "Yes. Every vendor sits behind a provider that an env var selects, and the database takes a Postgres driver in place of D1.",
      },
      {
        id: "requirements",
        question: "What do I need installed?",
        answer: "Node 24.13.0 or later and pnpm 11 or later.",
      },
    ],
    /** The line under the list. An empty `moreLinkHref` hides it. */
    moreLabel: "Can't find what you're looking for?",
    moreLinkLabel: "Open an issue",
    moreLinkHref: `${REPO}/issues`,
  },

  // The closing ask. `command` is shown as a code chip (5d); an empty one hides it.
  cta: {
    title: "Start with a landing page",
    description: "Ship the page today. Add the rest when the product earns it.",
    command: "pnpm dlx saasaloy init my-app",
    primaryActionLabel: "Read the getting started guide",
    primaryActionHref: `${DOCS}/getting-started.md`,
    secondaryActionLabel: "Star on GitHub",
    secondaryActionHref: REPO,
  },

  // Footer navigation. The legal links point at this site's own pages, so their hrefs
  // live in footer.tsx; the other links leave the page (5c). An empty label or href drops
  // a link, and an empty social href drops its icon. GitHub and X are the marks the
  // block draws.
  footer: {
    tagline: "Open source, composable SaaS starter kit for Cloudflare.",
    links: [
      { id: "docs", label: "Docs", href: `${DOCS}/index.md` },
      { id: "modules", label: "Modules", href: `${DOCS}/modules.md` },
      {
        id: "changelog",
        label: "Changelog",
        href: `${REPO}/blob/main/packages/cli/CHANGELOG.md`,
      },
    ],
    linkTerms: "Terms",
    linkPrivacy: "Privacy",
    githubHref: REPO,
    xHref: "",
    copyright: "© {year} {siteName}. MIT licensed.",
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

  logos: {
    /** Accessible name for the logo row. */
    listLabel: "Logos",
  },

  showcase: {
    /** Heading over each module group's count, e.g. "Capabilities 13". */
    moduleCount: "{count} modules",
  },

  pricing: {
    billingPeriodLabel: "Billing period",
    monthly: "Monthly",
    annual: "Annual",
    featuredBadge: "Most popular",
    /** Rendered instead of a number when a tier's price is `null`. */
    customPrice: "Custom",
    /** Symbol and amount as one message — placement varies by locale. */
    price: "{currencySymbol}{price}",
    // Two whole messages rather than "/month" plus a suffix (shape rule 4).
    perMonth: "/month",
    perMonthAnnual: "/month, billed annually",
  },

  footer: {
    /** Accessible name for the footer nav landmark. */
    navLabel: "Footer",
    github: "GitHub",
    x: "X",
  },
};
