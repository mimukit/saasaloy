// The catalog illustration: seven module blocks standing on one isometric plate, after
// the round 10 mockup. Line art in `highlight` (the SVG's `currentColor`), faces in the
// `card` and `secondary` tokens, and the one `primary` fill on the `auth` block. The
// drawing is decorative (`aria-hidden`); the module tiles under it carry every fact. It is a
// fixed drawing of the mockup's seven modules, not a view of the registry.
//
// Geometry: a 2:1 isometric grid. Grid cell (i, j) puts a block's top-face centre at
// x = 280 + (i - j) * 96, y = 60 + (i + j) * 48. A block's top face is 128 x 64 and its
// sides are 20 deep. Blocks are listed back to front so nearer ones overlap.

import type { ReactNode } from "react";

const HALF_W = 64;
const HALF_H = 32;
const DEPTH = 20;

const ICONS: Record<string, ReactNode> = {
  cube: <path d="M0-8 7-4v8L0 8-7 4v-8zM-7-4 0 0l7-4M0 0v8" />,
  cylinder: (
    <>
      <ellipse cx="0" cy="-5" rx="7" ry="2.5" />
      <path d="M-7-5V5a7 2.5 0 0 0 14 0V-5M-7 0a7 2.5 0 0 0 14 0" />
    </>
  ),
  list: <path d="M-7-7h14v14h-14zM-4-3.5h8M-4 0h8M-4 3.5h5" />,
  lock: <path d="M-6-2h12v9h-12zM-4-2v-3a4 4 0 0 1 8 0v3M0 1.5v2" />,
  people: (
    <>
      <circle cx="-3.5" cy="-3.5" r="2.5" />
      <circle cx="4" cy="-2.5" r="2" />
      <path d="M-8 6a4.5 4.5 0 0 1 9 0M2 6a3.5 3.5 0 0 1 6.5-2" />
    </>
  ),
  envelope: <path d="M-8-5h16v11h-16zM-8-5 0 1l8-6" />,
};

const BLOCKS = [
  { name: "api", i: 0, j: 0, icon: "cube" },
  { name: "database", i: 0, j: 1, icon: "cylinder" },
  { name: "waitlist", i: 1, j: 0, icon: "list" },
  { name: "auth", i: 1, j: 1, icon: "lock", focus: true },
  { name: "teams", i: 1, j: 2, icon: "people" },
  { name: "database-postgres", i: 2, j: 1, icon: "cylinder" },
  { name: "email-console", i: 2, j: 2, icon: "envelope" },
];

const points = (...xy: number[]) => xy.join(" ");

function Block({ name, i, j, icon, focus = false }: (typeof BLOCKS)[number]) {
  const x = 280 + (i - j) * 96;
  const y = 60 + (i + j) * 48;
  return (
    <g>
      <polygon
        className="fill-secondary"
        points={points(
          x - HALF_W,
          y,
          x,
          y + HALF_H,
          x,
          y + HALF_H + DEPTH,
          x - HALF_W,
          y + DEPTH
        )}
      />
      <polygon
        className="fill-secondary"
        points={points(
          x,
          y + HALF_H,
          x + HALF_W,
          y,
          x + HALF_W,
          y + DEPTH,
          x,
          y + HALF_H + DEPTH
        )}
      />
      <polygon
        className={focus ? "fill-primary" : "fill-card"}
        points={points(
          x,
          y - HALF_H,
          x + HALF_W,
          y,
          x,
          y + HALF_H,
          x - HALF_W,
          y
        )}
      />
      <g
        transform={`translate(${x} ${y - 14})`}
        className={focus ? "text-primary-foreground" : undefined}
      >
        {ICONS[icon]}
      </g>
      <text
        x={x}
        y={y + 6}
        textAnchor="middle"
        stroke="none"
        className={focus ? "fill-primary-foreground" : "fill-current"}
      >
        {name}
      </text>
    </g>
  );
}

export function ModuleInventory({ className }: { className?: string }) {
  return (
    <svg
      viewBox="-4 0 568 340"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* The plate the blocks stand on, and its dashed inner footprint. */}
      <polygon
        className="fill-background"
        points={points(0, 176, 280, 316, 280, 326, 0, 186)}
      />
      <polygon
        className="fill-background"
        points={points(280, 316, 560, 176, 560, 186, 280, 326)}
      />
      <polygon
        className="fill-card"
        points={points(280, 36, 560, 176, 280, 316, 0, 176)}
      />
      <polygon
        className="stroke-border"
        strokeDasharray="4 4"
        points={points(280, 56, 520, 176, 280, 296, 40, 176)}
      />
      {/* Leader ticks at the plate's corners, after the mockup's callouts. */}
      <path
        className="stroke-border"
        d="M280 36V8M0 176h-4M560 176h4M280 326v12M272 8h16"
      />
      <g className="font-mono" fontSize="9" strokeWidth="1.25">
        {BLOCKS.map((block) => (
          <Block key={block.name} {...block} />
        ))}
      </g>
    </svg>
  );
}
