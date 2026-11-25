import type { landing as landingContent } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";

// The Markdown copy of the home page, which `/index.md` serves and `/llms-full.txt`
// includes. It reads the same `landing.ts` the blocks read, so a copy pass changes the
// page and its Markdown copy in one edit.
//
// `LANDING_SECTIONS` mirrors the order of the blocks in src/pages/index.astro. When you
// remove, reorder or add a section there, make the same change here, or the Markdown copy
// tells an agent about a section the page no longer shows. A section whose title is blank
// is left out on its own.

type Landing = typeof landingContent;

/** Every section this file can write, in the base page's order. */
export const ALL_LANDING_SECTIONS = [
  "hero",
  "logos",
  "painPoints",
  "howItWorks",
  "features",
  "showcase",
  "audience",
  "testimonials",
  "pricing",
  "faq",
  "cta",
] as const;

export type LandingSection = (typeof ALL_LANDING_SECTIONS)[number];

/**
 * The sections the page renders, in page order. The navbar and the footer carry no
 * content. Delete or move a line here as you delete or move a block in index.astro.
 */
export const LANDING_SECTIONS: readonly LandingSection[] = [
  "hero",
  "logos",
  "painPoints",
  "howItWorks",
  "features",
  "showcase",
  "audience",
  "testimonials",
  "pricing",
  "faq",
  "cta",
];

type Fill = (message: string) => string;

/** `[label](href)` for each pair whose label and href are both set. */
function links(pairs: [label: string, href: string][]): string[] {
  const set = pairs.filter(([label, href]) => label !== "" && href !== "");
  return set.length === 0
    ? []
    : [set.map(([label, href]) => `[${label}](${href})`).join(" | "), ""];
}

function titled(title: string, description: string, fill: Fill): string[] {
  return [
    `## ${fill(title)}`,
    "",
    ...(description ? [fill(description), ""] : []),
  ];
}

function bullets(
  items: readonly { title: string; description: string }[],
  fill: Fill
): string[] {
  return [
    ...items.map(
      (item) => `- **${fill(item.title)}**: ${fill(item.description)}`
    ),
    "",
  ];
}

function price(
  tier: Landing["pricing"]["tiers"][number],
  pricing: Landing["pricing"]
): string {
  if (tier.monthlyPrice === null) {
    return "Custom";
  }
  return `${pricing.currencySymbol}${String(tier.monthlyPrice)}${tier.priceSuffix || "/month"}`;
}

const RENDER: Record<LandingSection, (l: Landing, fill: Fill) => string[]> = {
  hero: (l, fill) => [
    `# ${fill(l.hero.title)}`,
    "",
    fill(l.hero.description),
    "",
    ...links([
      [l.hero.primaryActionLabel, l.hero.primaryActionHref],
      [l.hero.secondaryActionLabel, l.hero.secondaryActionHref],
    ]),
  ],
  logos: (l, fill) =>
    l.logos.items.length === 0
      ? []
      : [
          `${fill(l.logos.label)}: ${l.logos.items.map((item) => item.name).join(", ")}.`,
          "",
        ],
  painPoints: (l, fill) => [
    ...titled(l.painPoints.title, l.painPoints.description, fill),
    ...(l.painPoints.intro ? [fill(l.painPoints.intro), ""] : []),
    ...bullets(l.painPoints.items, fill),
  ],
  howItWorks: (l, fill) => [
    ...titled(l.howItWorks.title, l.howItWorks.description, fill),
    ...l.howItWorks.steps.map(
      (step, index) =>
        `${String(index + 1)}. **${fill(step.title)}**: ${fill(step.description)}`
    ),
    "",
  ],
  features: (l, fill) => [
    ...titled(l.features.title, l.features.description, fill),
    ...bullets(l.features.items, fill),
  ],
  showcase: (l, fill) => [
    ...titled(l.showcase.title, l.showcase.description, fill),
    ...l.showcase.rows.flatMap((row) => [
      `### ${fill(row.title)}`,
      "",
      fill(row.description),
      "",
      ...row.points.map((point) => `- ${fill(point.text)}`),
      "",
    ]),
  ],
  audience: (l, fill) => [
    ...titled(l.audience.title, l.audience.description, fill),
    ...bullets(l.audience.items, fill),
  ],
  testimonials: (l, fill) => [
    ...titled(l.testimonials.title, l.testimonials.description, fill),
    ...l.testimonials.items.flatMap((item) => [
      `> ${fill(item.quote)}`,
      `> (${item.name}, ${item.role})`,
      "",
    ]),
  ],
  pricing: (l, fill) => [
    ...titled(l.pricing.title, l.pricing.description, fill),
    ...l.pricing.tiers.flatMap((tier) => [
      `### ${fill(tier.name)}: ${price(tier, l.pricing)}`,
      "",
      fill(tier.description),
      "",
      ...tier.features.map((feature) => `- ${fill(feature)}`),
      "",
      ...links([[tier.ctaLabel, tier.ctaHref]]),
    ]),
  ],
  faq: (l, fill) => [
    ...titled(l.faq.title, l.faq.description, fill),
    ...l.faq.items.flatMap((item) => [
      `### ${fill(item.question)}`,
      "",
      fill(item.answer),
      "",
    ]),
    ...links([[l.faq.moreLinkLabel, l.faq.moreLinkHref]]),
  ],
  cta: (l, fill) => [
    ...titled(l.cta.title, l.cta.description, fill),
    ...(l.cta.command ? [`\`${l.cta.command}\``, ""] : []),
    ...links([
      [l.cta.primaryActionLabel, l.cta.primaryActionHref],
      [l.cta.secondaryActionLabel, l.cta.secondaryActionHref],
    ]),
  ],
};

/** The title each section opens with; a blank one drops the section. */
function sectionTitle(l: Landing, section: LandingSection): string {
  return section === "logos" ? l.logos.label : l[section].title;
}

/** The home page as Markdown, with `{siteName}` filled in. */
export function landingMarkdown(
  l: Landing,
  siteName: string,
  sections: readonly LandingSection[] = LANDING_SECTIONS
): string {
  const fill: Fill = (message) => interpolate(message, { siteName });
  const lines = sections
    .filter((section) => sectionTitle(l, section).trim() !== "")
    .flatMap((section) => RENDER[section](l, fill));
  return `${lines.join("\n").trim()}\n`;
}
