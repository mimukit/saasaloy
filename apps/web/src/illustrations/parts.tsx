// Shared pieces for the page's line drawings. Each drawing in this folder sets
// `stroke="currentColor"` on its <svg> and a `text-highlight` class on it, so a line is
// in `highlight` unless it asks for `stroke-border`. Text inside a drawing never strokes.
// Every drawing is decorative (`aria-hidden`); the copy beside it carries the facts.

import type { ReactNode } from "react";

/** Join numbers into an SVG `points` list. */
export const points = (...xy: number[]) => xy.join(" ");

/**
 * The isometric panel plane: a flat drawing in local coordinates, sheared so its top
 * edge falls to the right by `slope` per unit of width. A panel stands on the page like
 * the windows in the round 10 hero.
 */
export function Plane({
  x,
  y,
  slope = 0.36,
  children,
}: {
  x: number;
  y: number;
  slope?: number;
  children: ReactNode;
}) {
  return <g transform={`matrix(1 ${slope} 0 1 ${x} ${y})`}>{children}</g>;
}

/**
 * A panel with thickness: a back sheet offset up and to the right, then the face. Both
 * fill with `card`, so a panel hides the lines behind it.
 */
export function Sheet({
  w,
  h,
  depth = 6,
  className = "fill-card",
}: {
  w: number;
  h: number;
  depth?: number;
  className?: string;
}) {
  return (
    <>
      <rect x={depth} y={-depth} width={w} height={h} className={className} />
      <path
        d={`M0 0l${depth} ${-depth}M${w} 0l${depth} ${-depth}M0 ${h}l${depth} ${-depth}`}
      />
      <rect width={w} height={h} className={className} />
    </>
  );
}

/** The space between a callout's text and a leader that rises from beside it. */
const CALLOUT_GAP = 6;

/** A mono callout: the label, an underline under it, and a leader line to a dot. */
export function Callout({
  x,
  y,
  label,
  to,
  anchor = "start",
}: {
  x: number;
  y: number;
  label: string;
  /** The point the leader ends on. */
  to: [number, number];
  anchor?: "start" | "end";
}) {
  const textWidth = label.length * 6.2;
  const textLeft = anchor === "start" ? x : x - textWidth;
  const textRight = textLeft + textWidth;
  // The leader leaves the underline from the anchor end. A target above the label would
  // pull that line back up through the text, so it leaves from the end nearer the target.
  // The underline runs CALLOUT_GAP past the text there, so the leader clears the word.
  const above = to[1] < y;
  const footRight = above
    ? to[0] > (textLeft + textRight) / 2
    : anchor === "end";
  const left = above && !footRight ? textLeft - CALLOUT_GAP : textLeft;
  const right = above && footRight ? textRight + CALLOUT_GAP : textRight;
  const width = right - left;
  const foot = footRight ? right : left;
  return (
    <g>
      <text
        x={x}
        y={y}
        textAnchor={anchor}
        stroke="none"
        className="fill-current font-mono"
        fontSize="10"
      >
        {label}
      </text>
      <path
        d={`M${left} ${y + 4}h${width}M${foot} ${y + 4}L${to[0]} ${to[1]}`}
      />
      <circle cx={to[0]} cy={to[1]} r="2" className="fill-background" />
    </g>
  );
}

/** A short run of text in a drawing, in Geist Mono unless `sans` is set. */
export function Label({
  x,
  y,
  children,
  size = 9,
  sans = false,
  anchor = "start",
  className = "fill-current",
}: {
  x: number;
  y: number;
  children: ReactNode;
  size?: number;
  sans?: boolean;
  anchor?: "start" | "middle" | "end";
  className?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={size}
      textAnchor={anchor}
      stroke="none"
      className={`${sans ? "font-sans" : "font-mono"} ${className}`}
    >
      {children}
    </text>
  );
}

/** Placeholder text lines: one stroke per width, `gap` apart. */
export function Lines({
  x,
  y,
  widths,
  gap = 6,
  className = "stroke-border",
}: {
  x: number;
  y: number;
  widths: number[];
  gap?: number;
  className?: string;
}) {
  return (
    <path
      className={className}
      d={widths.map((w, i) => `M${x} ${y + i * gap}h${w}`).join("")}
    />
  );
}

/**
 * A 2:1 isometric box: the top face centred on (x, y), `w` from the centre to a side
 * corner, `h` tall. `front` fills the two side faces; the top face takes `top`.
 */
export function IsoBox({
  x,
  y,
  w,
  h,
  top = "fill-card",
  front = "fill-card",
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  top?: string;
  front?: string;
}) {
  const d = w / 2;
  return (
    <g>
      <polygon
        className={front}
        points={points(x - w, y, x, y + d, x, y + d + h, x - w, y + h)}
      />
      <polygon
        className={front}
        points={points(x, y + d, x + w, y, x + w, y + h, x, y + d + h)}
      />
      <polygon
        className={top}
        points={points(x - w, y, x, y - d, x + w, y, x, y + d)}
      />
    </g>
  );
}
