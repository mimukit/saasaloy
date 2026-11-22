"use client";

import { useId, useState } from "react";
import { CheckIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@repo/ui";
import { buttonVariants } from "@repo/ui/components/button";
import { landing, ui } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// The dusk kit's pricing table (Saasaloy UI, plan 0121). The billing-period toggle is the
// only reason this block is hydrated; index.astro gives it `client:visible`. The toggle
// shows only when some tier's annual price differs from its monthly one.
//
// Three equal columns of soft cards. The featured tier rises a step and wears a primary
// outline and a text badge, so colour is never its only mark. The toggle is a real radio
// group (native radios in a fieldset with a legend), and each price sits in an
// `aria-live` region, so a switch of period is announced.
//
// Every tier, price and label comes from ../content/landing.ts. The props match the ink
// pricing table, so the two files swap for each other.

export interface PricingTier {
  /** Stable key, never the array position (see the content file). */
  id: string;
  name: string;
  description: string;
  /** Price per month, in whole currency units. `null` renders "Custom". */
  monthlyPrice: number | null;
  /** Effective per-month price when billed annually. `null` renders "Custom". */
  annualPrice: number | null;
  /** Replaces the "/month" after the price. Empty for the default. */
  priceSuffix?: string;
  features: string[];
  ctaLabel: string;
  ctaHref: string;
  /** Visually promotes one tier. Set it on at most one. */
  featured?: boolean;
  /** The featured tier's badge. Empty for ui.pricing.featuredBadge. */
  badge?: string;
}

export interface PricingTableProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  tiers?: PricingTier[];
  /** Shown beside the annual option; pass an empty string to hide it. */
  annualNote?: string;
  currencySymbol?: string;
}

/** `value` when it holds text, else `fallback`. An empty string in content means "default". */
function orDefault(value: string | undefined, fallback: string): string {
  return value === undefined || value === "" ? fallback : value;
}

export function PricingTable({
  id = "pricing",
  siteName = defaultSiteName,
  title = landing.pricing.title,
  description = interpolate(landing.pricing.description, { siteName }),
  tiers = landing.pricing.tiers,
  annualNote = landing.pricing.annualNote,
  currencySymbol = landing.pricing.currencySymbol,
}: PricingTableProps) {
  const [annual, setAnnual] = useState(false);
  const radioName = useId();
  const hasAnnual = tiers.some(
    (tier) => tier.annualPrice !== tier.monthlyPrice
  );
  const showAnnual = annual && hasAnnual;

  return (
    <section id={id} className="section-y">
      <div className="section-container-wide">
        <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <h2 className="text-section-title text-balance">{title}</h2>
            <p className="text-lead text-muted-foreground mt-3 text-balance">
              {description}
            </p>
          </div>

          {hasAnnual && (
            <fieldset className="bg-muted inline-flex shrink-0 gap-1 self-start rounded-full p-1 md:self-auto">
              <legend className="sr-only">
                {ui.pricing.billingPeriodLabel}
              </legend>
              {[
                { value: false, label: ui.pricing.monthly, note: "" },
                { value: true, label: ui.pricing.annual, note: annualNote },
              ].map((option) => (
                <label key={option.label} className="relative">
                  <input
                    type="radio"
                    name={radioName}
                    checked={annual === option.value}
                    onChange={() => {
                      setAnnual(option.value);
                    }}
                    className="peer absolute inset-0 opacity-0"
                  />
                  <span className="text-muted-foreground peer-checked:bg-background peer-checked:text-foreground peer-focus-visible:ring-ring/50 block cursor-pointer rounded-full px-4 py-1.5 text-sm font-medium peer-checked:shadow-sm peer-focus-visible:ring-3">
                    {option.label}
                    {option.note && (
                      <span className="ml-1.5 text-xs">{option.note}</span>
                    )}
                  </span>
                </label>
              ))}
            </fieldset>
          )}
        </div>

        <ul className="mt-12 grid gap-4 lg:grid-cols-3">
          {tiers.map((tier) => {
            const price = showAnnual ? tier.annualPrice : tier.monthlyPrice;
            const featured = tier.featured ?? false;
            const defaultSuffix = showAnnual
              ? ui.pricing.perMonthAnnual
              : ui.pricing.perMonth;
            const suffix = orDefault(tier.priceSuffix, defaultSuffix);
            return (
              <li
                key={tier.id}
                className={cn(
                  "bg-card text-card-foreground relative flex flex-col gap-3 rounded-[calc(var(--radius)*2.4)] border p-6",
                  featured &&
                    "border-primary ring-primary shadow-[0_24px_48px_-24px_color-mix(in_oklch,var(--primary)_45%,transparent)] ring-1 lg:-translate-y-4"
                )}
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h3 className="font-semibold">
                    {interpolate(tier.name, { siteName })}
                  </h3>
                  {featured && (
                    <p className="bg-primary text-primary-foreground rounded-full px-3 py-0.5 text-xs font-medium whitespace-nowrap">
                      {orDefault(tier.badge, ui.pricing.featuredBadge)}
                    </p>
                  )}
                </div>
                <p aria-live="polite" className="flex items-baseline gap-1.5">
                  <span className="text-4xl font-semibold tracking-tight">
                    {price === null
                      ? ui.pricing.customPrice
                      : interpolate(ui.pricing.price, {
                          currencySymbol,
                          price,
                        })}
                  </span>
                  {price !== null && (
                    <span className="text-muted-foreground text-sm">
                      {suffix}
                    </span>
                  )}
                </p>
                <p className="text-muted-foreground text-sm text-pretty">
                  {interpolate(tier.description, { siteName })}
                </p>
                <a
                  href={tier.ctaHref}
                  {...externalLinkProps(tier.ctaHref)}
                  className={cn(
                    buttonVariants({
                      variant: featured ? "default" : "outline",
                      size: "lg",
                    }),
                    "mt-2 h-11 w-full rounded-[calc(var(--radius)*1.6)]"
                  )}
                >
                  {tier.ctaLabel}
                  {newTabHint(tier.ctaHref)}
                </a>
                <ul className="mt-3 flex flex-col gap-2.5 border-t pt-5">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm"
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className="text-primary mt-0.5 size-4 shrink-0"
                      />
                      {feature}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
