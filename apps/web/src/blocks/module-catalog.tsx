import { landing } from "@web/content/landing";
import { ModuleInventory } from "@web/illustrations/module-inventory";
import { CATALOG_TIERS } from "@web/lib/module-catalog";
import type { CatalogRow } from "@web/lib/module-catalog";
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
// The tabs are real radio inputs and "Show all modules" is a real checkbox. The
// `module-catalog` utility in ../styles/web.css reads both through `:has()` and hides
// tiles, so filtering works with JavaScript off. Read that utility before you change a
// `data-*` attribute here.

/** Tiles a tab shows before "Show all modules". The `module-catalog` utility hard-codes it too. */
export const CATALOG_VISIBLE_ROWS = 8;

type CatalogTab = "all" | (typeof CATALOG_TIERS)[number];

export interface ModuleCatalogProps {
  id?: string;
  /** One row per module, in display order. */
  rows: CatalogRow[];
  title?: string;
  description?: string;
  filterLabel?: string;
  tabs?: Record<CatalogTab, string>;
  tiers?: Record<(typeof CATALOG_TIERS)[number], string>;
  showAll?: string;
}

const TABS: CatalogTab[] = ["all", ...CATALOG_TIERS];

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
  filterLabel = landing.catalog.filterLabel,
  tabs = landing.catalog.tabs,
  tiers = landing.catalog.tiers,
  showAll = landing.catalog.showAll,
}: ModuleCatalogProps) {
  // The tabs whose rows all fit in the first page; the checkbox hides on them.
  const fits = TABS.filter(
    (tab) =>
      rows.filter((row) => tab === "all" || row.tier === tab).length <=
      CATALOG_VISIBLE_ROWS
  );

  return (
    <section id={id} className="section-y module-catalog">
      <div className="section-container-wide">
        <div className="grid gap-x-16 gap-y-8 lg:grid-cols-2 lg:grid-rows-[1fr_auto]">
          <div className="reveal min-w-0 lg:self-end">
            <h2 className="text-section-title text-highlight text-balance">
              {title}
            </h2>
            {description && (
              <p className="text-lead text-muted-foreground mt-4 text-balance">
                {description}
              </p>
            )}
          </div>

          <ModuleInventory className="text-highlight reveal mx-auto w-full max-w-lg lg:row-span-2 lg:max-w-none lg:self-center" />

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
                    name={`${id}-tier`}
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
              data-tier={row.tier}
              className="bg-card border-border appear flex flex-col gap-2.5 border-r border-b px-4 py-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <CubeMark />
                  <span className="text-foreground truncate font-mono text-sm font-medium">
                    {row.name}
                  </span>
                </span>
                <span className="bg-secondary text-secondary-foreground shrink-0 px-2 py-0.5 font-mono text-xs whitespace-nowrap">
                  {tiers[row.tier]}
                </span>
              </div>
              {row.description && (
                <p className="text-muted-foreground text-sm text-pretty lg:line-clamp-3">
                  {row.description}
                </p>
              )}
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
