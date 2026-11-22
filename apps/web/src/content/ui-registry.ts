// Every word the Saasaloy UI pages show (/ui, /ui/blocks/<name>), in one file, under the
// same shape rules as ./landing.ts. The block names, titles and one-line descriptions come
// from apps/web/registry.json, the file the registry build reads, so a block is described
// once.
//
// `{name}` is a registry name (`ink-hero`). The install command names the `@saasaloy`
// namespace; `registriesNote` tells a reader how to map it in components.json.

export const uiRegistry = {
  meta: {
    title: "Saasaloy UI: free blocks for shadcn projects",
    description:
      "Free, MIT-licensed UI blocks for shadcn projects on the base-nova style. Install each block with one command.",
    blockTitle: "{name} | Saasaloy UI",
    themesTitle: "Themes | Saasaloy UI",
    themesDescription:
      "Four free shadcn themes for Saasaloy UI blocks: neutral, cobalt, ember and moss. Each one changes colour tokens and the radius only.",
  },

  header: {
    /** The tag after the wordmark, the way /docs shows "Docs". */
    tag: "UI",
    navLabel: "Saasaloy UI",
    homeLabel: "Saasaloy UI home",
    cta: "Get Saasaloy",
  },

  /** The section links in the header and the footer bar. More join with later phases. */
  nav: [
    { id: "blocks", label: "Blocks", href: "/ui" },
    { id: "themes", label: "Themes", href: "/ui/themes" },
  ],

  index: {
    titleLead: "Free UI blocks for",
    titleAccent: "shadcn projects",
    lead: "Install open-source blocks with one command.",
    sampleBlock: "ink-hero",
    styleNote: "Built for the base-nova style. Works with any Base UI project.",
    registriesNote:
      'Map the namespace once: add `"@saasaloy": "https://saasaloy.com/r/{name}.json"` to `registries` in `components.json`.',
    filterLabel: "Filter blocks by kit or type",
    all: "All",
    gridLabel: "Blocks",
  },

  /** Kit chip labels, keyed by the kit name a block's registry name starts with. */
  kits: {
    ink: "Ink",
    dusk: "Dusk",
  } as Record<string, string>,

  /** Filter chip labels, keyed by the registry `categories[0]` value. */
  categories: {
    hero: "Heroes",
    features: "Features",
    pricing: "Pricing",
    "social-proof": "Social proof",
    faq: "FAQ",
    cta: "Calls to action",
    navigation: "Navigation",
    error: "Errors",
    auth: "Auth",
    waitlist: "Waitlist",
  } as Record<string, string>,

  themes: {
    title: "Themes",
    lead: "Choose a theme for any block. A theme changes colour tokens and the radius only.",
    gridLabel: "Themes",
    swatches: {
      background: "Background",
      primary: "Primary",
      muted: "Muted",
      border: "Border",
    },
    swatchesLabel: "{theme} colours",
    sampleLabel: "{theme} sample",
    sampleButton: "Continue",
    sampleCard: "Project",
    sampleBadge: "Ready",
    radius: "Radius {radius}",
    initNote:
      "In a new Saasaloy project, pass `--theme=<name>` to `saasaloy init` instead. It writes the theme into `brand.css`.",
  },

  /** The theme switcher of the block page. */
  switcher: {
    label: "Theme",
    note: "Themes change tokens only. Every block fits every theme.",
  },

  block: {
    breadcrumbLabel: "Breadcrumb",
    blocks: "Blocks",
    tabsLabel: "Block view",
    preview: "Preview",
    code: "Code",
    previewTitle: "Live preview of {name}",
    codeLabel: "The source shadcn writes to {path}",
    copyCode: "Copy code",
    copiedCode: "Copied",
    copiedAnnouncement: "Code copied to the clipboard.",
    styleNoteLead: "Needs a base-* style project (base-nova).",
    styleNoteBuilt: "Built by",
    styleNoteBrand: "Saasaloy",
    styleNoteTail: "Install in any Base UI project.",
    localName:
      "In a Saasaloy project the same block ships as `{local}`, from the local `@repo/ui` package. Saasaloy UI is the public registry of those blocks.",
    localNameKit:
      "In a Saasaloy project, a template in the `{kit}` kit writes the same block as `{local}`, from the local `@repo/ui` package: `saasaloy init <name> --template={template}`.",
    source: "View source on GitHub",
  },

  /**
   * The Saasaloy wire-up a module block page shows beside the plain shadcn command (plan
   * 0121, Phase 5), keyed by the module that ships the block. `command` adds the module to
   * a Saasaloy project; `line` says what the module connects, and `skill` names the skill
   * whose Wire-up section shows the code.
   */
  wireUp: {
    plainLabel: "Any shadcn project",
    plainNote:
      "The block takes an `onSubmit` prop and nothing more. Your code decides where the values go.",
    saasaloyLabel: "In a Saasaloy project",
    skillNote: "The code is in the Wire-up section of the `{skill}` skill.",
    modules: {
      auth: {
        command: "npx saasaloy add auth app",
        line: "Saasaloy wires the card to Better Auth. The skill's rule: the app renders a block on its own route and owns the call. `app` passes an `onSubmit` that calls the auth client.",
        skill: "saasaloy-auth",
      },
      waitlist: {
        command: "npx saasaloy add waitlist",
        line: "Saasaloy wires the form to the waitlist API. `WaitlistForm` passes an `onSubmit` that posts to `/waitlist`, and you place it on a page with `<WaitlistForm client:load />`.",
        skill: "saasaloy-waitlist",
      },
    } as Record<string, { command: string; line: string; skill: string }>,
  },

  footer: {
    navLabel: "Saasaloy UI sections",
    license: "MIT licensed",
  },
};
