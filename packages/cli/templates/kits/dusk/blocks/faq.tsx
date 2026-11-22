import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { externalLinkProps, newTabHint } from "@repo/ui/lib/external-link";
import { inlineCode } from "@repo/ui/lib/inline-code";
import { interpolate } from "@repo/ui/lib/interpolate";

// The dusk kit's FAQ (Saasaloy UI, plan 0121). Fully static, and nothing opens or closes:
// every answer is always visible. Each row is a 1:2 grid, the question on the left and
// the answer on the right, with a rule between rows. On a narrow screen the answer falls
// under its question. A description list, so a screen reader pairs each answer with its
// question.
//
// Every word comes from ../content/landing.ts. Backticks in an answer render as <code>.
// The props match the ink FAQ, so the two files swap for each other.

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
      <div className="section-container-wide">
        <div className="max-w-2xl">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-3 text-balance">
            {description}
          </p>
        </div>

        <dl className="bg-card text-card-foreground mt-10 divide-y rounded-[calc(var(--radius)*2.4)] border px-6">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid gap-2 py-4 md:grid-cols-3 md:gap-8"
            >
              <dt className="font-medium text-pretty">
                {interpolate(item.question, { siteName })}
              </dt>
              <dd className="text-muted-foreground text-sm text-pretty md:col-span-2 md:text-base">
                {inlineCode(interpolate(item.answer, { siteName }))}
              </dd>
            </div>
          ))}
        </dl>

        {moreLinkHref && (
          <p className="text-muted-foreground mt-6 text-sm">
            {moreLabel}{" "}
            <a
              href={moreLinkHref}
              {...externalLinkProps(moreLinkHref)}
              className="text-primary font-medium underline-offset-4 hover:underline"
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
