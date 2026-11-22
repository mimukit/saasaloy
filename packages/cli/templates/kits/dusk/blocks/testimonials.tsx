import { siteName as defaultSiteName } from "@repo/ui";
import { landing } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";

// The dusk kit's testimonials (Saasaloy UI, plan 0121). Fully static. Three masonry
// columns of soft quote cards in CSS columns, so each quote sets its own card's height.
// Each card opens with a round initials avatar drawn from the person's name; there is no
// avatar image to source or to get wrong.
//
// The default quotes are placeholders that say so. Replace each with a real quote, with
// the person's permission, and delete this section from index.astro until you have three.
// Every word comes from ../content/landing.ts. The props match the ink testimonials, so
// the two files swap for each other.

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
      <div className="section-container-wide">
        <div className="max-w-2xl">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-3 text-balance">
            {description}
          </p>
        </div>

        <div className="mt-10 gap-4 md:columns-2 lg:columns-3">
          {items.map((item) => (
            <figure
              key={item.id}
              className="reveal bg-card text-card-foreground mb-4 flex break-inside-avoid flex-col gap-4 rounded-[calc(var(--radius)*2.4)] border p-6"
            >
              <figcaption className="flex items-center gap-3">
                <span
                  aria-hidden="true"
                  className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-full text-xs font-semibold"
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
              <blockquote className="text-pretty">
                <p>{interpolate(item.quote, { siteName })}</p>
              </blockquote>
            </figure>
          ))}
        </div>
      </div>
    </section>
  );
}
