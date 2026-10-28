import { ChevronRightIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@web/site";
import { landing } from "@web/content/landing";
import { RepositoryTree } from "@web/illustrations/repository-tree";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { inlineCode } from "@web/lib/inline-code";
import { interpolate } from "@web/lib/interpolate";

// Fully static. Native `<details>` elements sharing one `name`, so the browser keeps a
// single answer open, the list works with JavaScript off, and the block needs no island.
// The vendored accordion in ../components/accordion.tsx stays for pages that want one.
//
// Every word comes from ../content/landing.ts. Backticks in an answer render as <code>.
//
// The round 10 FAQ: a left-aligned `section-title` in `highlight`, then square bordered
// rows that share their borders. Each row opens on its chevron, the question in
// `highlight` and the answer in `muted-foreground`. The section is two columns from `lg`:
// the left one holds the repository drawing, the right one all of the above, so the
// page's drawings alternate sides (round 12, option A). Below `lg` the drawing follows
// the list.

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
      <div className="section-container-wide grid gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <h2 className="text-section-title text-highlight reveal text-balance">
            {title}
          </h2>
          {description && (
            <p className="text-lead text-muted-foreground reveal mt-4 text-balance">
              {description}
            </p>
          )}

          <div className="bg-card reveal mt-10 border-x border-t">
            {items.map((item, index) => (
              <details
                key={item.id}
                name={id}
                open={index === 0}
                className="group disclosure border-b"
              >
                <summary className="text-highlight hover:bg-muted flex cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon
                    aria-hidden="true"
                    className="size-4 shrink-0 transition-transform duration-200 group-open:rotate-90"
                  />
                  {interpolate(item.question, { siteName })}
                </summary>
                <p className="text-muted-foreground pr-4 pb-4 pl-11 text-sm text-pretty">
                  {inlineCode(interpolate(item.answer, { siteName }))}
                </p>
              </details>
            ))}
          </div>

          {moreLinkHref && (
            <p className="text-muted-foreground mt-6 text-sm">
              {moreLabel}{" "}
              <a
                href={moreLinkHref}
                {...externalLinkProps(moreLinkHref)}
                className="text-highlight font-medium underline-offset-4 hover:underline"
              >
                {moreLinkLabel}
                {newTabHint(moreLinkHref)}
              </a>
            </p>
          )}
        </div>

        <RepositoryTree className="text-highlight reveal mx-auto w-full max-w-xl lg:order-first lg:mt-24" />
      </div>
    </section>
  );
}
