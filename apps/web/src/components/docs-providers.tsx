import { useState } from "react";

import type { ProvidersData } from "@web/lib/docs-blocks-data";
import { cn } from "@web/lib/utils";

// The `saasaloy-providers` block's island (plan 0114 Phase 4), in the style of the landing
// providers drawing (src/illustrations/provider-modules.tsx): the capability as one frame
// with its `primary` interface tab, a bus, and a frame for each provider module plugged
// under it. A reader picks a provider, as the selector variable would at runtime, and the
// line under the drawing shows the value to set. Without JavaScript the plugin's list says
// the same (lib/docs-blocks.ts).

export function DocsProviders({ data }: { data: ProvidersData }) {
  const [first] = data.providers;
  const [value, setValue] = useState(first?.value ?? "");
  return (
    <figure className="border-border bg-card border p-4 md:p-6">
      <div className="mx-auto flex w-full max-w-xs flex-col items-center">
        <div className="border-border bg-background w-full border px-3 py-2 text-center">
          <p className="text-muted-foreground font-mono text-xs uppercase">
            Capability
          </p>
          <p className="font-mono text-base font-semibold">{data.capability}</p>
        </div>
        <span className="bg-primary h-2.5 w-12" aria-hidden="true" />
      </div>
      <div
        aria-hidden="true"
        className="bg-highlight mx-auto h-4 w-px md:h-5"
      />
      <ul
        className="saasaloy-list grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] md:border-t md:border-t-[color:var(--highlight)] md:pt-5"
        aria-label={`${data.capability} providers`}
      >
        {data.providers.map((provider) => {
          const on = provider.value === value;
          return (
            <li key={provider.name} className="flex">
              <button
                type="button"
                aria-pressed={on}
                className={cn(
                  "press border-border bg-background hover:bg-muted flex w-full flex-col items-start gap-1 border p-3 text-left",
                  on &&
                    "border-primary bg-primary text-primary-foreground hover:bg-primary"
                )}
                onClick={() => {
                  setValue(provider.value);
                }}
              >
                <span className="font-mono text-[13px] font-semibold">
                  {provider.name}
                </span>
                <span
                  className={cn(
                    "text-sm",
                    on ? "text-primary-foreground" : "text-muted-foreground"
                  )}
                >
                  {provider.description}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <figcaption className="border-border bg-background mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border px-3 py-2 font-mono text-sm">
        <span className="text-muted-foreground" aria-hidden="true">
          $
        </span>
        <span>
          {data.selector}={value}
        </span>
      </figcaption>
    </figure>
  );
}
