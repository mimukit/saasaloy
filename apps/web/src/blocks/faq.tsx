import { ChevronDownIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { landing } from "@web/content/landing";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { inlineCode } from "@web/lib/inline-code";
import { interpolate } from "@web/lib/interpolate";

// Fully static. Native `<details>` elements sharing one `name`, so the browser keeps a
// single answer open, the list works with JavaScript off, and the block needs no island.
// The vendored accordion in ../components/accordion.tsx stays for pages that want one.
//
// Every word comes from ../content/landing.ts. Backticks in an answer render as <code>.

export interface FaqItem {
  /** Stable key, never the array position (see the content file). */
  id: string;
  question: string;
  answer: string;
}

export interface FaqProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  items?: FaqItem[];
  moreLabel?: string;
  moreLinkLabel?: string;
  /** An empty string hides the line under the list. */
  moreLinkHref?: string;
}

export function Faq({
  id = "faq",
  siteName = defaultSiteName,
  title = landing.faq.title,
  description = interpolate(landing.faq.description, { siteName }),
  items = landing.faq.items,
  moreLabel = landing.faq.moreLabel,
  moreLinkLabel = landing.faq.moreLinkLabel,
  moreLinkHref = landing.faq.moreLinkHref,
}: FaqProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-narrow">
        <div className="text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        <div className="mt-12 rounded-xl border px-6 py-2 shadow-xs md:mt-16">
          {items.map((item, index) => (
            <details
              key={item.id}
              name={id}
              open={index === 0}
              className="group border-t border-dashed first:border-t-0"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 font-medium [&::-webkit-details-marker]:hidden">
                {interpolate(item.question, { siteName })}
                <ChevronDownIcon
                  aria-hidden="true"
                  className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                />
              </summary>
              <p className="text-muted-foreground pb-4 text-sm text-pretty">
                {inlineCode(interpolate(item.answer, { siteName }))}
              </p>
            </details>
          ))}
        </div>

        {moreLinkHref && (
          <p className="text-muted-foreground mt-6 text-center text-sm">
            {moreLabel}{" "}
            <a
              href={moreLinkHref}
              {...externalLinkProps(moreLinkHref)}
              className="text-foreground font-medium underline-offset-4 hover:underline"
            >
              {moreLinkLabel}
              {newTabHint(moreLinkHref)}
            </a>
          </p>
        )}
      </div>
    </section>
  );
}
