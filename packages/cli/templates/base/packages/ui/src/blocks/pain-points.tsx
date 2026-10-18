import { ChevronDownIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { iconFor } from "@repo/ui/lib/icons";
import { interpolate } from "@repo/ui/lib/interpolate";

// Fully static. The list is native `<details name>`, so the browser keeps one item open
// and every item works with JavaScript off. The visual beside the list shows the open
// item's icon, and that swap is CSS too: the <style> below holds one `:has()` rule per
// item, keyed by position, so no island and no state is needed. With nothing open, the
// first item's icon shows.
//
// Every word comes from ../content/landing.ts; icon names resolve through ../lib/icons.ts.

export interface PainPoint {
  /** Stable key, never the array position (see the content file). */
  id: string;
  icon: string;
  title: string;
  description: string;
}

export interface PainPointsProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  intro?: string;
  items?: PainPoint[];
}

function swapRules(count: number): string {
  const rules = ["[data-pain-icon]{display:none}"];
  for (let index = 0; index < count; index += 1) {
    rules.push(
      // verify-content-disable-next-line a CSS rule, not copy
      `[data-pain-points]:has(details[data-pain-index="${index}"][open]) [data-pain-icon="${index}"]{display:grid}`
    );
  }
  rules.push(
    // verify-content-disable-next-line a CSS rule, not copy
    '[data-pain-points]:not(:has(details[open])) [data-pain-icon="0"]{display:grid}'
  );
  return rules.join("");
}

export function PainPoints({
  id = "pain-points",
  siteName = defaultSiteName,
  title = landing.painPoints.title,
  description = interpolate(landing.painPoints.description, { siteName }),
  intro = interpolate(landing.painPoints.intro, { siteName }),
  items = landing.painPoints.items,
}: PainPointsProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        {intro && (
          <p className="text-muted-foreground mt-12 rounded-xl border px-6 py-5 text-center text-pretty md:px-10">
            {intro}
          </p>
        )}

        <style>{swapRules(items.length)}</style>
        <div
          data-pain-points=""
          className="mt-12 grid items-center gap-10 md:grid-cols-2 md:gap-16"
        >
          <div>
            {items.map((item, index) => {
              const Icon = iconFor(item.icon);
              return (
                <details
                  key={item.id}
                  name={id}
                  open={index === 0}
                  data-pain-index={index}
                  className="group border-b"
                >
                  <summary className="flex cursor-pointer list-none items-center gap-3 py-4 [&::-webkit-details-marker]:hidden">
                    <Icon
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0"
                    />
                    <span className="flex-1 font-medium">{item.title}</span>
                    <ChevronDownIcon
                      aria-hidden="true"
                      className="text-muted-foreground size-4 shrink-0 transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <p className="text-muted-foreground pb-4 pl-7 text-sm text-pretty">
                    {interpolate(item.description, { siteName })}
                  </p>
                </details>
              );
            })}
          </div>

          <div
            aria-hidden="true"
            className="relative aspect-[76/59] rounded-[1.25rem] border p-2 pr-12"
          >
            <div className="bg-muted grid h-full place-items-center rounded-[0.875rem] border">
              {items.map((item, index) => {
                const Icon = iconFor(item.icon);
                return (
                  <span
                    key={item.id}
                    data-pain-icon={index}
                    className="blur-in col-start-1 row-start-1 place-items-center"
                  >
                    <Icon className="size-14 stroke-[1.5]" />
                  </span>
                );
              })}
            </div>
            <div className="absolute inset-y-2 right-2 w-8 rounded-lg bg-[repeating-linear-gradient(-45deg,var(--border)_0_1px,transparent_1px_8px)]" />
          </div>
        </div>
      </div>
    </section>
  );
}
