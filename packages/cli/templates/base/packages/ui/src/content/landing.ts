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
//      point at them are structure and stay in the block. Three things break that rule,
//      all for the same reason — a thing rewritten *with* the copy belongs *near* the
//      copy, or a rewrite leaves it stranded:
//        a. Pricing tiers. The whole list, prices and `ctaHref`s included, so a plan
//           change is one file rather than a file plus a block.
//        b. A feature's `icon`, held as a registry *name* (`"zap"`) and never a component
//           — a component cannot cross the .astro island boundary. Rewrite what a feature
//           is about and its glyph has to be able to follow, or a page about IELTS
//           listening practice renders a terminal prompt. The names ../blocks/feature-grid.tsx
//           accepts are listed in that file.
//        c. The two outbound calls to action — `landing.navbar.ctaHref` and
//           `landing.cta.primaryActionHref`/`.secondaryActionHref`. These are where "sign
//           up" actually goes. They leave the page, so unlike `#features` they cannot
//           break a section link, and the person being interviewed about the product is
//           the only one who knows the URL.
//      A translation layer reads `id`, `icon` and every `*Href` as non-message data, the
//      same way it already has to for a tier's `id`.
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

  // Header. The nav links' hrefs are same-page anchors owned by navbar.tsx; only their
  // words are here. An empty label hides that link, which is how a removed section loses
  // its nav entry.
  //
  // `ctaHref` is the exception (shape rule 5c): the header button is the page's most
  // clicked control, and where it goes — a signup form, a waitlist, an app — is a fact
  // about your product, not about the layout. It ships pointing at `#cta`, the closing
  // section, which is honest for a page with nowhere else to send anyone yet.
  navbar: {
    linkFeatures: "Features",
    linkPricing: "Pricing",
    linkFaq: "FAQ",
    ctaLabel: "Get started",
    ctaHref: "#cta",
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
    // `id` is the stable translation key and never the array position. `icon` names a
    // glyph from the registry at the top of ../blocks/feature-grid.tsx — rewrite what a
    // feature is about and change its icon in the same edit. Every item needs one: a name
    // the registry doesn't know renders the fallback glyph, but leaving the field off
    // altogether is a type error, which is the louder and more useful failure.
    items: [
      {
        id: "fast",
        icon: "zap",
        title: "Fast by default",
        description:
          "Static HTML at the edge, with JavaScript sent only for the parts of the page that actually need it.",
      },
      {
        id: "modules",
        icon: "layers",
        title: "Composable modules",
        description:
          "Add an API, a database, auth or billing when you need them — never before, and never all at once.",
      },
      {
        id: "source",
        icon: "terminal",
        title: "Source you own",
        description:
          "Every component lands in your repo as plain, editable source. No black box, no framework to fight.",
      },
      {
        id: "secure",
        icon: "shield-check",
        title: "Secure foundations",
        description:
          "Sensible defaults for sessions, cookies and origins, so the boring security work is already done.",
      },
      {
        id: "cloudflare",
        icon: "cloud",
        title: "Cloudflare-native",
        description:
          "Ships to Workers with static assets out of the box — one deploy command, no servers to babysit.",
      },
      {
        id: "current",
        icon: "gauge",
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

  // The closing ask. Both hrefs are shape rule 5c: outbound destinations, not anchors.
  // They ship pointing at the homepage because a freshly scaffolded project has nowhere
  // else to send anyone — replace them with the real signup, waitlist or docs URL, and
  // write labels the destination can honestly satisfy until you do.
  cta: {
    title: "Start building today",
    description:
      "Set up {siteName} in a couple of minutes. No credit card, no sales call, no lock-in.",
    primaryActionLabel: "Get started",
    primaryActionHref: "/",
    secondaryActionLabel: "Read the docs",
    secondaryActionHref: "/",
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
