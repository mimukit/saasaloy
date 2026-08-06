import type { ComponentType } from "react";
import {
  CloudIcon,
  GaugeIcon,
  LayersIcon,
  ShieldCheckIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";

import { Card, CardDescription, CardHeader, CardTitle } from "@repo/ui/components/card";

// Fully static — rendered without a `client:*` directive, so it ships zero JavaScript.
//
// The icons are referenced here rather than accepted as props on purpose: Astro
// serializes island props, so a component or function cannot cross the .astro boundary.
// Swap an icon by editing this file — that is what "you own the code" buys you.

export interface Feature {
  icon: ComponentType<{ className?: string }>;
  title: string;
  description: string;
}

const defaultFeatures: Feature[] = [
  {
    icon: ZapIcon,
    title: "Fast by default",
    description:
      "Static HTML at the edge, with JavaScript sent only for the parts of the page that actually need it.",
  },
  {
    icon: LayersIcon,
    title: "Composable modules",
    description:
      "Add an API, a database, auth or billing when you need them — never before, and never all at once.",
  },
  {
    icon: TerminalIcon,
    title: "Source you own",
    description:
      "Every component lands in your repo as plain, editable source. No black box, no framework to fight.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Secure foundations",
    description:
      "Sensible defaults for sessions, cookies and origins, so the boring security work is already done.",
  },
  {
    icon: CloudIcon,
    title: "Cloudflare-native",
    description:
      "Ships to Workers with static assets out of the box — one deploy command, no servers to babysit.",
  },
  {
    icon: GaugeIcon,
    title: "Built to stay current",
    description:
      "Dependencies are exact-pinned and updated deliberately, so upgrades are a decision, not a surprise.",
  },
];

export interface FeatureGridProps {
  id?: string;
  title?: string;
  description?: string;
  features?: Feature[];
}

export function FeatureGrid({
  id = "features",
  title = "Everything the first release needs",
  description = "The parts every SaaS ends up building anyway, ready before you write a line of product code.",
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
            <Card key={feature.title} className="h-full">
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
