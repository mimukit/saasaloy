import { landing } from "@web/content/landing";
import { StackOrbits } from "@web/illustrations/stack-orbits";

// Fully static, no script. The built-on section from plan 0092, approved in round 4: the
// stack a project is built with. The title, the lead and the names as chips, in a
// "Frameworks" and a "Libraries and tools" group, sit on the left from `lg` (64rem), and the drawing of the
// same names in orbit round `my-app` sits on the right. Below `lg` the copy comes first.
// The drawing is aria-hidden, so the chips are where a reader, or a search engine,
// finds the names. The first group is the drawing's inner ring, the second its outer.
//
// The drawing loops while it is in view: `drawing-load` and `data-loop-in-view` on its
// <svg>, and LOOP_SCRIPT in ../layouts/Layout.astro pauses it off screen.
//
// Every word comes from ../content/landing.ts.

export interface StackItem {
  id: string;
  label: string;
}

export interface StackGroup {
  id: string;
  label: string;
  items: StackItem[];
}

export interface BuiltOnProps {
  id?: string;
  title?: string;
  description?: string;
  /** The inner ring, then the outer ring. */
  groups?: [StackGroup, StackGroup];
}

export function BuiltOn({
  id = "built-on",
  title = landing.builtOn.title,
  description = landing.builtOn.description,
  groups = landing.builtOn.groups as [StackGroup, StackGroup],
}: BuiltOnProps) {
  const [frameworks, libraries] = groups.map((group) =>
    group.items.map((item) => item.label)
  );
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
          {groups.map((group) => (
            <div key={group.id} className="mt-6">
              <h3 className="text-muted-foreground font-mono text-sm">
                {group.label}
              </h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {group.items.map((item) => (
                  <li
                    key={item.id}
                    className="border-border bg-card text-highlight border px-2 py-1 font-mono text-sm"
                  >
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <StackOrbits
          frameworks={frameworks}
          libraries={libraries}
          className="text-highlight drawing-load w-full"
        />
      </div>
    </section>
  );
}
