// The problem section's illustration: a project as a city block, after variant I of the
// round 2 hero exploration and the round 4 mockup the owner approved. `landing/` stands
// at the centre with the one `primary` roof, because `saasaloy init` writes it. `auth/`,
// `database/`, `teams/` and `payment/` rise around it one at a time, and a crane with no
// fill waits over the empty "next" lot. Decorative: the section copy says it all.
//
// Geometry: a 2:1 isometric grid, `U` units to a grid step. `iso(i, j, k)` maps grid
// point (i, j) at height k to the page. The ground is 8.8 steps a side, and its nine
// 2-step lots sit 0.8 apart, with dashed roads in the gaps. Six lots are used.
//
// Two layouts, because no label may render under 10px on screen. The full one sets each
// name on its roof, along the grid, at 10 units, and shows from `md` to `lg` and from
// `xl`. Below `md`, and in the narrower column from `lg` to `xl`, the compact one sets
// the names flat across the roofs at 17.5 units, so each still renders at 10px or more
// in a 327px column.
//
// Motion: the drawing loops while it is in view, like the hero. The <svg> takes
// `drawing-load`, so the ground and the buildings play in when it enters, and
// `step-loop` steps `--step` from 0 to 4 every 12.5s: on step n, building n rises
// (`step-rise`). Once per step the crane runs its trolley out and lowers its hook. With
// reduced motion every building stands. The script in ../layouts/Layout.astro pauses
// all of it while the drawing is off screen.

import type { CSSProperties, ReactNode } from "react";

import { Assemble, points } from "@web/illustrations/parts";

/** Grid units to a step. */
const U = 30;
const OX = 274;
const OY = 76;
const WIDTH = 548;
const HEIGHT = 366;

/** A grid point at height `k`, on the page. */
const iso = (i: number, j: number, k = 0): [number, number] => [
  OX + (i - j) * U,
  OY + ((i + j) * U) / 2 - k,
];

const at = (...corners: [number, number][]) => points(...corners.flat());

/** The ground's side and a lot's, in steps. */
const GROUND = 8.8;
const LOT = 2;
/** A lot's corner, by its column and row on the 3 x 3 plan. */
const lot = (a: number, b: number) => [0.6 + 2.8 * a, 0.6 + 2.8 * b];

/**
 * The buildings, back to front: the lot, the height in units, and the step it rises on.
 * Step 0 is the landing page, already built.
 */
const BUILDINGS = [
  { name: "database/", a: 0, b: 0, h: 70, step: 2 },
  { name: "teams/", a: 1, b: 0, h: 44, step: 3 },
  { name: "auth/", a: 0, b: 1, h: 50, step: 1 },
  { name: "landing/", a: 1, b: 1, h: 36, step: 0 },
  { name: "payment/", a: 2, b: 1, h: 46, step: 4 },
];

/** A box on the grid: its two front faces, then its top. */
function Box({
  i,
  j,
  w,
  h,
  k = 0,
  top = "fill-card",
}: {
  i: number;
  j: number;
  w: number;
  h: number;
  k?: number;
  top?: string;
}) {
  return (
    <>
      <polygon
        className="fill-card"
        points={at(
          iso(i, j + w, k),
          iso(i + w, j + w, k),
          iso(i + w, j + w, k + h),
          iso(i, j + w, k + h)
        )}
      />
      <polygon
        className="fill-card"
        points={at(
          iso(i + w, j + w, k),
          iso(i + w, j, k),
          iso(i + w, j, k + h),
          iso(i + w, j + w, k + h)
        )}
      />
      <polygon
        className={top}
        points={at(
          iso(i, j, k + h),
          iso(i + w, j, k + h),
          iso(i + w, j + w, k + h),
          iso(i, j + w, k + h)
        )}
      />
    </>
  );
}

/**
 * A label at a grid point: along the grid on the roof in the full layout, flat in the
 * compact one.
 */
