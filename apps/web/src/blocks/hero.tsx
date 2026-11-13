import type { ReactNode } from "react";
import { ArrowDownIcon, ArrowRightIcon, BookOpenIcon } from "lucide-react";

import { CommandField } from "@web/components/command-field";
import { landing } from "@web/content/landing";
import { SourceTree } from "@web/illustrations/source-tree";
import { cliVersion } from "@web/lib/cli-version";
import { externalLinkProps, newTabHint } from "@web/lib/external-link";
import { GITHUB_MARK } from "@web/lib/github-mark";
import { interpolate } from "@web/lib/interpolate";
import type { CatalogRow } from "@web/lib/module-catalog";
import { cn } from "@web/lib/utils";

// Static. The command field's copy button is the one interactive part, and index.astro
// passes it in hydrated through the `commandField` slot. Rendered on its own, the hero
// draws a static field: the command stays selectable and the page ships no JavaScript
// for it. The motion is CSS: `blur-in` from ../styles/web.css on the command field and
// the note, staggered with `--blur-in-delay`, and still under reduced motion. The title
// and the description paint at once: the description is the page's LCP element, and an
// entry that starts at `opacity: 0` held LCP at 2.7 s (docs/seo/0002). The drawing plays
// its own entry through `drawing-load`, then loops. LOOP_SCRIPT in ../layouts/Layout.astro marks the
// drawing `data-offscreen` while it is out of view, and the CSS pauses every loop in it
// then. Without JavaScript the loops never pause.
//
// The hero is the two-column mockup the owner approved on 2026-11-06. It fills the first
// viewport, the navbar included: `min-h-svh`, a minimum and never a fixed height, so
// nothing clips when the text needs more room. Copy on the left and the drawing on the
// right from `lg` (64rem); below it the drawing follows the copy at full width, and the
// section grows past the viewport. A hairline under the navbar spans the container, and
// the foot holds the link down to the catalog over a `blueprint-rule` at the bottom of the
// viewport. The title's first sentence is `foreground`, the second `primary`, and its
// size follows the copy column (`text-display` reads `cqi`, up to 4rem). The drawing is
// the source tree in ../illustrations/source-tree.tsx, unchanged from plan 0092.
//
// The eyebrow above the title and the drafting marks around the drawing (dimension lines,
// centre lines and corner crosses) are variant V3, approved on 2026-11-06, and the hero
// draws its own graph paper at 25% and 45% over `background`, a step firmer than the
// page's. The marks show from `xl`, where the full drawing has room around it, and sit
// behind the drawing's panels.
//
// The module strip fills the band above the foot: mockup variant A, approved on
// 2026-11-06. Its chips are the names in `landing.hero.modules` that the registry still
// has, read from the catalog rows index.astro passes in, and the last chip counts the
// catalog tiles the strip leaves out and links to the catalog. The chips are static, so
// a keyboard meets one stop, the "+N more" link.
//
// Every word comes from ../content/landing.ts. Edit the copy there, not here.

export interface HeroLink {
  /** `github` draws the GitHub mark, any other id the book icon. */
  id: string;
  label: string;
  href: string;
}

export interface HeroProps {
  /** The mono line above the title. Empty hides it. */
  eyebrow?: string;
  titleLead?: string;
  titleAccent?: string;
  description?: string;
  command?: string;
  links?: HeroLink[];
  note?: string;
  /** The label of the link down to the module catalog. Empty hides the link. */
  explore?: string;
  /** The catalog rows from index.astro. Without them the module strip does not render. */
  rows?: CatalogRow[];
  /** The label over the module strip. */
  modulesLabel?: string;
  /** The module names the strip shows, in order, when the registry has them. */
  modules?: string[];
  /** The last chip, which takes `{count}` and links to the catalog. */
  modulesMore?: string;
  /** The labels of the dimension lines around the drawing. */
  annotations?: DrawingAnnotationLabels;
  /** A hydrated command field from index.astro. Defaults to a static one. */
  commandField?: ReactNode;
}

/**
 * The hero's links, one per row item. ./start.tsx shows the same list. `size="lg"` is the
 * hero's: mono labels, larger icons and no trailing arrow, as the approved mockup shows.
 */
