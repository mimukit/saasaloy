import { landing } from "@web/content/landing";
import { ModuleInventory } from "@web/illustrations/module-inventory";
import { interpolate } from "@web/lib/interpolate";
import {
  CATALOG_STAGES,
  catalogCounts,
  catalogTabId,
} from "@web/lib/module-catalog";
import type {
  CatalogRow,
  CatalogStage,
  CatalogVariant,
} from "@web/lib/module-catalog";
import { cn } from "@web/lib/utils";

// Fully static, no island. The page reads the rows from the registry at build time
// (loadModuleCatalog in ../lib/module-registry.ts) and passes them in, so this block
// never touches the filesystem. Every word around the rows comes from
// ../content/landing.ts.
//
// The catalog after mockup round 11 (2026-10-27): the heading, the filter tabs and the
// isometric module drawing share one row, and the modules sit under them as a full-width
// grid of tiles, four across from `lg` (64rem), two from `sm`, one below that. Each tile
// shows the module name, its type and the registry description, cut to three lines only
// in the four-across grid. Below `lg` the drawing sits between the heading and the tabs.
//
// Since 2026-10-29 the heading carries a lead and a line of module counts, and the tabs
// are the registry stages. A capability or a feature gets a tile; its providers and
// drivers show as chips on that tile, so the grid holds no tile that only swaps a vendor.
//
// The tile after mockup round 1 of report 0008 (2026-10-30, option B): the name, the
// founder-facing summary from `landing.catalog.summaries` (the registry description when
// a module has none), then at the foot the "Needs" line, the provider and driver chips,
// and the `saasaloy add` command under a hairline. Each tab radio carries the id
// `catalogTabId` gives, so a stage in ./stages.tsx can select it through a <label>.
//
// The tabs are real radio inputs and "Show all modules" is a real checkbox. The
// `module-catalog` utility in ../styles/web.css reads both through `:has()` and hides
// tiles, so filtering works with JavaScript off. Read that utility before you change a
// `data-*` attribute here.

/** Tiles a tab shows before "Show all modules". The `module-catalog` utility hard-codes it too. */
const CATALOG_VISIBLE_ROWS = 8;

type CatalogTab = "all" | CatalogStage;

export interface ModuleCatalogProps {
  id?: string;
  /** One row per module, in display order. */
  rows: CatalogRow[];
  title?: string;
  description?: string;
  counts?: string;
  filterLabel?: string;
  tabs?: Record<CatalogTab, string>;
  variants?: Record<CatalogVariant["tier"], string>;
  showAll?: string;
  /** Takes `{modules}`. */
  needs?: string;
  /** Takes `{name}`. */
  addCommand?: string;
  /** The tile line per module name; a module with none shows its registry description. */
  summaries?: Record<string, string>;
}

const TABS: CatalogTab[] = ["all", ...CATALOG_STAGES];
const VARIANT_TIERS: CatalogVariant["tier"][] = ["provider", "driver"];

function CubeMark() {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.25"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="text-highlight size-4 shrink-0"
    >
      <path d="M8 1.5 14 5v6l-6 3.5L2 11V5zM2 5l6 3.5L14 5M8 8.5v6" />
    </svg>
  );
}

