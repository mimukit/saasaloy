// The wireframe on each Saasaloy UI index card, from the round 1 mockup of plan 0121: line
// art in `highlight` on the card, text as tonal bars, and one `primary` fill per drawing
// to mark its focus (apps/web/DESIGN.md, "Illustrations"). Static SVG with no state, so the
// index renders it with no client directive. A block with no drawing of its own gets the
// generic section frame.

import type { ReactNode } from "react";

type Tone = "head" | "line" | "accent";

const TONE: Record<Tone, string> = {
  head: "fill-foreground",
  line: "fill-border",
  accent: "fill-primary",
};

function bar(
  x: number,
  y: number,
  width: number,
  tone: Tone = "line",
  height = 6
) {
  return (
    <rect
      key={`b${x}-${y}-${width}`}
      x={x}
      y={y}
      width={width}
      height={height}
      className={TONE[tone]}
    />
  );
}

function box(
  x: number,
  y: number,
  width: number,
  height: number,
  accent = false
) {
  return (
    <rect
      key={`r${x}-${y}-${width}-${height}`}
      x={x + 0.5}
      y={y + 0.5}
      width={width}
      height={height}
      className={
        accent ? "fill-primary/10 stroke-primary" : "fill-card stroke-current"
      }
    />
  );
}

/** Three columns of a repeated tile, for the grid-shaped blocks. */
function tiles(
  draw: (x: number, y: number) => ReactNode[],
  rows = 1
): ReactNode[] {
  const parts: ReactNode[] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < 3; column++) {
      parts.push(...draw(24 + column * 96, 24 + row * 64));
    }
  }
  return parts;
}

