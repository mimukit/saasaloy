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
//              "Billing period". Nothing here says anything about your product, and the
//              landing-copy skill never touches it.
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
//      a `features.items[]` id picks an icon and an `faq.items[]` id is a stable anchor
//      for a question that outlives its wording, while a tier bullet is read once, as
//      part of one tier, and is rewritten with that tier whenever the plan changes. An id
//      per bullet would have to be invented by whoever writes the bullet, for no reader.
//      The cost is real and accepted: reorder a tier's bullets *without* editing them and
//      a positional catalog follows the slot rather than the sentence.
//   3. Placeholders are single-brace `{token}`, never a template literal. A catalog is
//      data; a function is not serializable and no extraction tool can read it. Render
//      them with `interpolate()` from ../lib/interpolate.ts.
//   4. No runtime concatenation. `/month` + `", billed annually"` is two whole messages
//      (`ui.pricing.perMonth`, `ui.pricing.perMonthAnnual`) because word order does not
//      survive the seam in every language.
//   5. Only user-visible strings live here. `href`s, section `id`s and icons are
//      structure and stay in the block — with pricing tiers as the one stated exception:
//      the whole tier list moves here, prices and all, so a copy pass has exactly one
//      file to rewrite.
//
// One chrome string set deliberately lives elsewhere: the theme toggle's labels, in
// ../lib/theme.ts. That file is inlined verbatim into a pre-paint <script> and is
// declared import-free on purpose, so it keeps its own constants.

