import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { iconFor } from "@repo/ui/lib/icons";
import type { IconComponent } from "@repo/ui/lib/icons";
import { inlineCode } from "@repo/ui/lib/inline-code";
import { interpolate } from "@repo/ui/lib/interpolate";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
//
// The words come from ../content/landing.ts, and so does each feature's icon — but as a
// *name*, not a component. Astro serializes island props, so a component cannot cross the
// .astro boundary; the registry that turns `"zap"` into `ZapIcon` lives in ../lib/icons.ts,
// shared with the pain points and the audience list. What that buys is the thing a copy
// rewrite actually needs: change what a feature is about, change its glyph, one file, no
// block edit.
//
// Each icon sits on a small fading grid (the `grid-pattern` utility) that brightens under
// the pointer. Backticks in a description render as <code>.

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

export function FeatureGrid({
  id = "features",
  siteName = defaultSiteName,
  title = landing.features.title,
  description = interpolate(landing.features.description, { siteName }),
  features = defaultFeatures,
}: FeatureGridProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        <ul className="mx-auto mt-12 grid max-w-sm gap-6 md:mt-16 md:max-w-none md:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.id}
                className="group reveal hover-lift flex flex-col items-center gap-3 rounded-xl border p-6 text-center shadow-xs"
              >
                <div
                  aria-hidden="true"
                  className="relative mb-2 size-36 [--grid-line:color-mix(in_oklch,var(--foreground)_10%,transparent)] group-hover:[--grid-line:color-mix(in_oklch,var(--foreground)_20%,transparent)]"
                >
                  <div className="grid-pattern absolute inset-0" />
                  <div className="to-background absolute inset-0 bg-radial from-transparent to-75%" />
                  <span className="bg-background absolute inset-0 m-auto grid size-12 place-items-center border-t border-l border-(--grid-line)">
                    <Icon className="size-5" />
                  </span>
                </div>
                <h3 className="font-semibold">{feature.title}</h3>
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
