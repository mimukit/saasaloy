import { ChevronsRightIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { landing } from "@web/content/landing";
import { inlineCode } from "@web/lib/inline-code";
import { interpolate } from "@web/lib/interpolate";

// Fully static. Three ordered steps in one bordered card. It is an <ol>, so the order is
// in the markup and a screen reader announces it; the big numbers are decoration drawn
// from the position and hidden from assistive tech. Keep the list short and in a real
// order, or use the feature grid instead.
//
// Every word comes from ../content/landing.ts. Backticks in a step render as <code>.

export interface Step {
  /** Stable key, never the array position (see the content file). */
  id: string;
  title: string;
  description: string;
}

export interface HowItWorksProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  steps?: Step[];
}

export function HowItWorks({
  id = "how-it-works",
  siteName = defaultSiteName,
  title = landing.howItWorks.title,
  description = interpolate(landing.howItWorks.description, { siteName }),
  steps = landing.howItWorks.steps,
}: HowItWorksProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        <ol className="reveal mt-12 grid gap-10 rounded-xl border px-8 py-12 text-center md:mt-16 md:grid-cols-3 md:gap-12">
          {steps.map((step, index) => (
            <li
              key={step.id}
              className="relative flex flex-col items-center gap-2"
            >
              <span
                aria-hidden="true"
                className="text-muted-foreground/50 mb-2 text-6xl leading-none font-bold"
              >
                {index + 1}
              </span>
              <h3 className="font-semibold">{step.title}</h3>
              <p className="text-muted-foreground max-w-64 text-sm text-pretty">
                {inlineCode(interpolate(step.description, { siteName }))}
              </p>
              {index < steps.length - 1 && (
                <ChevronsRightIcon
                  aria-hidden="true"
                  className="text-muted-foreground absolute top-16 -right-9 hidden size-5 md:block"
                />
              )}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