/** Marketing copy. The whole of what a landing-copy pass may rewrite. */
export const landing = {
  // The browser tab and the meta description. `{siteName}` comes from ../index.ts.
  meta: {
    title: "{siteName} — ship your SaaS, not your scaffolding",
    description: "{siteName}, a Cloudflare-native SaaS.",
  },

  // Header. The hrefs are same-page anchors owned by navbar.tsx; only the words are here.
  // An empty label hides that link, which is how a removed section loses its nav entry.
  navbar: {
    linkFeatures: "Features",
    linkPricing: "Pricing",
    linkFaq: "FAQ",
    ctaLabel: "Get started",
  },

  hero: {
    eyebrow: "Now in early access",
    title: "The SaaS you meant to build, already scaffolded.",
    description:
      "{siteName} gives your product a real front door on day one — a landing page, a design system, and room for every feature you add next.",
    primaryActionLabel: "Get started",
    secondaryActionLabel: "See pricing",
  },

  features: {
    title: "Everything the first release needs",
    description:
      "The parts every SaaS ends up building anyway, ready before you write a line of product code.",
    // `id` picks the icon in feature-grid.tsx and is the stable translation key. Add an
    // item with a new id and it renders with the fallback icon until you map one.
    items: [
      {
        id: "fast",
        title: "Fast by default",
        description:
          "Static HTML at the edge, with JavaScript sent only for the parts of the page that actually need it.",
      },
      {
        id: "modules",
        title: "Composable modules",
        description:
          "Add an API, a database, auth or billing when you need them — never before, and never all at once.",
      },
      {
        id: "source",
        title: "Source you own",
        description:
          "Every component lands in your repo as plain, editable source. No black box, no framework to fight.",
      },
      {
        id: "secure",
        title: "Secure foundations",
        description:
          "Sensible defaults for sessions, cookies and origins, so the boring security work is already done.",
      },
      {
        id: "cloudflare",
        title: "Cloudflare-native",
        description:
          "Ships to Workers with static assets out of the box — one deploy command, no servers to babysit.",
      },
      {
        id: "current",
        title: "Built to stay current",
        description:
          "Dependencies are exact-pinned and updated deliberately, so upgrades are a decision, not a surprise.",
      },
    ],
  },

  pricing: {
    title: "Pricing that stays out of the way",
    description:
      "Start free, upgrade when the product earns it. Every plan includes the full framework.",
    /** Shown beside the annual option. Empty string hides it. */
    annualNote: "Save 20%",
    currencySymbol: "$",
    // The exception to rule 5: the whole tier list lives here, prices and ctaHrefs
    // included, so pricing is rewritten in one place. `monthlyPrice`/`annualPrice` are
    // whole currency units; `null` renders ui.pricing.customPrice. Set `featured` on at
    // most one tier. Each tier carries an `id`; its `features` bullets deliberately do not
    // (rule 2's stated exemption) — they are rewritten with the tier, never alone.
    tiers: [
      {
        id: "free",
        name: "Free",
        description: "For side projects and the first hundred users.",
        monthlyPrice: 0,
        annualPrice: 0,
        features: ["Up to 3 projects", "Community support", "1 GB storage"],
        ctaLabel: "Start for free",
        ctaHref: "#cta",
      },
      {
        id: "pro",
        name: "Pro",
        description: "For teams shipping to paying customers.",
        monthlyPrice: 29,
        annualPrice: 23,
        features: [
          "Unlimited projects",
          "Email support",
          "100 GB storage",
          "Usage analytics",
          "Custom domains",
        ],
        ctaLabel: "Start free trial",
        ctaHref: "#cta",
        featured: true,
      },
      {
        id: "enterprise",
        name: "Enterprise",
        description: "For organisations with procurement and a security review.",
        monthlyPrice: null,
        annualPrice: null,
        features: ["SSO and SCIM", "Priority support", "Audit logs", "Custom contracts"],
        ctaLabel: "Talk to sales",
        ctaHref: "#cta",
      },
    ],
  },

  faq: {
    title: "Questions, answered",
    description: "The things people ask before they commit a weekend to a new stack.",
    items: [
      {
        id: "what-you-get",
        question: "What do I actually get?",
        answer:
          "A working monorepo: a static marketing site, a shared design system, and a command that adds the rest — API, database, auth, billing — one capability at a time.",
      },
      {
        id: "sync",
        question: "Is this a boilerplate I have to keep in sync?",
        answer:
          "No. Everything is copied into your repository as source you own and edit. There is no framework release to chase and nothing that overwrites your changes behind your back.",
      },
      {
        id: "design-system",
        question: "Can I use my own design system?",
        answer:
          "Yes. The theme is a single stylesheet of design tokens and the components are plain files in your repo, so restyling is editing, not forking.",
      },
      {
        id: "deploy",
        question: "Where does it deploy?",
        answer:
          "Cloudflare, by default — static assets on Workers, with the same account covering the database, queues and storage a feature module needs later.",
      },
      {
        id: "outgrow",
        question: "What if I outgrow it?",
        answer:
          "Then you keep the code. Nothing here is a runtime dependency on us: the generated project is an ordinary pnpm workspace that builds without any of our tooling installed.",
      },
    ],
  },

  cta: {
    title: "Start building today",
    description:
      "Set up {siteName} in a couple of minutes. No credit card, no sales call, no lock-in.",
    primaryActionLabel: "Get started",
    secondaryActionLabel: "Read the docs",
  },

  // Footer navigation, like the navbar: hrefs live in footer.tsx, words live here, and an
  // empty label drops that link (an empty heading drops the whole group).
  footer: {
    tagline: "A Cloudflare-native SaaS, scaffolded with Saasaloy.",
    groupProduct: "Product",
    groupLegal: "Legal",
    linkFeatures: "Features",
    linkPricing: "Pricing",
    linkFaq: "FAQ",
    linkTerms: "Terms",
    linkPrivacy: "Privacy",
  },
};

/** Chrome and accessibility labels. Says nothing about your product; translate, don't rewrite. */
export const ui = {
  navbar: {
    /** Accessible name for the desktop nav landmark. */
    mainNavLabel: "Main",
    /** Accessible name for the nav landmark inside the mobile panel. */
    mobileNavLabel: "Mobile",
    openMenu: "Open menu",
    closeMenu: "Close menu",
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
    copyright: "© {year} {siteName}. All rights reserved.",
  },
};
