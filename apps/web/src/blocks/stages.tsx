import type { CSSProperties } from "react";

import { landing } from "@web/content/landing";
import { SourceSlabs } from "@web/illustrations/source-slabs";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { interpolate } from "@web/lib/interpolate";
import { catalogTabId } from "@web/lib/module-catalog";
import type { CatalogRow, CatalogStage } from "@web/lib/module-catalog";

// No script. The round 10 stages: the title, a short lead, then a vertical
// list of numbered stages on a hairline, and the exploded stack of source slabs under it
// below `lg` (64rem). From `lg` the slabs move to the left of the list, so the page's
// drawings alternate sides (round 12, option A).
//
// THE HIGHLIGHT IS CSS. The `stage-list` utility in ../styles/web.css reads the hovered
// or keyboard-focused row through `:has()` on this <section>: it fills that row's marker
// with `primary`, tints the row with `muted`, and fills the matching slab in the drawing.
// With no row hovered or focused, the highlight moves to the next stage every 3s, and
// with reduced motion it rests on the first stage. `data-loop-in-view` lets the layout's
// LOOP_SCRIPT pause that cycle off screen. Rows and slabs pair by their 1-based
// `data-stage` and `data-slab` numbers, and each carries its 0-based `--stage` for the
// cycle's delay.
//
// ONE STAGE LIST. Each stage is a registry `stage`, and its name is the catalog tab's
// label, so the stages and the catalog tabs read the same five words. Under each stage,
// "N modules in the catalog" is a <label> for that stage's tab radio in the catalog:
// a click checks the tab, which filters the tiles, and focuses the radio, which scrolls
// the catalog into view. It needs no script. A label takes no keyboard focus, so a
// keyboard reader reaches the same tabs by moving on to the catalog.
//
// Every word comes from ../content/landing.ts. Each name links to its module's docs and
// opens in a new tab.

export interface Stage {
  id: CatalogStage;
  /** The module whose folder the stage's slab names. */
  module: string;
  /** The `saasaloy` subcommand that adds the stage's module, shown in Geist Mono. */
  command: string;
  description: string;
  href: string;
}

export interface StagesProps {
  id?: string;
  /** The catalog rows, which give each stage its module count. */
  rows: CatalogRow[];
  /** The catalog section's id, which its tab radios' ids start with. */
  catalogId?: string;
  title?: string;
  description?: string;
  /** Takes `{count}`. */
  modulesLabel?: string;
  /** The stage names: the catalog's tab labels. */
  names?: Record<CatalogStage, string>;
  items?: Stage[];
}

export function Stages({
  id = "stages",
  rows,
  catalogId = "catalog",
  title = landing.stages.title,
  description = landing.stages.description,
  modulesLabel = landing.stages.modulesLabel,
  names = landing.catalog.tabs,
  items = landing.stages.items as Stage[],
}: StagesProps) {
  return (
    <section id={id} className="section-y stage-list" data-loop-in-view="">
      <div className="section-container-wide grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="reveal min-w-0">
          <h2 className="text-section-title text-primary max-w-[14ch] text-balance">
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
                  style={{ "--stage": index } as CSSProperties}
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
                        {names[stage.id]}
                        {newTabHint(stage.href)}
                      </a>
                      <code className="bg-secondary text-secondary-foreground px-1.5 py-0.5 font-mono text-xs">
                        {stage.command}
                      </code>
                    </p>
                    <p className="text-muted-foreground font-mono text-xs leading-5">
                      {stage.description}
                    </p>
                    <label
                      htmlFor={catalogTabId(catalogId, stage.id)}
                      className="text-highlight w-fit cursor-pointer font-mono text-xs underline-offset-4 hover:underline"
                    >
                      {interpolate(modulesLabel, {
                        count: rows.filter((row) => row.stage === stage.id)
                          .length,
                      })}{" "}
                      <span aria-hidden="true">→</span>
                    </label>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </div>

        <SourceSlabs
          stages={items.map((stage) => ({
            folder: stage.module,
            command: stage.command,
          }))}
          className="text-highlight drawing mx-auto w-full max-w-md lg:order-first"
        />
      </div>
    </section>
  );
}
