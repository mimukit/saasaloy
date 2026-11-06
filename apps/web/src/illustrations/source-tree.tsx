// The hero illustration: the source workspace of a Saasaloy project, from the two-column
// hero mockup the owner approved on 2026-11-06. An explorer lists `my-app/`, an editor
// shows a file, and a terminal runs `saasaloy add`. Each added module lands under
// `packages/` with a "+", the way an editor marks a new folder, and its row takes the
// `secondary` highlight while its step shows. Line art in `highlight`, panels filled with
// `card`, and the one `primary` fill on the `my-app/` folder. A faint grid sits behind the
// panels, with a drafting cross at each corner, and dotted connectors run from the
// explorer to the editor and to the terminal. Decorative: the hero copy says it all.
//
// The editor shows the first real lines of each file the step adds: `auth.ts`,
// `schema.ts` and the two `index.ts` files, taken from modules/*/files/src. Nothing in it
// is logic the site runs. The `database` module writes `packages/db`, so the folder reads
// `db/`.
//
// Two layouts, because no label may render under 10px on screen. The full one is 700
// units wide and shows from `md` to `lg` and from `xl`. Below `md`, and in the narrower
// hero column from `lg` to `xl`, the compact one shows: 320 units wide, the explorer
// over the terminal, with no editor.
//
// Motion: the hero is in view on load, so each <svg> takes `drawing-load`, and the panels
// play in after the copy. Then one 12.5s pass loops while the hero is in view. `step-loop`
// steps `--step` from 0 to 4 and the parts read it: on step n, module n's folder slides
// into the tree (`step-add`), and its tab, its code, its command and its row highlight
// show (`step-only`). The editor's lines type in again on each step (`tree-type`), and
// the connectors flow. At the end of the pass the added folders fade and the tree starts
// over. With reduced motion the tree sits at step 4, every module added. The script in
// ../layouts/Layout.astro pauses all of it while the hero is off screen.

import type { CSSProperties, ReactNode } from "react";

import { Assemble, Label } from "@web/illustrations/parts";

/** Geist Mono advances 0.6em. */
const ADVANCE = 0.6;
/** The label size in the explorer and the terminal. */
const TEXT = 13;
/** The code size in the editor. */
const CODE_TEXT = 12.5;

interface Module {
  /** The name `saasaloy add` takes. */
  name: string;
  /** The folder it writes under `packages/`. */
  dir: string;
  /** The file the editor opens. */
  file: string;
  code: string[];
}

/** The base file the editor shows on step 0, before any module. */
const BASE_FILE = {
  file: "apps/web/src/pages/index.astro",
  code: [
    "---",
    'import Layout from "../layouts/Layout.astro";',
    'import { Hero } from "@web/blocks/hero";',
    "---",
    "",
    '<Layout title="my-app">',
    "  <Hero />",
    "</Layout>",
  ],
};

/** The modules the terminal adds, in order. Module n shows on step n + 1. */
const MODULES: Module[] = [
  {
    name: "auth",
    dir: "auth",
    file: "packages/auth/src/auth.ts",
    code: [
      'import { betterAuth } from "better-auth";',
      "import { drizzleAdapter } from",
      '  "better-auth/adapters/drizzle";',
      'import { admin } from "better-auth/plugins";',
      'import { authDb } from "./db-provider";',
      'import { audience } from "./plugins/audience";',
    ],
  },
  {
    name: "database",
    dir: "db",
    file: "packages/db/src/schema.ts",
    code: [
      "const modules = import.meta.glob(",
      '  "./schema/*.ts",',
      "  { eager: true },",
      ");",
      "",
      "export const schema = Object.assign(",
      "  {},",
      "  ...Object.values(modules),",
      ");",
    ],
  },
  {
    name: "email",
    dir: "email",
    file: "packages/email/src/index.ts",
    code: [
      'import { defineEmail } from "./define";',
      'import type { EmailEnv } from "./provider";',
      "",
      "export const email = defineEmail({",
      "  providers: [],",
      "});",
      "",
      "export function createEmail(env: EmailEnv) {",
    ],
  },
  {
    name: "payment",
    dir: "payment",
    file: "packages/payment/src/index.ts",
    code: [
      'import { definePayment } from "./define";',
      'import type { PaymentEnv } from "./provider";',
      "",
      "export const payment = definePayment({",
      "  providers: [],",
      "});",
      "",
      "export function createPayment(env: PaymentEnv) {",
    ],
  },
];

/** The most code lines a file shows; the gutter numbers them all. */
const CODE_LINES = 9;

