// Shared pieces for the page's line drawings. Each drawing in this folder sets
// `stroke="currentColor"` on its <svg> and a `text-highlight` class on it, so a line is
// in `highlight` unless it asks for `stroke-border`. Text inside a drawing never strokes.
// Every drawing is decorative (`aria-hidden`); the copy beside it carries the facts.
//
// Motion is CSS, from the drawing utilities in ../styles/web.css. A drawing's <svg> takes
// `drawing` (`drawing-load` in the hero), and its parts enter through <Assemble> and the
// `draw` class, staggered by `at`. With reduced motion requested, every part sits still.
// One drawing times many parts in a single long pass, which these utilities cannot
// express: the agent session (agent-crew.tsx) builds its keyframes with ./live.ts.

import type { CSSProperties, ReactNode } from "react";

/** Join numbers into an SVG `points` list. */
export const points = (...xy: number[]) => xy.join(" ");

/**
 * A part's entry: when it starts and how long it runs, in percent of the drawing's entry,
 * and the offset in drawing units it moves in from.
 */
export interface Entry {
  at: number;
  span?: number;
  x?: number;
  y?: number;
}

/** The custom properties `assemble` and `draw` read. */
export function enter({ at, span, x, y }: Entry): CSSProperties {
  return {
    "--at": at,
    "--span": span,
    "--from-x": x,
    "--from-y": y,
  } as CSSProperties;
}

/** A group that fades in from an offset as the drawing enters. */
export function Assemble({
  children,
  ...entry
}: Entry & { children: ReactNode }) {
  return (
    <g className="assemble" style={enter(entry)}>
      {children}
    </g>
  );
}

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

/**
 * A mono callout: the label, an underline under it, and a leader line to a dot. As the
 * drawing enters, the label fades in and the line draws from the label to the dot.
 */
export function Callout({
  x,
  y,
  label,
  to,
  anchor = "start",
  at = 60,
}: {
  x: number;
  y: number;
  label: string;
  /** The point the leader ends on. */
  to: [number, number];
  anchor?: "start" | "end";
  /** When the callout enters, in percent of the drawing's entry. */
  at?: number;
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
      <Assemble at={at}>
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
      </Assemble>
      <path
        pathLength={1}
        className="draw"
        style={enter({ at })}
        d={`M${left} ${y + 4}h${width}M${foot} ${y + 4}L${to[0]} ${to[1]}`}
      />
      <Assemble at={at + 30} span={10}>
        <circle cx={to[0]} cy={to[1]} r="2" className="fill-background" />
      </Assemble>
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
