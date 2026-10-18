import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";

// Fully static. A masonry grid of quote cards in CSS columns, so long and short quotes
// pack without a row of equal boxes. Each card draws an initials circle from the person's
// name; there is no avatar image to source or to get wrong.
//
// The default quotes are placeholders that say so. Replace each with a real quote, with
// the person's permission, and delete this section from index.astro until you have three.
// Every word comes from ../content/landing.ts.

export interface Testimonial {
  /** Stable key, never the array position (see the content file). */
  id: string;
  quote: string;
  name: string;
  role: string;
}

export interface TestimonialsProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  items?: Testimonial[];
}

/** The first letter of the first two words, upper-cased: "Customer name" is "CN". */
function initials(name: string): string {
  return name
    .split(/\s+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}

export function Testimonials({
  id = "testimonials",
  siteName = defaultSiteName,
  title = landing.testimonials.title,
  description = interpolate(landing.testimonials.description, { siteName }),
  items = landing.testimonials.items,
}: TestimonialsProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        <div className="mt-12 gap-6 md:mt-16 md:columns-2 lg:columns-3">
          {items.map((item) => (
            <figure
              key={item.id}
              className="reveal mb-6 flex break-inside-avoid flex-col gap-4 rounded-xl border p-6 shadow-xs"
            >
              <figcaption className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-full border text-xs font-semibold"
                >
                  {initials(item.name)}
                </span>
                <span className="flex flex-col">
                  <span className="text-sm font-semibold">{item.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {item.role}
                  </span>
                </span>
              </figcaption>
              <blockquote className="text-sm text-pretty">
                <p>{interpolate(item.quote, { siteName })}</p>
              </blockquote>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
