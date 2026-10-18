import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { iconFor } from "@repo/ui/lib/icons";
import { interpolate } from "@repo/ui/lib/interpolate";

// Fully static. Who the product is for, as a two-by-two list of inverted icon squares
// over a faint, fading grid. Icon names resolve through ../lib/icons.ts, the same
// vocabulary the feature grid uses.
//
// Every word comes from ../content/landing.ts.

export interface AudienceItem {
  /** Stable key, never the array position (see the content file). */
  id: string;
  icon: string;
  title: string;
  description: string;
}

export interface AudienceProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  items?: AudienceItem[];
}

export function Audience({
  id = "audience",
  siteName = defaultSiteName,
  title = landing.audience.title,
  description = interpolate(landing.audience.description, { siteName }),
  items = landing.audience.items,
}: AudienceProps) {
  return (
    <section id={id} className="section-y relative isolate">
      <div
        aria-hidden="true"
        className="grid-pattern absolute inset-0 -z-10 [mask-image:radial-gradient(ellipse_at_center,#000,transparent_70%)] [--grid-line:color-mix(in_oklch,var(--foreground)_5%,transparent)] [--grid-size:150px]"
      />
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        <ul className="mx-auto mt-12 grid max-w-2xl gap-x-12 gap-y-8 md:mt-16 md:grid-cols-2">
          {items.map((item) => {
            const Icon = iconFor(item.icon);
            return (
              <li key={item.id} className="reveal flex gap-4">
                <span
                  aria-hidden="true"
                  className="bg-foreground text-background grid size-8 shrink-0 place-items-center rounded-lg"
                >
                  <Icon className="size-4" />
                </span>
                <div>
                  <h3 className="mb-1.5 font-semibold">{item.title}</h3>
                  <p className="text-muted-foreground text-sm text-pretty">
                    {interpolate(item.description, { siteName })}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
