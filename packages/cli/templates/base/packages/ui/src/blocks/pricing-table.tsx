import { useId, useState } from "react";
import { CheckIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@repo/ui";
import { buttonVariants } from "@repo/ui/components/button";
import { landing, ui } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// The billing-period toggle is the only reason this block is hydrated. index.astro gives
// it `client:visible`, so the JavaScript is fetched when the section scrolls into view
// rather than on load. The toggle shows only when some tier's annual price differs from
// its monthly one; with none, the block renders no control at all.
//
// The toggle is a real radio group — native radios in a fieldset with a legend — so arrow
// keys move between the options and a screen reader announces "Billing period". Each
// price sits in an `aria-live` region, so switching periods is announced. The featured
// tier carries a text badge and a stronger border, so colour is never its only mark.
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
      <div className="section-container flex flex-col items-center">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        {hasAnnual && (
          <fieldset className="bg-muted mt-8 inline-flex gap-1 rounded-xl border p-1">
            <legend className="sr-only">{ui.pricing.billingPeriodLabel}</legend>
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
                <span className="text-muted-foreground peer-checked:bg-background peer-checked:text-foreground peer-focus-visible:ring-ring/50 block cursor-pointer rounded-lg px-4 py-1.5 text-sm font-medium peer-checked:shadow-sm peer-focus-visible:ring-3">
                  {option.label}
                  {option.note && (
                    <span className="ml-1.5 text-xs">{option.note}</span>
                  )}
                </span>
              </label>
            ))}
          </fieldset>
        )}

        <ul className="mt-12 grid w-full items-start gap-6 lg:grid-cols-3">
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
                  "relative flex flex-col gap-3 rounded-xl border p-7 shadow-xs",
                  featured &&
                    "border-foreground/40 shadow-[0_20px_40px_-20px_color-mix(in_oklch,var(--foreground)_25%,transparent)]"
                )}
              >
                {featured && (
                  <p className="bg-foreground text-background absolute -top-3 right-6 rounded-full px-3 py-0.5 text-xs font-medium">
                    {orDefault(tier.badge, ui.pricing.featuredBadge)}
                  </p>
                )}
                <h3 className="font-semibold">
                  {interpolate(tier.name, { siteName })}
                </h3>
                <p aria-live="polite" className="flex items-baseline gap-1.5">
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
                    "mt-3 w-full"
                  )}
                >
                  {tier.ctaLabel}
                  {newTabHint(tier.ctaHref)}
                </a>
                <ul className="mt-3 flex flex-col gap-2.5 border-t border-dashed pt-5">
                  {tier.features.map((feature) => (
                    <li
                      key={feature}
                      className="flex items-start gap-2 text-sm"
                    >
                      <CheckIcon
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0"
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
