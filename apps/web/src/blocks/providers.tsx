import { landing } from "@web/content/landing";
import { ProviderModules } from "@web/illustrations/provider-modules";
import { inlineCode } from "@web/lib/inline-code";

// Fully static, no script. The round 10 providers section: the title with a small `.env`
// panel beside it, then the drawing of one capability and its three providers, with the
// short points beside the drawing from `lg` (64rem). Below `lg` the points come before
// the drawing, so the copy still leads.
//
// Every word comes from ../content/landing.ts. Backticks in a point render as <code>.

export interface ProviderPoint {
  id: string;
  title: string;
  description: string;
}

export interface ProvidersProps {
  id?: string;
  title?: string;
  envLabel?: string;
  envExample?: string;
  points?: ProviderPoint[];
}

export function Providers({
  id = "providers",
  title = landing.providers.title,
  envLabel = landing.providers.envLabel,
  envExample = landing.providers.envExample,
  points = landing.providers.points,
}: ProvidersProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-wide">
        <div className="reveal flex flex-col gap-8 lg:flex-row lg:items-start lg:justify-between">
          <h2 className="text-section-title text-highlight max-w-[22ch] text-balance">
            {title}
          </h2>
          <figure className="border-border bg-card w-full max-w-xs border font-mono text-sm">
            <figcaption className="text-highlight border-border border-b px-3 py-1.5 text-xs">
              {envLabel}
            </figcaption>
            <pre className="text-foreground px-3 py-2.5">
              <code>{envExample}</code>
            </pre>
          </figure>
        </div>

        <div className="mt-12 grid gap-12 lg:grid-cols-[minmax(0,1fr)_18rem] lg:items-center lg:gap-10">
          <ul className="flex flex-col gap-6 lg:order-2">
            {points.map((point) => (
              <li
                key={point.id}
                className="border-highlight reveal border-l pl-4"
              >
                <p className="text-highlight font-medium">{point.title}</p>
                <p className="text-muted-foreground mt-1 text-sm text-pretty [&_code]:whitespace-nowrap">
                  {inlineCode(point.description)}
                </p>
              </li>
            ))}
          </ul>
          <ProviderModules className="text-highlight reveal w-full lg:order-1" />
        </div>
      </div>
    </section>
  );
}
