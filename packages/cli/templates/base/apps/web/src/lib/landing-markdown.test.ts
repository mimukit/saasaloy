import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { describe, expect, it } from "vitest";
import { LANDING_SECTIONS, landingMarkdown } from "./landing-markdown";

// The Markdown copy of the home page that `/index.md` serves, built from the same
// `landing.ts` the page renders.

describe(landingMarkdown, () => {
  const text = landingMarkdown(landing, "Acme");

  it("opens with the hero headline as the one h1", () => {
    expect(text.startsWith(`# ${landing.hero.title}\n`)).toBeTruthy();
    expect(text.match(/^# /gm)).toHaveLength(1);
  });

  it("fills {siteName} everywhere", () => {
    expect(text).not.toContain("{siteName}");
    expect(text).toContain(
      interpolate(landing.hero.description, { siteName: "Acme" })
    );
  });

  it("writes each section title as an h2, in the page's order", () => {
    const titles = [...text.matchAll(/^## (.*)$/gm)].map((m) => m[1]);
    expect(titles).toStrictEqual([
      landing.painPoints.title,
      landing.howItWorks.title,
      landing.features.title,
      landing.showcase.title,
      landing.audience.title,
      landing.testimonials.title,
      landing.pricing.title,
      landing.faq.title,
      landing.cta.title,
    ]);
  });

  it("keeps each FAQ question and answer", () => {
    const [first] = landing.faq.items;
    expect(first).toBeDefined();
    expect(text).toContain(
      `### ${interpolate(first?.question ?? "", { siteName: "Acme" })}`
    );
  });

  it("writes each price with its suffix", () => {
    expect(text).toContain("### Workers Paid: $5/month and up");
  });

  it("links the calls to action", () => {
    expect(text).toContain(
      `[${landing.hero.primaryActionLabel}](${landing.hero.primaryActionHref})`
    );
  });

  it("drops a section the page no longer renders", () => {
    const short = landingMarkdown(landing, "Acme", ["hero", "faq"]);
    expect(short).toContain(`## ${landing.faq.title}`);
    expect(short).not.toContain(`## ${landing.pricing.title}`);
  });

  it("drops a section whose title is blank", () => {
    const blank = landingMarkdown(
      { ...landing, faq: { ...landing.faq, title: "" } },
      "Acme"
    );
    expect(blank).not.toContain(landing.faq.items[0]?.answer ?? "-");
  });

  it("lists the same sections as index.astro, logos included", () => {
    expect(LANDING_SECTIONS).toStrictEqual([
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
    ]);
  });
});