export function ModuleCatalog({
  id = "catalog",
  rows,
  title = landing.catalog.title,
  description = landing.catalog.description,
  counts = landing.catalog.counts,
  filterLabel = landing.catalog.filterLabel,
  tabs = landing.catalog.tabs,
  variants = landing.catalog.variants,
  showAll = landing.catalog.showAll,
  needs = landing.catalog.needs,
  addCommand = landing.catalog.addCommand,
  summaries = landing.catalog.summaries,
}: ModuleCatalogProps) {
  // The tabs whose rows all fit in the first page; the checkbox hides on them.
  const fits = TABS.filter(
    (tab) =>
      rows.filter((row) => tab === "all" || row.stage === tab).length <=
      CATALOG_VISIBLE_ROWS
  );
  const tierCounts = catalogCounts(rows);
  const total = Object.values(tierCounts).reduce((sum, n) => sum + n, 0);

  return (
    <section id={id} className="section-y module-catalog">
      <div className="section-container-wide">
        <div className="grid gap-x-16 gap-y-8 lg:grid-cols-2 lg:grid-rows-[1fr_auto]">
          <div className="reveal min-w-0 lg:self-end">
            <h2 className="text-section-title text-primary text-balance">
              {title}
            </h2>
            {description && (
              <p className="text-lead text-muted-foreground mt-4 max-w-xl text-pretty">
                {interpolate(description, { total })}
              </p>
            )}
            {counts && (
              <p className="text-highlight mt-4 font-mono text-sm">
                {interpolate(counts, { ...tierCounts, modules: rows.length })}
              </p>
            )}
          </div>

          <ModuleInventory className="text-highlight drawing mx-auto w-full max-w-lg lg:row-span-2 lg:max-w-none lg:self-center" />

          <fieldset className="min-w-0 lg:self-start">
            <legend className="sr-only">{filterLabel}</legend>
            <div className="flex flex-wrap gap-2">
              {TABS.map((tab) => (
                <label
                  key={tab}
                  className="bg-card text-highlight border-border hover:bg-muted has-checked:bg-primary has-checked:border-primary has-checked:text-primary-foreground has-focus-visible:outline-ring relative cursor-pointer border px-3 py-1.5 font-mono text-xs transition-colors has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
                >
                  <input
                    type="radio"
                    id={catalogTabId(id, tab)}
                    name={`${id}-stage`}
                    value={tab}
                    data-catalog-tab={tab}
                    defaultChecked={tab === "all"}
                    className="sr-only"
                  />
                  {tabs[tab]}
                </label>
              ))}
            </div>
          </fieldset>
        </div>

        {/* Each tile draws its own right and bottom hairline and the list draws the top
            and left, so the grid stays closed at any count the filter leaves. */}
        <ul className="border-border mt-8 grid border-t border-l sm:grid-cols-2 lg:grid-cols-4">
          {rows.map((row) => (
            <li
              key={row.name}
              data-catalog-stage={row.stage}
              className="bg-card border-border appear flex flex-col gap-2.5 border-r border-b px-4 py-4"
            >
              <span className="flex min-w-0 items-center gap-2">
                <CubeMark />
                <span className="text-foreground truncate font-mono text-sm font-medium">
                  {row.name}
                </span>
              </span>
              {(summaries[row.name] ?? row.description) && (
                <p className="text-muted-foreground text-sm text-pretty lg:line-clamp-3">
                  {summaries[row.name] ?? row.description}
                </p>
              )}
              <div className="mt-auto flex flex-col gap-1.5 pt-1">
                {row.needs.length > 0 && (
                  <p className="text-muted-foreground font-mono text-xs">
                    {interpolate(needs, { modules: row.needs.join(", ") })}
                  </p>
                )}
                {VARIANT_TIERS.map((tier) => {
                  const chips = row.variants.filter(
                    (variant) => variant.tier === tier
                  );
                  return (
                    chips.length > 0 && (
                      <div
                        key={tier}
                        className="flex flex-wrap items-center gap-1.5"
                      >
                        <span className="text-muted-foreground font-mono text-xs">
                          {variants[tier]}
                        </span>
                        {chips.map((variant) => (
                          <span
                            key={variant.name}
                            title={variant.name}
                            className="border-border text-highlight border px-1.5 py-0.5 font-mono text-xs"
                          >
                            {variant.label}
                          </span>
                        ))}
                      </div>
                    )
                  );
                })}
                <p className="text-highlight border-border border-t pt-2 font-mono text-xs break-all">
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground select-none"
                  >
                    ${" "}
                  </span>
                  {interpolate(addCommand, { name: row.name })}
                </p>
              </div>
            </li>
          ))}
        </ul>

        <label
          data-catalog-fits={fits.join(" ")}
          className={cn(
            "text-highlight mt-4 inline-flex cursor-pointer items-center gap-2 text-sm font-medium",
            "has-focus-visible:outline-ring has-focus-visible:outline-2 has-focus-visible:outline-offset-2"
          )}
        >
          <input
            type="checkbox"
            data-catalog-more=""
            className="accent-primary size-4 rounded-none"
          />
          {showAll}
        </label>
      </div>
    </section>
  );
}
