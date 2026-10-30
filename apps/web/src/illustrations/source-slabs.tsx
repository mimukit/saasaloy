// The stages illustration: an exploded stack of five source slabs, one per stage, after
// the round 10 mockup. Each slab carries a few standing file cards, its folder name on
// the front face, and a leader to the command that adds it. Line art in `highlight`.
//
// THE ONE `primary` FILL MOVES. Slab n carries `data-slab="n"` (1-based, the same
// number as its stage row), and the `stage-list` utility in ../styles/web.css fills the
// active slab's faces with `primary` and turns the lines in its `data-slab-detail` group
// `primary-foreground`. The active slab follows the hovered or focused stage row. With
// neither, it moves on with the row every 3s; with reduced motion it rests on the first. The utility covers five stages; a sixth needs a rule there too.
// The active slab also rises 6px. It moves inside its <Assemble> group, because the
// entry's fill would hold the slab's own `translate` at rest.
//
// Motion: as the drawing scrolls in, the slabs drop in from the top one at a time, and
// each leader draws out to its command. The only loop is the highlight cycle above.
//
// Geometry: a 2:1 isometric slab. Slab k has its top-face centre at (CX, CY0 + k * GAP);
// the face is 2 * HW wide and 2 * HH tall, and the sides are DEPTH deep. Slabs are drawn
// bottom first, so each one sits in front of the slab below it.

import type { CSSProperties } from "react";

import { Assemble, enter, Label, points } from "@web/illustrations/parts";

const CX = 170;
const CY0 = 110;
const GAP = 108;
const HW = 144;
const HH = 72;
const DEPTH = 18;
/** The u axis of the top face, from the left corner toward the front corner. */
const UX = 0.894;
const UY = 0.447;

export interface SlabStage {
  /** The folder the slab names, with no trailing slash. */
  folder: string;
  command: string;
}

function Card({
  x,
  y,
  glyph = false,
}: {
  x: number;
  y: number;
  glyph?: boolean;
}) {
  return (
    <g transform={`matrix(${UX} ${UY} 0 1 ${x} ${y})`}>
      <rect x="0" y="-26" width="30" height="26" data-face="" />
      {glyph && <path d="M11 -18l-4 5 4 5M19 -18l4 5-4 5M16 -20l-2 14" />}
    </g>
  );
}

function Slab({ stage, index }: { stage: SlabStage; index: number }) {
  const cy = CY0 + index * GAP;
  const left = CX - HW;
  const right = CX + HW;
  const folder = `${stage.folder}/`;
  const serial = String(index + 1).padStart(2, "0");
  const at = index * 12;
  return (
    <Assemble at={at} span={30} y={-24}>
      <g data-slab={index + 1} style={{ "--stage": index } as CSSProperties}>
        <polygon
          data-face=""
          points={points(
            left,
            cy,
            CX,
            cy + HH,
            CX,
            cy + HH + DEPTH,
            left,
            cy + DEPTH
          )}
        />
        <polygon
          data-face=""
          points={points(
            CX,
            cy + HH,
            right,
            cy,
            right,
            cy + DEPTH,
            CX,
            cy + HH + DEPTH
          )}
        />
        <polygon
          data-face=""
          points={points(left, cy, CX, cy - HH, right, cy, CX, cy + HH)}
        />
        <g data-slab-detail="">
          {/* Folder name on the front-left face. */}
          <g transform={`matrix(${UX} ${UY} 0 1 ${left} ${cy})`}>
            <Label x={10} y={13} size={9}>
              {`${serial}  ${folder}`}
            </Label>
          </g>
          {/* A row of standing file cards, the front one marked as code. */}
          {[3, 2, 1, 0].map((n) => (
            <Card
              key={n}
              x={CX - 92 + n * 9}
              y={cy + 10 - n * 4.5}
              glyph={n === 0}
            />
          ))}
          {/* Code lines on the top face, right of the cards. */}
          <path
            transform={`matrix(${UX} ${UY} ${UX} ${-UY} ${CX - 30} ${cy + 14})`}
            d="M0 0h40M0 8h28M0 16h36M0 24h20"
          />
        </g>
        {/* The leader to the command that adds this slab. */}
        <path
          pathLength={1}
          className="draw"
          style={enter({ at: at + 20, span: 20 })}
          d={`M${right} ${cy + 9}l18 18h28`}
        />
        <circle cx={right + 46} cy={cy + 27} r="2" />
        <path
          d={`M${right + 54} ${cy + 20}h6l2 2h10v12h-18z`}
          className="stroke-current"
        />
        <Label x={right + 80} y={cy + 31} size={10}>
          {stage.command}
        </Label>
      </g>
    </Assemble>
  );
}

export function SourceSlabs({
  stages,
  className,
}: {
  stages: SlabStage[];
  className?: string;
}) {
  const last = CY0 + (stages.length - 1) * GAP + HH + DEPTH;
  return (
    <svg
      viewBox={`0 0 480 ${last + 16}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {/* The plumb lines the slabs hang on. */}
      <path
        className="stroke-border"
        strokeDasharray="3 4"
        d={`M${CX - HW} ${CY0}V${last}M${CX + HW} ${CY0}V${last}M${CX} ${CY0 + HH}V${last + 12}`}
      />
      {stages
        .map((stage, index) => (
          <Slab key={stage.folder} stage={stage} index={index} />
        ))
        .toReversed()}
    </svg>
  );
}