/** The tree: a name, its depth, and whether it shows open. */
const BASE_ROWS: [string, number, boolean][] = [
  ["my-app", 0, true],
  ["apps", 1, true],
  ["web", 2, false],
  ["api", 2, false],
  ["packages", 1, true],
  ["ui", 2, false],
  ["env", 2, false],
  ["config", 2, false],
];

/** The words the editor colours as keywords. */
const KEYWORD =
  /\b(import|from|export|const|function|type|await|async|return|new)\b/;

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
      d={`M${x} ${y - 6}h5l2 2h7v10h-14z`}
      className={root ? "fill-primary" : "fill-card"}
    />
  );
}

/** A chevron centred on (x, y): down when the folder is open, right when it is not. */
function Chevron({ x, y, open }: { x: number; y: number; open: boolean }) {
  return (
    <path
      d={
        open
          ? `M${x - 3.5} ${y - 2}l3.5 3.5 3.5-3.5`
          : `M${x - 1.5} ${y - 3.5}l3.5 3.5-3.5 3.5`
      }
    />
  );
}

/** A drafting cross centred on (x, y). */
function Cross({ x, y }: { x: number; y: number }) {
  return <path d={`M${x - 8} ${y}h16M${x} ${y - 8}v16`} />;
}

/** A faint square grid over a box, one line every `cell` units. */
function Grid({
  x,
  y,
  w,
  h,
  cell,
}: {
  x: number;
  y: number;
  w: number;
  h: number;
  cell: number;
}) {
  const lines: string[] = [];
  for (let gx = x; gx <= x + w; gx += cell) {
    lines.push(`M${gx} ${y}v${h}`);
  }
  for (let gy = y; gy <= y + h; gy += cell) {
    lines.push(`M${x} ${gy}h${w}`);
  }
  return (
    <path
      d={lines.join("")}
      strokeWidth="0.5"
      className="stroke-border opacity-60"
    />
  );
}

/** One line of code, keywords in `highlight` and the rest in `foreground`. */
function CodeLine({ x, y, text }: { x: number; y: number; text: string }) {
  // The pattern captures, so every odd part is a keyword.
  const parts = text.split(KEYWORD);
  return (
    <text
      x={x}
      y={y}
      fontSize={CODE_TEXT}
      stroke="none"
      xmlSpace="preserve"
      className="fill-foreground font-mono"
    >
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          // oxlint-disable-next-line react/no-array-index-key -- a line's parts never reorder
          <tspan key={i} className="fill-current">
            {part}
          </tspan>
        ) : (
          part
        )
      )}
    </text>
  );
}

interface Panel {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A panel: a `card` box with a header row holding `title`. */
function Frame({ x, y, w, h, title }: Panel & { title: ReactNode }) {
  return (
    <>
      <rect x={x} y={y} width={w} height={h} className="fill-card" />
      <path d={`M${x} ${y + 30}h${w}`} />
      {title}
    </>
  );
}

function Explorer({ x, y, w, h, gap }: Panel & { gap: number }) {
  const rowY = (r: number) => y + 52 + r * gap;
  const chevronX = (depth: number) => x + 14 + depth * 16;
  const folderX = (depth: number) => chevronX(depth) + 9;
  const labelX = (depth: number) => folderX(depth) + 21;
  return (
    <>
      <Frame
        x={x}
        y={y}
        w={w}
        h={h}
        title={
          <Label x={x + 14} y={y + 20} size={TEXT} className="fill-foreground">
            Explorer
          </Label>
        }
      />
      {BASE_ROWS.map(([name, depth, open], r) => (
        <g key={name}>
          <Chevron x={chevronX(depth)} y={rowY(r)} open={open} />
          <Folder x={folderX(depth)} y={rowY(r)} root={depth === 0} />
          <Label
            x={labelX(depth)}
            y={rowY(r) + 4.5}
            size={TEXT}
            className="fill-foreground"
          >
            {name}
          </Label>
        </g>
      ))}
      {MODULES.map(({ name, dir }, n) => {
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
              <Chevron x={chevronX(2)} y={rowY(r)} open={false} />
              <Folder x={folderX(2)} y={rowY(r)} />
              <Label
                x={labelX(2)}
                y={rowY(r) + 4.5}
                size={TEXT}
                className="fill-foreground"
              >
                {dir}
              </Label>
              <path
                d={`M${x + w - 20} ${rowY(r)}h9M${x + w - 15.5} ${rowY(r) - 4.5}v9`}
                strokeWidth="1.25"
              />
            </g>
          </g>
        );
      })}
    </>
  );
}

