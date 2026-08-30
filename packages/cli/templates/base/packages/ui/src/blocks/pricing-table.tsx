import { useState } from "react";
import { CheckIcon } from "lucide-react";

import { Badge } from "@repo/ui/components/badge";
import { Button, buttonVariants } from "@repo/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/card";
import { landing, ui } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// The billing-period toggle is the only reason this block is hydrated. index.astro gives
// it `client:visible`, so the JavaScript is fetched when the section scrolls into view
// rather than on load. Delete the toggle and the block goes fully static again.
//
// This block holds no tier data at all: the whole list lives in ../content/landing.ts
// (`landing.pricing.tiers`), prices included, so pricing is rewritten in one file and
// never hunted for in markup.

export interface PricingTier {
  /** Stable key, never the array position (see the content file). */
  id: string;
  name: string;
  description: string;
  /** Price per month, in whole currency units. `null` renders "Custom". */
  monthlyPrice: number | null;
  /** Effective per-month price when billed annually. `null` renders "Custom". */
  annualPrice: number | null;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  /** Visually promotes one tier. Set it on at most one. */
  featured?: boolean;
}

export interface PricingTableProps {
  id?: string;
  title?: string;
  description?: string;
  tiers?: PricingTier[];
  /** Shown beside the annual option; pass an empty string to hide it. */
  annualNote?: string;
  currencySymbol?: string;
}

export function PricingTable({
  id = "pricing",
  title = landing.pricing.title,
  description = landing.pricing.description,
  tiers = landing.pricing.tiers,
  annualNote = landing.pricing.annualNote,
  currencySymbol = landing.pricing.currencySymbol,
}: PricingTableProps) {
  const [annual, setAnnual] = useState(false);

  return (
    <section
      id={id}
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-6 py-20"
    >
      <div className="mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {title}
        </h2>
        <p className="text-muted-foreground mt-4 text-base text-pretty">
          {description}
        </p>

        <div className="mt-8 flex items-center justify-center gap-3">
          <div
            role="group"
            aria-label={ui.pricing.billingPeriodLabel}
            className="border-border inline-flex items-center gap-1 rounded-xl border p-1"
          >
            <Button
              size="sm"
              variant={annual ? "ghost" : "secondary"}
              aria-pressed={!annual}
              onClick={() => setAnnual(false)}
            >
              {ui.pricing.monthly}
            </Button>
            <Button
              size="sm"
              variant={annual ? "secondary" : "ghost"}
              aria-pressed={annual}
              onClick={() => setAnnual(true)}
            >
              {ui.pricing.annual}
            </Button>
          </div>
          {annualNote && <Badge variant="outline">{annualNote}</Badge>}
        </div>
      </div>

      <div className="mt-14 grid items-start gap-4 lg:grid-cols-3">
        {tiers.map((tier) => {
          const price = annual ? tier.annualPrice : tier.monthlyPrice;
          return (
            <Card
              key={tier.id}
              className={cn("h-full", tier.featured && "ring-primary ring-2")}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle>{tier.name}</CardTitle>
                  {tier.featured && <Badge>{ui.pricing.featuredBadge}</Badge>}
                </div>
                <CardDescription>{tier.description}</CardDescription>
              </CardHeader>

              <CardContent>
                <p className="flex items-baseline gap-1">
                  <span className="text-3xl font-semibold tracking-tight">
                    {price === null
                      ? ui.pricing.customPrice
                      : interpolate(ui.pricing.price, {
                          currencySymbol,
                          price,
                        })}
                  </span>
                  {price !== null && (
                    <span className="text-muted-foreground text-sm">
                      {annual ? ui.pricing.perMonthAnnual : ui.pricing.perMonth}
                    </span>
                  )}
                </p>

                <ul className="mt-6 flex flex-col gap-2.5">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm"
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0"
                      />
                      <span className="text-muted-foreground">{feature}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>

              <CardFooter>
                <a
                  href={tier.ctaHref}
                  className={cn(
                    buttonVariants({
                      variant: tier.featured ? "default" : "outline",
                    }),
                    "w-full"
                  )}
                >
                  {tier.ctaLabel}
                </a>
              </CardFooter>
            </Card>
          );
        })}
      </div>
    </section>
  );
}