function Name({
  i,
  j,
  k = 0,
  flat,
  className = "fill-foreground",
  children,
}: {
  i: number;
  j: number;
  k?: number;
  flat: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [x, y] = iso(i, j, k);
  return (
    <text
      textAnchor="middle"
      stroke="none"
      fontSize={flat ? 17.5 : 10}
      className={`font-mono ${className}`}
      {...(flat
        ? { x, y: y + 6 }
        : { transform: `matrix(1 .5 -1 .5 ${x} ${y})`, dy: 3.5 })}
    >
      {children}
    </text>
  );
}

function Building({
  name,
  a,
  b,
  h,
  step,
  flat,
}: (typeof BUILDINGS)[number] & { flat: boolean }) {
  const [i, j] = lot(a, b);
  const landing = step === 0;
  // Dashed window rows on both faces.
  let windows = "";
  for (let k = 8; k < h - 4; k += 9) {
    const [a1, a2] = [iso(i + 0.25, j + LOT, k), iso(i + 1.75, j + LOT, k)];
    const [b1, b2] = [iso(i + LOT, j + 1.75, k), iso(i + LOT, j + 0.25, k)];
    windows += `M${a1.join(" ")}L${a2.join(" ")}M${b1.join(" ")}L${b2.join(" ")}`;
  }
  const body = (
    <>
      <Box
        i={i}
        j={j}
        w={LOT}
        h={h}
        top={landing ? "fill-primary" : "fill-card"}
      />
      <path className="stroke-border" strokeDasharray="4 3" d={windows} />
      <Name
        i={i + LOT / 2}
        j={j + LOT / 2}
        k={h}
        flat={flat}
        className={landing ? "fill-primary-foreground" : "fill-foreground"}
      >
        {name}
      </Name>
    </>
  );
  return landing ? (
    body
  ) : (
    <g className="step-rise" style={{ "--k": step } as CSSProperties}>
      {body}
    </g>
  );
}

/** The crane over the next lot, line art with no fill. */
function Crane({ flat }: { flat: boolean }) {
  const [i, j] = lot(1, 2);
  // The mast stands at the lot's left corner and the jib reaches over the lot.
  const [x, base] = iso(i + 0.3, j + 1.7);
  const top = base - 72;
  let lattice = "";
  for (let y = base; y > top + 10; y -= 12) {
    lattice += `M${x - 4} ${y}L${x + 4} ${y - 12}`;
  }
  return (
    <>
      <polygon
        strokeDasharray="3 4"
        points={at(
          iso(i, j),
          iso(i + LOT, j),
          iso(i + LOT, j + LOT),
          iso(i, j + LOT)
        )}
      />
      <Name i={i + LOT / 2} j={j + LOT / 2} flat={flat}>
        next
      </Name>
      <path
        d={`M${x - 4} ${base}V${top}M${x + 4} ${base}V${top}M${x - 4} ${top}h8`}
      />
      <path className="stroke-border" d={lattice} />
      <path
        d={`M${x - 28} ${top}H${x + 56}M${x} ${top - 16}L${x - 28} ${top}M${x} ${top - 16}L${x + 56} ${top}M${x} ${top - 16}V${top}`}
      />
      <rect x={x - 28} y={top} width="12" height="9" />
      <g
        className="crane-trolley"
        style={{ "--crane-run": 24 } as CSSProperties}
      >
        <rect x={x + 14} y={top} width="10" height="4" />
        <path
          className="crane-cable"
          style={{ "--crane-stretch": 2.2 } as CSSProperties}
          d={`M${x + 19} ${top + 4}v20`}
        />
        <rect
          className="crane-hook"
          style={{ "--crane-drop": 24 } as CSSProperties}
          x={x + 12}
          y={top + 24}
          width="14"
          height="10"
        />
      </g>
    </>
  );
}

function City({ flat, className }: { flat: boolean; className: string }) {
  const roads = [3, 5.8]
    .map(
      (t) =>
        `M${iso(t, 0).join(" ")}L${iso(t, GROUND).join(" ")}M${iso(0, t).join(" ")}L${iso(GROUND, t).join(" ")}`
    )
    .join("");
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-loop-in-view
      className={className}
    >
      <g className="step-loop">
        <Assemble at={0} y={12}>
          <Box i={0} j={0} w={GROUND} h={10} k={-10} />
          <path className="stroke-border" strokeDasharray="4 4" d={roads} />
        </Assemble>
        {BUILDINGS.map((building, n) => (
          <Assemble key={building.name} at={10 + n * 8} y={12}>
            <Building {...building} flat={flat} />
          </Assemble>
        ))}
        <Assemble at={50} y={12}>
          <Crane flat={flat} />
        </Assemble>
      </g>
    </svg>
  );
}

/** Both layouts in one box; `className` goes on each <svg>. */
export function ModuleCity({ className = "" }: { className?: string }) {
  return (
    <div className="w-full min-w-0">
      <City
        flat={false}
        className={`${className} mx-auto hidden max-w-xl md:block lg:hidden xl:block`}
      />
      <City
        flat
        className={`${className} mx-auto max-w-md md:hidden lg:block xl:hidden`}
      />
    </div>
  );
}