function Editor({ x, y, w, h }: Panel) {
  const files = [BASE_FILE, ...MODULES];
  const lineY = (r: number) => y + 56 + r * 22;
  return (
    <>
      <Frame x={x} y={y} w={w} h={h} title={null} />
      <path d={`M${x + 34} ${y + 30}V${y + h}`} className="stroke-border" />
      {Array.from({ length: CODE_LINES }, (_, r) => (
        <Label
          key={r}
          x={x + 24}
          y={lineY(r) + 4}
          size={CODE_TEXT}
          anchor="end"
          className="fill-muted-foreground"
        >
          {r + 1}
        </Label>
      ))}
      {files.map(({ file, code }, k) => (
        <g key={file} className="step-only" style={step(k)}>
          <Label x={x + 14} y={y + 20} size={TEXT} className="fill-foreground">
            {file}
          </Label>
          {code.map((text, r) =>
            text === "" ? null : (
              <g
                // oxlint-disable-next-line react/no-array-index-key -- the lines never reorder
                key={r}
                className="tree-type"
                style={{ "--line": r } as CSSProperties}
              >
                <CodeLine x={x + 46} y={lineY(r) + 4} text={text} />
              </g>
            )
          )}
        </g>
      ))}
    </>
  );
}

/** A caret that blinks while its step shows. */
function Caret({ x, y, k }: { x: number; y: number; k: number }) {
  return (
    <g className="step-only" style={step(k)}>
      <rect
        x={x}
        y={y - 11}
        width="7"
        height="13"
        stroke="none"
        className="blink fill-current"
      />
    </g>
  );
}

function Terminal({ x, y, w, h }: Panel) {
  const command = "$ saasaloy add";
  const char = TEXT * ADVANCE;
  const nameX = x + 14 + (command.length + 1) * char;
  const lineY = (r: number) => y + 56 + r * 24;
  return (
    <>
      <Frame
        x={x}
        y={y}
        w={w}
        h={h}
        title={
          <Label x={x + 14} y={y + 20} size={TEXT} className="fill-foreground">
            Terminal
          </Label>
        }
      />
      <Label x={x + 14} y={lineY(0)} size={TEXT} className="fill-foreground">
        {command}
      </Label>
      <Caret x={nameX} y={lineY(0)} k={0} />
      {MODULES.map(({ name, dir }, n) => (
        <g key={name} className="step-only" style={step(n + 1)}>
          <Label x={nameX} y={lineY(0)} size={TEXT} className="fill-foreground">
            {name}
          </Label>
          <Label x={x + 14} y={lineY(1)} size={TEXT}>
            +
          </Label>
          <Label
            x={x + 14 + 2 * char}
            y={lineY(1)}
            size={TEXT}
            className="fill-foreground"
          >
            {`packages/${dir}/`}
          </Label>
          <path d={`M${x + 14} ${lineY(2) - 4}l3 3 6-7`} strokeWidth="1.5" />
          <Label
            x={x + 14 + 2 * char}
            y={lineY(2)}
            size={TEXT}
            className="fill-foreground"
          >
            the files are yours to edit
          </Label>
          <Caret x={nameX + (name.length + 1) * char} y={lineY(0)} k={n + 1} />
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
      strokeWidth="1.25"
      strokeLinejoin="round"
      strokeLinecap="round"
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
        width={700}
        height={548}
        className={`${className} hidden md:block lg:hidden xl:block`}
      >
        <Grid x={10} y={10} w={680} h={528} cell={14} />
        <g className="stroke-current">
          <Cross x={10} y={10} />
          <Cross x={690} y={10} />
          <Cross x={10} y={538} />
          <Cross x={690} y={538} />
        </g>
        <Assemble at={0} y={16}>
          <Explorer x={24} y={62} w={200} h={424} gap={28} />
        </Assemble>
        <Assemble at={15} y={16}>
          <Editor x={236} y={62} w={440} h={286} />
        </Assemble>
        <Assemble at={30} y={16}>
          <Terminal x={236} y={362} w={440} h={124} />
        </Assemble>
        <Assemble at={45}>
          <path
            className="flow"
            strokeDasharray="3 3"
            d="M124 62V32H456V62M124 486V516H456V486"
          />
          <path d="M451 56l5 6 5-6M451 492l5-6 5 6" />
        </Assemble>
      </Drawing>
      <Drawing
        width={320}
        height={548}
        className={`${className} mx-auto max-w-sm md:hidden lg:block lg:max-w-72 xl:hidden`}
      >
        <Assemble at={0} y={16}>
          <Explorer x={1} y={1} w={318} h={396} gap={28} />
        </Assemble>
        <Assemble at={30} y={16}>
          <Terminal x={1} y={423} w={318} h={124} />
        </Assemble>
        <Assemble at={45}>
          <path className="flow" strokeDasharray="3 3" d="M160 397v26" />
          <path d="M155 417l5 6 5-6" />
        </Assemble>
      </Drawing>
    </div>
  );
}