const DRAWINGS: Record<string, () => ReactNode[]> = {
  hero: () => [
    bar(24, 40, 120, "head", 10),
    bar(24, 56, 96, "head", 10),
    bar(24, 76, 112),
    bar(24, 88, 88),
    bar(24, 108, 48, "accent", 12),
    box(188, 28, 108, 104),
    <path
      key="x"
      d="M188.5 28.5 296.5 132.5 M296.5 28.5 188.5 132.5"
      className="stroke-current"
    />,
  ],
  "feature-grid": () =>
    tiles(
      (x, y) => [
        box(x, y, 80, 52),
        box(x + 8, y + 8, 12, 12),
        bar(x + 8, y + 28, 56),
        bar(x + 8, y + 38, 40),
      ],
      2
    ),
  "pricing-table": () =>
    [0, 1, 2].flatMap((column) => {
      const x = 24 + column * 96;
      const featured = column === 1;
      return [
        box(x, 20, 80, 120, featured),
        bar(x + 10, 32, 28, "head", 8),
        bar(x + 10, 52, 52),
        bar(x + 10, 64, 44),
        bar(x + 10, 76, 48),
        featured
          ? bar(x + 10, 116, 60, "accent", 12)
          : box(x + 10, 116, 59, 11),
      ];
    }),
  testimonials: () =>
    tiles((x, y) => [
      box(x, y + 16, 80, 96),
      bar(x + 10, y + 28, 10, "accent", 8),
      bar(x + 10, y + 46, 60),
      bar(x + 10, y + 56, 52),
      bar(x + 10, y + 66, 56),
      <circle
        key={`c${x}`}
        cx={x + 16}
        cy={y + 94}
        r={6}
        className="fill-border"
      />,
      bar(x + 28, y + 91, 36),
    ]),
  faq: () =>
    [0, 1, 2].flatMap((row) => {
      const y = 24 + row * 38;
      return [
        box(24, y, 272, 30, row === 0),
        bar(36, y + 12, 140 - row * 20, "head"),
        <path
          key={`v${row}`}
          d={`M276 ${y + 13} l5 5 l5 -5`}
          className="fill-none stroke-current"
        />,
      ];
    }),
  footer: () => [
    bar(24, 40, 72, "head", 10),
    bar(24, 60, 96),
    ...[0, 1, 2].flatMap((column) => {
      const x = 152 + column * 52;
      return [
        bar(x, 40, 36, "head"),
        bar(x, 56, 32),
        bar(x, 68, 28),
        bar(x, 80, 32),
      ];
    }),
    <path
      key="rule"
      d="M24 120.5 H296"
      className="stroke-current"
      strokeDasharray="4 4"
    />,
    bar(24, 132, 120),
  ],
  navbar: () => [
    box(24, 24, 272, 36),
    bar(36, 38, 48, "head", 8),
    bar(120, 39, 28),
    bar(156, 39, 28),
    bar(192, 39, 28),
    bar(240, 34, 44, "accent", 16),
    bar(24, 84, 200, "line"),
    bar(24, 96, 160, "line"),
  ],
  cta: () => [
    box(24, 24, 272, 112),
    bar(88, 48, 144, "head", 10),
    bar(100, 66, 120),
    box(84, 88, 112, 20),
    bar(204, 88, 40, "accent", 21),
  ],
  "how-it-works": () =>
    tiles((x, y) => [
      <circle
        key={`s${x}`}
        cx={x + 12}
        cy={y + 12}
        r={10}
        className={x === 24 ? "fill-primary" : "fill-card stroke-current"}
      />,
      bar(x, y + 32, 64, "head"),
      bar(x, y + 46, 72),
      bar(x, y + 56, 56),
    ]),
  "logo-cloud": () => [
    bar(112, 36, 96, "line"),
    ...[0, 1, 2, 3].map((index) =>
      box(28 + index * 68, 64, 56, 28, index === 1)
    ),
    bar(132, 112, 56),
  ],
  "pain-points": () => [
    bar(24, 28, 140, "head", 10),
    ...[0, 1, 2].flatMap((row) => {
      const y = 52 + row * 32;
      return [
        box(24, y, 272, 24, row === 0),
        bar(36, y + 9, 120),
        bar(220, y + 9, 60),
      ];
    }),
  ],
  showcase: () => [
    bar(24, 36, 96, "head", 10),
    bar(24, 54, 112),
    bar(24, 66, 96),
    bar(24, 86, 72, "line"),
    box(168, 24, 128, 112),
    bar(180, 40, 104, "accent", 8),
    bar(180, 60, 88),
    bar(180, 72, 96),
    bar(180, 84, 72),
  ],
  audience: () =>
    tiles(
      (x, y) => [
        box(x, y, 80, 52, x === 120 && y === 24),
        box(x + 8, y + 8, 12, 12),
        bar(x + 8, y + 28, 52),
        bar(x + 8, y + 38, 36),
      ],
      2
    ),
  "error-state": () => [
    box(88, 20, 144, 120),
    <circle
      key="i"
      cx={160}
      cy={46}
      r={10}
      className="fill-card stroke-current"
    />,
    bar(148, 64, 24, "line"),
    bar(112, 78, 96, "head", 10),
    bar(104, 96, 112),
    bar(124, 116, 72, "accent", 14),
  ],
  "theme-toggle": () => [
    box(124, 52, 72, 56),
    <circle key="sun" cx={146} cy={80} r={8} className="fill-primary" />,
    <path
      key="moon"
      d="M180 72 a9 9 0 1 0 0 16 a7 7 0 1 1 0 -16"
      className="fill-none stroke-current"
    />,
  ],
  // Module blocks (plan 0121, Phase 5): a centred card with its fields and one button.
  "auth/sign-in": () => authCard(2),
  "auth/sign-up": () => authCard(3),
  waitlist: () => [
    box(24, 32, 272, 96),
    bar(40, 56, 104, "head", 10),
    bar(40, 74, 96),
    bar(40, 86, 72),
    box(168, 64, 64, 20),
    bar(236, 64, 44, "accent", 21),
  ],
};

/** The sign-in or sign-up card: a brand row, a title, `fields` inputs and the button. */
function authCard(fields: number): ReactNode[] {
  const top = fields === 2 ? 20 : 12;
  const parts: ReactNode[] = [
    box(100, top, 120, 120 + (fields - 2) * 16),
    bar(112, top + 12, 10, "accent", 10),
    bar(126, top + 14, 32),
    bar(112, top + 32, 72, "head", 8),
  ];
  for (let index = 0; index < fields; index++) {
    const y = top + 50 + index * 16;
    parts.push(box(112, y, 96, 10));
  }
  parts.push(bar(112, top + 52 + fields * 16, 96, "accent", 12));
  return parts;
}

export interface BlockThumbProps {
  /** The block path under `blocks/`, `hero` or `auth/sign-in`. */
  block: string;
  className?: string;
}

export function BlockThumb({ block, className }: BlockThumbProps) {
  const draw = Object.hasOwn(DRAWINGS, block) ? DRAWINGS[block] : DRAWINGS.cta;
  return (
    <svg
      viewBox="0 0 320 160"
      aria-hidden="true"
      className={className}
      fill="none"
      strokeWidth={1}
    >
      {draw?.()}
    </svg>
  );
}