export function HeroLinkList({
  links,
  size = "md",
}: {
  links: HeroLink[];
  size?: "md" | "lg";
}) {
  const large = size === "lg";
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-y-2",
        large ? "gap-x-8 font-mono text-sm" : "gap-x-6 text-sm"
      )}
    >
      {links.map((link) => (
        <li key={link.id}>
          <a
            href={link.href}
            {...externalLinkProps(link.href)}
            className={cn(
              "text-highlight inline-flex items-center font-medium underline-offset-4 hover:underline",
              large ? "gap-3" : "gap-2"
            )}
          >
            {link.id === "github" ? (
              GITHUB_MARK
            ) : (
              <BookOpenIcon aria-hidden="true" className="size-4" />
            )}
            {link.label}
            {!large && (
              <ArrowRightIcon aria-hidden="true" className="size-3.5" />
            )}
            {newTabHint(link.href)}
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface DrawingAnnotationLabels {
  /** Over the drawing: what `saasaloy init` writes. */
  top: string;
  /** Under the drawing: where `saasaloy add` writes. */
  bottom: string;
  /** Beside the drawing: the whole tree. */
  side: string;
}

/** The full drawing's box, in its own viewBox units (../illustrations/source-tree.tsx). */
const BOX = { w: 640, h: 432 };
/** The panels' outer edges inside that box, and the centre between them. */
const EDGE = { l: 8, r: 632, t: 8, b: 424 };
const MID = { x: (EDGE.l + EDGE.r) / 2, y: (EDGE.t + EDGE.b) / 2 };
/** Where the dimension lines run: above, below and right of the drawing. */
const DIM = { top: -38, bottom: BOX.h + 38, side: EDGE.r + 30 };

/** A short line in drawing units. */
const seg = (x1: number, y1: number, x2: number, y2: number) =>
  `M${x1} ${y1}L${x2} ${y2}`;

/** A small drafting cross centred on (x, y). */
const cross = (x: number, y: number) =>
  seg(x - 7, y, x + 7, y) + seg(x, y - 7, x, y + 7);

/** A label on a dimension line, on a `background` patch that breaks the line. */
function DimensionLabel({
  x,
  y,
  width,
  vertical = false,
  children,
}: {
  x: number;
  y: number;
  width: number;
  vertical?: boolean;
  children: string;
}) {
  return (
    <g transform={vertical ? `rotate(-90 ${x} ${y})` : undefined}>
      <rect
        x={x - width / 2}
        y={y - 10}
        width={width}
        height={20}
        stroke="none"
        className="fill-background"
      />
      <text
        x={x}
        y={y + 4}
        textAnchor="middle"
        fontSize={12}
        stroke="none"
        className="fill-current font-mono"
      >
        {children}
      </text>
    </g>
  );
}

/**
 * The drafting marks around the hero drawing: variant V3, approved on 2026-11-06. Two
 * width dimensions name what `init` and `add` write, a height dimension names the tree,
 * dash-dot centre lines cross the drawing, and a cross marks each corner of its panels.
 * The layer sits over the drawing's own box and shares its viewBox, so it scales with
 * the drawing; `overflow-visible` lets the marks run past that box. Static and
 * decorative: no motion, and hidden from assistive technology.
 */
function DrawingAnnotations({
  labels,
  className,
}: {
  labels: DrawingAnnotationLabels;
  className: string;
}) {
  const label = (text: string) => Math.max(80, text.length * 7.2 + 24);
  return (
    <svg
      viewBox={`0 0 ${BOX.w} ${BOX.h}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* Centre lines, dash-dot, broken where they cross a dimension label. */}
      <path
        strokeDasharray="16 5 3 5"
        className="opacity-45"
        d={
          seg(EDGE.l - 20, MID.y, EDGE.r + 20, MID.y) +
          seg(MID.x, EDGE.t - 68, MID.x, DIM.top - 12) +
          seg(MID.x, DIM.top + 12, MID.x, DIM.bottom - 12) +
          seg(MID.x, DIM.bottom + 12, MID.x, EDGE.b + 68)
        }
      />
      {/* Extension lines from the panels' edges out to the width dimensions. */}
      <path
        strokeDasharray="3 4"
        className="opacity-30"
        d={[EDGE.l + 8, EDGE.r - 8]
          .map(
            (x) =>
              seg(x, DIM.top - 6, x, EDGE.t) + seg(x, EDGE.b, x, DIM.bottom + 6)
          )
          .join("")}
      />
      <g className="opacity-55">
        {[DIM.top, DIM.bottom].map((y) => (
          <path
            key={y}
            d={
              seg(EDGE.l + 8, y, EDGE.r - 8, y) +
              seg(EDGE.l + 8, y - 5, EDGE.l + 8, y + 5) +
              seg(EDGE.r - 8, y - 5, EDGE.r - 8, y + 5)
            }
          />
        ))}
        <path
          d={
            seg(EDGE.r + 5, EDGE.t, DIM.side + 5, EDGE.t) +
            seg(EDGE.r + 5, EDGE.b, DIM.side + 5, EDGE.b) +
            seg(DIM.side, EDGE.t, DIM.side, EDGE.b) +
            seg(DIM.side - 5, EDGE.t, DIM.side + 5, EDGE.t) +
            seg(DIM.side - 5, EDGE.b, DIM.side + 5, EDGE.b) +
            [EDGE.l, EDGE.r]
              .flatMap((x) => [cross(x, EDGE.t), cross(x, EDGE.b)])
              .join("")
          }
        />
      </g>
      <g className="opacity-80">
        <DimensionLabel x={MID.x} y={DIM.top} width={label(labels.top)}>
          {labels.top}
        </DimensionLabel>
        <DimensionLabel x={MID.x} y={DIM.bottom} width={label(labels.bottom)}>
          {labels.bottom}
        </DimensionLabel>
        <DimensionLabel
          x={DIM.side}
          y={MID.y}
          width={label(labels.side)}
          vertical
        >
          {labels.side}
        </DimensionLabel>
      </g>
    </svg>
  );
}

/** No catalog rows: a stable default, so the strip does not render. */
const NO_ROWS: CatalogRow[] = [];

export function Hero({
  eyebrow = landing.hero.eyebrow,
  titleLead = landing.hero.titleLead,
  titleAccent = landing.hero.titleAccent,
  description = landing.hero.description,
  command = landing.hero.command,
  links = landing.hero.links,
  note = interpolate(landing.hero.note, { version: cliVersion }),
  explore = landing.hero.explore,
  rows = NO_ROWS,
  modulesLabel = landing.hero.modulesLabel,
  modules = landing.hero.modules,
  modulesMore = landing.hero.modulesMore,
  annotations = landing.hero.annotations,
  commandField,
}: HeroProps) {
  // A name the registry no longer has drops out, so the strip never names a dead module.
  const tiles = new Set(rows.map((row) => row.name));
  const shown = modules.filter((name) => tiles.has(name));
  const more = rows.length - shown.length;
  return (
    <section className="bg-background blueprint-grid flex min-h-svh flex-col pt-14 [--blueprint-mix-major:45%] [--blueprint-mix:25%]">
      <div aria-hidden="true" className="section-container-hero">
        <div className="border-border border-t" />
      </div>
      <div className="section-container-hero grid flex-1 items-center gap-12 py-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-8 lg:pt-16 lg:pb-6">
        <div className="@container flex flex-col gap-7">
          <div className="flex flex-col gap-5">
            {eyebrow && (
              <p className="text-muted-foreground flex items-center gap-3 font-mono text-xs tracking-wider uppercase">
                <span aria-hidden="true" className="bg-highlight h-px w-6" />
                {eyebrow}
              </p>
            )}
            <h1 className="text-display">
              <span className="text-foreground block">{titleLead}</span>
              <span className="text-primary block">{titleAccent}</span>
            </h1>
          </div>
          <p className="text-muted-foreground max-w-xl text-lg text-pretty">
            {description}
          </p>
          <div className="blur-in mt-2 flex flex-col gap-6">
            {commandField ?? <CommandField size="lg" command={command} />}
            <HeroLinkList links={links} size="lg" />
          </div>
          {note && (
            <p className="text-muted-foreground blur-in font-mono text-xs [--blur-in-delay:100ms] sm:text-sm">
              {note}
            </p>
          )}
        </div>

        <div className="relative isolate w-full min-w-0">
          <SourceTree className="text-highlight drawing-load w-full" />
          <DrawingAnnotations
            labels={annotations}
            className="text-highlight absolute inset-0 -z-10 hidden size-full overflow-visible xl:block"
          />
        </div>
      </div>
      {shown.length > 0 && (
        <div className="section-container-hero flex flex-col gap-3 pb-8">
          <p
            id="hero-modules"
            className="text-muted-foreground font-mono text-xs tracking-wider uppercase"
          >
            {modulesLabel}
          </p>
          <ul
            aria-labelledby="hero-modules"
            className="flex flex-wrap gap-2 font-mono text-[0.8125rem]"
          >
            {shown.map((name) => (
              <li
                key={name}
                className="border-border bg-card text-foreground border px-3 py-1.5"
              >
                {name}
              </li>
            ))}
            {more > 0 && (
              <li>
                <a
                  href="#catalog"
                  className="border-border bg-card text-highlight hover:border-highlight inline-block border px-3 py-1.5 underline-offset-4 transition-colors hover:underline"
                >
                  {interpolate(modulesMore, { count: String(more) })}
                </a>
              </li>
            )}
          </ul>
        </div>
      )}
      {explore && (
        <div className="section-container-hero flex justify-center pt-2 pb-3">
          <a
            href="#catalog"
            className="text-foreground hover:text-highlight inline-flex items-center gap-2 font-mono text-sm underline-offset-4 transition-colors hover:underline"
          >
            {explore}
            <ArrowDownIcon aria-hidden="true" className="size-4" />
          </a>
        </div>
      )}
      <div
        aria-hidden="true"
        className="blueprint-rule [--rule-inset:1.5rem] lg:[--rule-inset:3rem]"
      />
    </section>
  );
}
