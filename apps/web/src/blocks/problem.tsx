import { landing } from "@web/content/landing";
import { ModuleCity } from "@web/illustrations/module-city";

// Fully static, no script. The problem section from plan 0092, approved in round 4: why
// a boilerplate costs a week, and the stage-by-stage answer. The title, the README line
// under it and a contrast line in a `highlight`-bordered block sit on the right from
// `lg` (64rem), and the module city sits on the left. Below `lg` the copy comes first.
// No eyebrow, as in every other section.
//
// The city loops while it is in view: `drawing-load` and `data-loop-in-view` on its
// <svg>, and LOOP_SCRIPT in ../layouts/Layout.astro pauses it off screen.
//
// Every word comes from ../content/landing.ts.

export interface ProblemProps {
  id?: string;
  title?: string;
  description?: string;
  contrast?: string;
}

export function Problem({
  id = "problem",
  title = landing.problem.title,
  description = landing.problem.description,
  contrast = landing.problem.contrast,
}: ProblemProps) {
  return (
    <section id={id} className="section-y">
      <div className="section-container-wide grid gap-12 lg:grid-cols-2 lg:items-center lg:gap-16">
        <div className="reveal min-w-0">
          <h2 className="text-section-title text-primary max-w-[18ch] text-balance">
            {title}
          </h2>
          <p className="text-lead text-muted-foreground mt-6 max-w-xl text-pretty">
            {description}
          </p>
          <p className="border-highlight text-muted-foreground mt-10 max-w-lg border-l pl-6 font-mono text-sm leading-7 text-pretty">
            {contrast}
          </p>
        </div>

        <div className="lg:order-first">
          <ModuleCity className="text-highlight drawing-load w-full" />
        </div>
      </div>
    </section>
  );
}
