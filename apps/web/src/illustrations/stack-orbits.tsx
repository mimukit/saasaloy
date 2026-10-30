// The built-on section's illustration: `my-app` at the centre with the stack in orbit,
// after variant H of the round 2 hero exploration and the round 4 mockup the owner
// approved. The inner ring holds the frameworks and the outer ring the libraries and
// tools. `my-app` is the one `primary` fill. No logos. Decorative: the section repeats
// every name as a text chip, so the names stay readable and searchable.
//
// Two layouts, because no label may render under 10px on screen. The full one names each
// node at 10 units and shows from `md` to `lg` and from `xl`. Below `md`, and in the
// narrower column from `lg` to `xl`, the compact one draws each node as a small square
// with no name, beside the chips that carry the names.
//
// Motion: the drawing loops while it is in view, like the hero. The <svg> takes
// `drawing-load`, so the rings and the nodes play in when it enters. Then each node runs
// round its ring (`orbit`): the inner ring one way in 48s, the outer ring the other way
// in 80s. With reduced motion, or without `offset-path`, each node sits at its place on
// the ring. The script in ../layouts/Layout.astro pauses it all while the drawing is off
// screen.

import type { CSSProperties } from "react";

import { Assemble, Label } from "@web/illustrations/parts";

interface Ring {
  rx: number;
  ry: number;
  /** Seconds a lap takes. */
  s: number;
  reverse?: boolean;
  dash: string;
  names: string[];
}

interface Layout {
  width: number;
  height: number;
  /** The globe's radius. */
  r: number;
  inner: Omit<Ring, "s" | "names" | "dash">;
  outer: Omit<Ring, "s" | "names" | "dash">;
  named: boolean;
}

const FULL: Layout = {
  width: 580,
  height: 316,
  r: 48,
  inner: { rx: 135, ry: 68 },
  outer: { rx: 234, ry: 140 },
  named: true,
};

const COMPACT: Layout = {
  width: 320,
  height: 220,
  r: 30,
  inner: { rx: 78, ry: 40 },
  outer: { rx: 140, ry: 88 },
  named: false,
};

/** One lap of an ellipse round (cx, cy), from its left end. */
const lap = (cx: number, cy: number, rx: number, ry: number) =>
  `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${2 * rx} 0a${rx} ${ry} 0 1 0 ${-2 * rx} 0`;

function Node({
  name,
  named,
  ring,
  n,
  cx,
  cy,
}: {
  name: string;
  named: boolean;
  ring: Ring;
  n: number;
  cx: number;
  cy: number;
}) {
  const { rx, ry, s, reverse = false, names } = ring;
  const share = n / names.length;
  // Its place on the ring with no motion, at the same share of the lap.
  const angle = share * 2 * Math.PI;
  const x = cx - rx * Math.cos(angle);
  const y = cy + ry * Math.sin(angle);
  const width = name.length * 6 + 14;
  return (
    <g
      className="orbit"
      transform={`translate(${x.toFixed(1)} ${y.toFixed(1)})`}
      style={
        {
          "--orbit-path": `path("${lap(cx, cy, rx, ry)}")`,
          "--orbit-s": `${s}s`,
          "--orbit-delay": `${(-share * s).toFixed(2)}s`,
          "--orbit-direction": reverse ? "reverse" : "normal",
        } as CSSProperties
      }
    >
      {named ? (
        <>
          <rect
            x={-width / 2}
            y={-10}
            width={width}
            height={20}
            className="fill-card"
          />
          <Label x={0} y={3.5} size={10} anchor="middle">
            {name}
          </Label>
        </>
      ) : (
        <rect x={-4} y={-4} width={8} height={8} className="fill-card" />
      )}
    </g>
  );
}

function Orbits({
  layout,
  frameworks,
  libraries,
  className,
}: {
  layout: Layout;
  frameworks: string[];
  libraries: string[];
  className: string;
}) {
  const { width, height, r, named } = layout;
  const cx = width / 2;
  const cy = height / 2;
  const rings: Ring[] = [
    { ...layout.inner, s: 48, dash: "6 5", names: frameworks },
    { ...layout.outer, s: 80, reverse: true, dash: "1 4", names: libraries },
  ];
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      data-loop-in-view
      className={className}
    >
      {rings.map((ring, k) => (
        <Assemble key={ring.rx} at={k * 15}>
          <ellipse
            cx={cx}
            cy={cy}
            rx={ring.rx}
            ry={ring.ry}
            strokeDasharray={ring.dash}
          />
        </Assemble>
      ))}
      {/* `my-app`, a globe with its meridians in `primary-foreground`. */}
      <Assemble at={0}>
        <circle cx={cx} cy={cy} r={r} stroke="none" className="fill-primary" />
        <g className="stroke-primary-foreground" strokeOpacity="0.45">
          <ellipse cx={cx} cy={cy} rx={r} ry={r * 0.32} />
          <ellipse cx={cx} cy={cy} rx={r * 0.36} ry={r} />
          <ellipse cx={cx} cy={cy} rx={r * 0.76} ry={r} />
        </g>
        <Label
          x={cx}
          y={cy + 4.5}
          size={named ? 13 : 12}
          anchor="middle"
          className="fill-primary-foreground font-semibold"
        >
          my-app
        </Label>
      </Assemble>
      {rings.map((ring, k) => (
        <Assemble key={ring.rx} at={30 + k * 15}>
          {ring.names.map((name, n) => (
            <Node
              key={name}
              name={name}
              named={named}
              ring={ring}
              n={n}
              cx={cx}
              cy={cy}
            />
          ))}
        </Assemble>
      ))}
    </svg>
  );
}

/** Both layouts in one box; `className` goes on each <svg>. */
export function StackOrbits({
  frameworks,
  libraries,
  className = "",
}: {
  frameworks: string[];
  libraries: string[];
  className?: string;
}) {
  return (
    <div className="w-full min-w-0">
      <Orbits
        layout={FULL}
        frameworks={frameworks}
        libraries={libraries}
        className={`${className} mx-auto hidden max-w-2xl md:block lg:hidden xl:block`}
      />
      <Orbits
        layout={COMPACT}
        frameworks={frameworks}
        libraries={libraries}
        className={`${className} mx-auto max-w-md md:hidden lg:block xl:hidden`}
      />
    </div>
  );
}
