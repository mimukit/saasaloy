import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { iconFor } from "@repo/ui/lib/icons";
import type { IconComponent } from "@repo/ui/lib/icons";
import { inlineCode } from "@repo/ui/lib/inline-code";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// The dusk kit's feature grid (Saasaloy UI, plan 0121). Fully static: rendered without a
// `client:*` directive, so it ships zero JavaScript.
//
// A bento on twelve tracks: on a wide screen the first row spans 6, 3 and 3 tracks and
// the second row 4, 4 and 4, so the first feature leads. A seventh feature starts the
// pattern again. Below `lg` the cards fall into two columns, then one.
//
// The words and each feature's icon name come from ../content/landing.ts; ../lib/icons.ts
// turns the name into the glyph. Backticks in a description render as <code>. The props
// match the ink feature grid, so the two files swap for each other.

export interface Feature {
  /** Stable key — the translation key, never the array position (see the content file). */
  id: string;
  icon: IconComponent;
  title: string;
  description: string;
}

const defaultFeatures: Feature[] = landing.features.items.map((item) => ({
  ...item,
  icon: iconFor(item.icon),
}));

export interface FeatureGridProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  features?: Feature[];
}

/** The track span of each card in a run of six: 6/3/3, then 4/4/4. */
const SPANS = [
  "lg:col-span-6",
  "lg:col-span-3",
  "lg:col-span-3",
  "lg:col-span-4",
  "lg:col-span-4",
  "lg:col-span-4",
];

export function FeatureGrid({
  id = "features",
  siteName = defaultSiteName,
  title = landing.features.title,
  description = interpolate(landing.features.description, { siteName }),
  features = defaultFeatures,
}: FeatureGridProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-wide">
        <div className="max-w-2xl">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-3 text-balance">
            {description}
          </p>
        </div>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-12">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.id}
                className={cn(
                  "reveal bg-card text-card-foreground flex flex-col gap-3 rounded-[calc(var(--radius)*2.4)] border p-6",
                  SPANS[index % SPANS.length]
                )}
              >
                <span
                  aria-hidden="true"
                  className="bg-primary/10 text-primary grid size-10 place-items-center rounded-[calc(var(--radius)*1.6)]"
                >
                  <Icon className="size-5" />
                </span>
                <h3 className="text-lg font-semibold tracking-tight">
                  {feature.title}
                </h3>
                <p className="text-muted-foreground text-sm text-pretty">
                  {inlineCode(interpolate(feature.description, { siteName }))}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
