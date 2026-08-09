import type { ComponentType } from "react";
import {
  CloudIcon,
  GaugeIcon,
  LayersIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";
import { landing } from "@repo/ui/content/landing";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
//
// The words come from ../content/landing.ts; the icons stay here, keyed by the same `id`.
// That split is not arbitrary: Astro serializes island props, so a component or function
// cannot cross the .astro boundary, and an icon is not a translatable string. Swap an icon
// by editing the map below — that is what "you own the code" buys you.

export interface Feature {
  /** Stable key — picks the icon, and never the array position (see the content file). */
  id: string;
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

// One icon per content id. An id with no entry falls back rather than rendering nothing,
// so adding a feature to the content file cannot break the page.
const FEATURE_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  fast: ZapIcon,
  modules: LayersIcon,
  source: TerminalIcon,
  secure: ShieldCheckIcon,
  cloudflare: CloudIcon,
  current: GaugeIcon,
};

// `Object.hasOwn` first, not a bare index: `FEATURE_ICONS[id]` walks the prototype chain, so
// an id of `constructor` or `toString` resolves to an inherited function — not nullish, so a
// `?? SparklesIcon` fallback never fires and React is handed something that isn't a
// component. Ids are author-controlled and the saasaloy-landing-copy skill rewrites them, so
// this is reachable. Same reasoning as interpolate() in ../lib/interpolate.ts.
function iconFor(id: string): ComponentType<{ className?: string }> {
  return (Object.hasOwn(FEATURE_ICONS, id) ? FEATURE_ICONS[id] : undefined) ?? SparklesIcon;
}

const defaultFeatures: Feature[] = landing.features.items.map((item) => ({
  ...item,
  icon: iconFor(item.id),
}));

export interface FeatureGridProps {
  id?: string;
  title?: string;
  description?: string;
  features?: Feature[];
}

export function FeatureGrid({
  id = "features",
  title = landing.features.title,
  description = landing.features.description,
  features = defaultFeatures,
}: FeatureGridProps) {
  return (
    <section id={id} className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20">
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">{title}</h2>
        <p className="mt-4 text-base text-pretty text-muted-foreground">{description}</p>
      </div>

      <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {features.map((feature) => {
          const Icon = feature.icon;
          return (
            <Card key={feature.id} className="h-full">
              <CardHeader>
                <span
                  aria-hidden="true"
                  className="mb-3 flex size-9 items-center justify-center rounded-lg bg-muted text-foreground"
                >
                  <Icon className="size-4" />
                </span>
                <CardTitle>{feature.title}</CardTitle>
                <CardDescription>{feature.description}</CardDescription>
              </CardHeader>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
