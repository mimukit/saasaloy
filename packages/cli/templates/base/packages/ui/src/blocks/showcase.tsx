import type { ReactNode } from "react";
import { ArrowRightIcon, CheckIcon } from "lucide-react";

import { siteName as defaultSiteName } from "@repo/ui";
import { landing, ui } from "@repo/ui/content/landing";
import { interpolate } from "@repo/ui/lib/interpolate";
import { cn } from "@repo/ui/lib/utils";

// Fully static. Image-led rows that alternate sides, each in a soft double frame.
//
// A row shows a screenshot when its `imageSrc` is set — put the file in apps/web/public
// and write a real `imageAlt`. With `imageSrc` empty, the row draws the built-in visual
// its `visual` names, from the lists under `landing.showcase`. Add a visual by adding a
// function to VISUALS; a name it doesn't know draws nothing but the frame.
//
// Every word comes from ../content/landing.ts.

type Row = (typeof landing.showcase.rows)[number];

function Chips({ names }: { names: readonly string[] }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {names.map((name) => (
        <code
          key={name}
          className="bg-background rounded-full border px-2 py-0.5 font-mono text-[0.6875rem]"
        >
          {name}
        </code>
      ))}
    </span>
  );
}

const VISUALS: Record<string, () => ReactNode> = {
  stages: () => (
    <ol className="flex flex-col">
      {landing.showcase.stages.map((stage, index) => (
        <li
          key={stage.id}
          className="grid grid-cols-[1.5rem_1fr] gap-x-3 gap-y-1.5 border-b border-dashed py-3 last:border-b-0"
        >
          <span
            aria-hidden="true"
            className="bg-foreground text-background row-span-2 grid size-6 place-items-center rounded-full text-xs font-semibold"
          >
            {index + 1}
          </span>
          <span className="text-sm font-semibold">{stage.title}</span>
          <Chips names={stage.modules} />
        </li>
      ))}
    </ol>
  ),
  modules: () => (
    <div className="flex flex-col gap-4">
      {landing.showcase.moduleGroups.map((group) => (
        <div key={group.id}>
          <p className="mb-2 text-xs font-semibold">
            {group.title}{" "}
            <span className="text-muted-foreground font-medium">
              {interpolate(ui.showcase.moduleCount, {
                count: group.modules.length,
              })}
            </span>
          </p>
          <Chips names={group.modules} />
        </div>
      ))}
    </div>
  ),
  skills: () => (
    <ul className="flex flex-col gap-3">
      {landing.showcase.skills.map((skill) => (
        <li key={skill.id} className="bg-background rounded-lg border p-3.5">
          <p className="mb-1.5 flex flex-wrap items-center gap-2 font-mono text-[0.8125rem]">
            <code>{skill.name}</code>
            <ArrowRightIcon
              aria-hidden="true"
              className="text-muted-foreground size-3"
            />
            <code className="text-muted-foreground break-all">
              {skill.target}
            </code>
          </p>
          <p className="text-muted-foreground text-[0.8125rem]">
            {skill.description}
          </p>
        </li>
      ))}
    </ul>
  ),
};

function Visual({ row }: { row: Row }) {
  if (row.imageSrc) {
    return (
      <img
        src={row.imageSrc}
        alt={row.imageAlt}
        loading="lazy"
        className="block w-full rounded-[0.875rem] border"
      />
    );
  }
  const draw = Object.hasOwn(VISUALS, row.visual)
    ? VISUALS[row.visual]
    : undefined;
  return (
    <div className="bg-card rounded-[0.875rem] border p-4 shadow-[0_10px_30px_-10px_color-mix(in_oklch,var(--foreground)_15%,transparent)]">
      {draw?.()}
    </div>
  );
}

export interface ShowcaseProps {
  id?: string;
  siteName?: string;
  title?: string;
  description?: string;
  rows?: Row[];
}

export function Showcase({
  id = "showcase",
  siteName = defaultSiteName,
  title = landing.showcase.title,
  description = interpolate(landing.showcase.description, { siteName }),
  rows = landing.showcase.rows,
}: ShowcaseProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container">
        <div className="mx-auto max-w-2xl text-center">
          <h2 className="text-section-title text-balance">{title}</h2>
          <p className="text-lead text-muted-foreground mt-4 text-balance">
            {description}
          </p>
        </div>

        <div className="mt-12 flex flex-col gap-16 md:mt-16">
          {rows.map((row, index) => (
            <div
              key={row.id}
              className={cn(
                "reveal grid items-center gap-8 md:gap-16",
                index % 2 === 0
                  ? "md:grid-cols-[7fr_5fr]"
                  : "md:grid-cols-[5fr_7fr]"
              )}
            >
              <div
                className={cn(
                  "from-muted min-w-0 rounded-[1.25rem] border bg-linear-to-b to-transparent p-2",
                  index % 2 === 1 && "md:order-2"
                )}
              >
                <Visual row={row} />
              </div>
              <div className="flex min-w-0 flex-col gap-4">
                <h3 className="text-2xl font-semibold tracking-tight">
                  {interpolate(row.title, { siteName })}
                </h3>
                <p className="text-muted-foreground text-pretty">
                  {interpolate(row.description, { siteName })}
                </p>
                <ul className="mt-1 flex flex-col gap-2 text-sm">
                  {row.points.map((point) => (
                    <li key={point.id} className="flex items-center gap-2">
                      <CheckIcon
                        aria-hidden="true"
                        className="size-4 shrink-0"
                      />
                      {point.text}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
