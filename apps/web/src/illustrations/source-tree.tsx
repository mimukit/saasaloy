// The hero illustration: the source tree of a Saasaloy project, after variant F of the
// round 2 hero exploration and the round 3 placement the owner approved. An explorer
// lists `my-app/`, an editor shows a file, and a terminal runs `saasaloy add`. The base
// folders carry no marker, because `saasaloy init` writes them. Each added module lands
// under `packages/` with a "+" and a "U", the way an editor marks an untracked folder.
// Line art in `highlight`, panels filled with `card`, and the one `primary` fill on the
// `my-app/` folder. Decorative: the hero copy says it all.
//
// Two layouts, because no label may render under 10px on screen. The full one is 640
// units wide and shows from `md` to `lg` and from `xl`, where its column is at least 640px
// wide. Below `md`, and in the narrower hero column from `lg` to `xl`, the compact one
// shows: 300 units wide, the explorer over the terminal, with no editor.
//
// Motion: the hero is in view on load, so each <svg> takes `drawing-load`, and the panels
// play in after the copy. Then one 12.5s pass loops while the hero is in view. `step-loop`
// steps `--step` from 0 to 4 and the parts read it: on step n, module n's folder
// slides into the tree (`step-add`), and its tab, its command and its row highlight show
// (`step-only`). The editor's lines type in again on each step (`tree-type`), and the
// connectors flow. At the end of the pass the added folders fade and the tree starts
// over. With reduced motion the tree sits at step 4, every module added. The script in
// ../layouts/Layout.astro pauses all of it while the hero is off screen.

import type { CSSProperties, ReactNode } from "react";

import { Assemble, Label } from "@web/illustrations/parts";

/** The modules the terminal adds, in order. Module n shows on step n + 1. */
const MODULES = ["auth", "database", "email", "payment"];

/** The tree: a name and its depth. The added modules follow under `packages/`. */
const BASE_ROWS: [string, number][] = [
  ["my-app/", 0],
  ["apps/", 1],
  ["web/", 2],
  ["api/", 2],
  ["packages/", 1],
  ["ui/", 2],
  ["env/", 2],
  ["config/", 2],
];

/** The editor's code lines: the width of each token, a blank line for none. */
const CODE: number[][] = [
  [40, 70],
  [20, 110],
  [20, 60, 50],
  [],
  [40, 120],
  [60, 30, 40],
  [60, 90],
  [40, 50],
  [20, 20],
  [],
  [40, 100],
  [20, 80],
];

/** The step a part belongs to, for `step-add` and `step-only`. */
const step = (k: number) => ({ "--k": k }) as CSSProperties;

/** A folder icon whose left edge is `x`, centred on `y`. */
function Folder({
  x,
  y,
  root = false,
}: {
  x: number;
  y: number;
  root?: boolean;
}) {
  return (
    <path
      d={`M${x} ${y - 5}h4l2 2h6v8h-12z`}
      className={root ? "fill-primary" : "fill-card"}
    />
  );
}

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
}

function Explorer({ x, y, w, h, gap }: Panel & { gap: number }) {
  const rowY = (r: number) => y + 48 + r * gap;
  const folderX = (depth: number) => x + 14 + depth * 18;
  const added = MODULES.length;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="fill-card" />
      <path d={`M${x} ${y + 24}h${w}M${x} ${y + h - 26}h${w}`} />
      <Label x={x + 12} y={y + 16} size={10} className="fill-muted-foreground">
        EXPLORER
      </Label>
      {/* The guides under `apps/` and `packages/`. */}
      <path
        className="stroke-border"
        d={`M${folderX(1) + 6} ${rowY(1) + 8}V${rowY(3) + 4}M${folderX(1) + 6} ${rowY(4) + 8}V${rowY(7 + added) + 4}`}
      />
      {BASE_ROWS.map(([name, depth], r) => (
        <g key={name}>
          <Folder x={folderX(depth)} y={rowY(r)} root={depth === 0} />
          <Label
            x={folderX(depth) + 18}
            y={rowY(r) + 3.5}
            size={10}
            className="fill-foreground"
          >
            {name}
          </Label>
        </g>
      ))}
      {MODULES.map((name, n) => {
        const r = BASE_ROWS.length + n;
        return (
          <g key={name}>
            <rect
              x={x + 1}
              y={rowY(r) - gap / 2 + 1}
              width={w - 2}
              height={gap - 2}
              stroke="none"
              className="step-only fill-secondary"
              style={step(n + 1)}
            />
            <g className="step-add" style={step(n + 1)}>
              <path
                d={`M${x + 6} ${rowY(r)}h7M${x + 9.5} ${rowY(r) - 3.5}v7`}
                strokeWidth="1.5"
              />
              <Folder x={folderX(2)} y={rowY(r)} />
              <Label
                x={folderX(2) + 18}
                y={rowY(r) + 3.5}
                size={10}
                className="fill-foreground"
              >
                {`${name}/`}
              </Label>
              <Label x={x + w - 12} y={rowY(r) + 3.5} size={10} anchor="end">
                U
              </Label>
            </g>
          </g>
        );
      })}
      <Label
        x={x + 12}
        y={y + h - 9}
        size={10}
        className="fill-muted-foreground"
      >
        main · source you own
      </Label>
    </>
  );
}

