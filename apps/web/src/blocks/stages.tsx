import { landing } from "@web/content/landing";
import { SourceSlabs } from "@web/illustrations/source-slabs";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";

// Fully static, no script. The round 10 stages: the title, a short lead, then a vertical
// list of numbered stages on a hairline, and the exploded stack of source slabs under it
// below `lg` (64rem). From `lg` the slabs move to the left of the list, so the page's
// drawings alternate sides (round 12, option A).
//
// THE HIGHLIGHT IS CSS. The `stage-list` utility in ../styles/web.css reads the hovered
// or keyboard-focused row through `:has()` on this <section>: it fills that row's marker
// with `primary`, tints the row with `muted`, and fills the matching slab in the drawing.
// With no row hovered or focused, the highlight rests on the first stage. Rows and slabs
// pair by their 1-based `data-stage` and `data-slab` numbers.
//
// Every word comes from ../content/landing.ts. Each title links to its docs and opens
// in a new tab.

export interface Stage {
  id: string;
  title: string;
  /** The `saasaloy` subcommand that adds the stage, shown in Geist Mono. */
  command: string;
  description: string;
  href: string;
}

export interface StagesProps {
  id?: string;
  title?: string;
  description?: string;
  items?: Stage[];
}

export function Stages({
  id = "stages",
  title = landing.stages.title,
  description = landing.stages.description,
  items = landing.stages.items,
}: StagesProps) {
  return (
    <section id={id} className="section-y stage-list">
      <div className="section-container-wide grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="reveal min-w-0">
          <h2 className="text-section-title text-highlight max-w-[14ch] text-balance">
            {title}
          </h2>
          {description && (
            <p className="text-muted-foreground mt-4 font-mono text-sm">
              {description}
            </p>
          )}

          <div className="relative mt-10">
            <span
              aria-hidden="true"
              className="bg-border absolute top-6 bottom-6 left-6 w-px"
            />
            <ol className="relative flex flex-col">
              {items.map((stage, index) => (
                <li
                  key={stage.id}
                  data-stage={index + 1}
                  className="relative flex gap-4 px-2 py-3 transition-colors"
                >
                  <span
                    aria-hidden="true"
                    data-stage-marker=""
                    className="border-highlight bg-background text-highlight flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-medium transition-colors"
                  >
                    {index + 1}
                  </span>
                  <div className="flex min-w-0 flex-col gap-1">
                    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <a
                        href={stage.href}
                        {...externalLinkProps(stage.href)}
                        className="text-highlight font-mono text-base font-medium underline-offset-4 hover:underline"
                      >
                        {stage.title}
                        {newTabHint(stage.href)}
                      </a>
                      <code className="bg-secondary text-secondary-foreground px-1.5 py-0.5 font-mono text-xs">
                        {stage.command}
                      </code>
                    </p>
                    <p className="text-muted-foreground font-mono text-xs leading-5">
                      {stage.description}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <SourceSlabs
          stages={items}
          className="text-highlight mx-auto w-full max-w-md lg:order-first"
        />
      </div>
    </section>
  );
}
