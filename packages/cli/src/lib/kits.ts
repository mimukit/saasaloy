// oxlint-disable-next-line import/default -- a `?raw` import is text with a default export (src/raw.d.ts)
import duskCta from "../../templates/kits/dusk/blocks/cta.tsx?raw";
// oxlint-disable-next-line import/default -- a `?raw` import is text with a default export (src/raw.d.ts)
import duskFaq from "../../templates/kits/dusk/blocks/faq.tsx?raw";
// oxlint-disable-next-line import/default -- a `?raw` import is text with a default export (src/raw.d.ts)
import duskFeatureGrid from "../../templates/kits/dusk/blocks/feature-grid.tsx?raw";
// oxlint-disable-next-line import/default -- a `?raw` import is text with a default export (src/raw.d.ts)
import duskHero from "../../templates/kits/dusk/blocks/hero.tsx?raw";
// oxlint-disable-next-line import/default -- a `?raw` import is text with a default export (src/raw.d.ts)
import duskPricingTable from "../../templates/kits/dusk/blocks/pricing-table.tsx?raw";
// oxlint-disable-next-line import/default -- a `?raw` import is text with a default export (src/raw.d.ts)
import duskTestimonials from "../../templates/kits/dusk/blocks/testimonials.tsx?raw";
import { KIT_BLOCKS } from "./recipes.js";
import type { KitName, PageBlock } from "./recipes.js";

// The source of each kit block (plan 0121, Phase 7), bundled into the CLI as text the way
// the theme files are, so the render stays pure and a later render of the project writes
// the same bytes. `?raw` is Vite's text import under vitest, and tsup's `raw-text` plugin
// (tsup.config.ts) does the same in the build. `templates/kits/<kit>/blocks/` is the one
// copy: the Saasaloy UI registry publishes the same files as `<kit>-<block>`.

const SOURCES: Readonly<Record<KitName, Partial<Record<PageBlock, string>>>> = {
  ink: {},
  dusk: {
    cta: duskCta,
    faq: duskFaq,
    "feature-grid": duskFeatureGrid,
    hero: duskHero,
    "pricing-table": duskPricingTable,
    testimonials: duskTestimonials,
  },
};

/** The project path of a page block's file. */
export function blockPath(block: PageBlock): string {
  return `packages/ui/src/blocks/${block}.tsx`;
}

/** Each file `kit` writes over an ink block: project path to source. */
export function kitFiles(kit: KitName): Map<string, string> {
  const files = new Map<string, string>();
  for (const block of KIT_BLOCKS[kit]) {
    const source = SOURCES[kit][block];
    if (source === undefined) {
      throw new Error(
        `Kit "${kit}" lists ${block} and ships no source for it.`
      );
    }
    files.set(blockPath(block), source);
  }
  return files;
}