function Editor({ x, y, w, h }: Panel) {
  const tabs = [
    "apps/web/src/pages/index.astro",
    ...MODULES.map((name) => `packages/${name}/src/index.ts`),
  ];
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="fill-card" />
      <rect x={x} y={y} width={206} height={24} className="fill-secondary" />
      <path d={`M${x} ${y + 24}h${w}`} />
      {tabs.map((tab, k) => (
        <g key={tab} className="step-only" style={step(k)}>
          <Label x={x + 10} y={y + 16} size={10}>
            {tab}
          </Label>
        </g>
      ))}
      {CODE.map((tokens, r) => {
        const lineY = y + 44 + r * 20;
        let tokenX = x + 40;
        return (
          <g key={r}>
            <Label
              x={x + 26}
              y={lineY + 3.5}
              size={10}
              anchor="end"
              className="fill-muted-foreground"
            >
              {r + 1}
            </Label>
            {tokens.length > 0 && (
              <path
                strokeWidth="5"
                strokeLinecap="round"
                className={`tree-type ${r % 3 === 0 ? "" : "stroke-border"}`}
                style={{ "--line": r } as CSSProperties}
                d={tokens
                  .map((width) => {
                    const d = `M${tokenX} ${lineY}h${width}`;
                    tokenX += width + 8;
                    return d;
                  })
                  .join("")}
              />
            )}
          </g>
        );
      })}
    </>
  );
}

/** A caret that blinks while its step shows. */
function Caret({ x, y, k }: { x: number; y: number; k: number }) {
  return (
    <g className="step-only" style={step(k)}>
      <rect
        x={x}
        y={y - 9}
        width="6"
        height="11"
        stroke="none"
        className="blink fill-current"
      />
    </g>
  );
}

function Terminal({ x, y, w, h }: Panel) {
  const command = "$ saasaloy add";
  // Geist Mono advances 0.6em, so a 10-unit character is 6 units wide.
  const nameX = x + 12 + (command.length + 1) * 6;
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="fill-card" />
      <path d={`M${x} ${y + 24}h${w}`} />
      <Label x={x + 12} y={y + 16} size={10} className="fill-muted-foreground">
        terminal
      </Label>
      <Label x={x + 12} y={y + 48} size={10} className="fill-foreground">
        {command}
      </Label>
      <Caret x={nameX} y={y + 48} k={0} />
      {MODULES.map((name, n) => (
        <g key={name} className="step-only" style={step(n + 1)}>
          <Label x={nameX} y={y + 48} size={10} className="fill-foreground">
            {name}
          </Label>
          <Label
            x={x + 12}
            y={y + 68}
            size={10}
            className="fill-muted-foreground"
          >
            {`+ packages/${name}/`}
          </Label>
          <path d={`M${x + 12} ${y + 81}l2.5 2.5 5-5`} />
          <Label
            x={x + 24}
            y={y + 85}
            size={10}
            className="fill-muted-foreground"
          >
            the files are yours to edit
          </Label>
          <Caret x={nameX + (name.length + 1) * 6} y={y + 48} k={n + 1} />
        </g>
      ))}
    </>
  );
}

function Drawing({
  width,
  height,
  className,
  children,
}: {
  width: number;
  height: number;
  className: string;
  children: ReactNode;
}) {
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-loop-in-view
      className={className}
    >
      <g className="step-loop">{children}</g>
    </svg>
  );
}

/** Both layouts in one box; `className` goes on each <svg>. */
export function SourceTree({ className = "" }: { className?: string }) {
  return (
    <div className="w-full min-w-0">
      <Drawing
        width={640}
        height={432}
        className={`${className} hidden md:block lg:hidden xl:block`}
      >
        <Assemble at={0} y={16}>
          <Explorer x={8} y={8} w={270} h={416} gap={24} />
        </Assemble>
        <Assemble at={15} y={16}>
          <Editor x={302} y={8} w={330} h={300} />
        </Assemble>
        <Assemble at={30} y={16}>
          <Terminal x={302} y={328} w={330} h={96} />
        </Assemble>
        <Assemble at={45}>
          <path
            className="flow"
            strokeDasharray="3 3"
            d="M278 150h24M278 376h24M590 308v20"
          />
        </Assemble>
      </Drawing>
      <Drawing
        width={300}
        height={460}
        className={`${className} mx-auto max-w-sm md:hidden lg:block xl:hidden`}
      >
        <Assemble at={0} y={16}>
          <Explorer x={1} y={1} w={298} h={338} gap={22} />
        </Assemble>
        <Assemble at={30} y={16}>
          <Terminal x={1} y={363} w={298} h={96} />
        </Assemble>
        <Assemble at={45}>
          <path className="flow" strokeDasharray="3 3" d="M150 339v24" />
        </Assemble>
      </Drawing>
    </div>
  );
}
