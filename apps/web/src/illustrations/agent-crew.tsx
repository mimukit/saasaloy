// The agent support illustration: a coding agent session in a Saasaloy project, after
// the owner's choice of the console and lanes mix. A lead agent takes the prompt, reads
// the project's `AGENTS.md` and the web app's `DESIGN.md`, then starts one agent per
// module. Each module agent reads its module's own `SKILL.md`, edits the code and checks
// it, in its own lane. When the three lanes are done, the lead agent runs `pnpm check` on
// the whole project. Line art in `highlight`, the panel and cards in `card`, and the one
// `primary` fill on the context meter, which grows with every file an agent reads.
// Decorative: the copy beside it carries the facts.
//
// The layout keeps one grid: the spinners and ticks centre on `ICON`, the verbs and the
// lane names start at `VERB`, the targets and the meter start at `TARGET`, and every
// right edge lands on `RIGHT`.
//
// Motion: one 16s pass that loops while the drawing is in view. The prompt types in,
// the reads spin and tick, the meter fills, and the lanes start about 1s apart, so they
// overlap: a marker moves along each lane's progress line, a band scans its `SKILL.md`,
// its code lines type in and its gates tick. The status words follow along. The loop's
// keyframes come from ./live.ts, in a <style> inside the <svg>. With reduced motion the
// drawing shows the finished run.

import type { Timeline } from "@web/illustrations/live";
import { END, timeline } from "@web/illustrations/live";
import { Label, Lines, Sheet } from "@web/illustrations/parts";

const LOOP = 16;

/** The panel, and the grid inside it. */
const PANEL = { x: 12, y: 12, w: 572, h: 426 };
const ICON = 32;
const VERB = 48;
const TARGET = 96;
const RIGHT = 568;

const SPIN =
  "@keyframes cr-spin{to{rotate:360deg}}.cr-spin{animation:cr-spin 0.9s linear infinite;transform-box:fill-box;transform-origin:center}";

/** A spinner, centred on (x, y). */
function Spinner({ x, y }: { x: number; y: number }) {
  return (
    <path
      className="cr-spin"
      d={`M${x + 5} ${y}a5 5 0 1 1-5-5`}
      strokeWidth="1.5"
    />
  );
}

/** A tick, centred on (x, y). */
function Tick({ x, y }: { x: number; y: number }) {
  return <path d={`M${x - 4} ${y}l3 3 6-7`} strokeWidth="1.5" />;
}

/**
 * A tool call: a spinner while it runs, a tick when it is done. A plain function, not a
 * component, so its keyframes are in before `t.css()` runs (see ./live.ts).
 */
function call({
  t,
  name,
  y,
  verb,
  target,
  from,
  done,
}: {
  t: Timeline;
  name: string;
  y: number;
  verb: string;
  target: string;
  from: number;
  done: number;
}) {
  return (
    <g className={t.shown(`${name}-row`, from, 6)}>
      <g className={t.between(`${name}-run`, from, done)} opacity={0}>
        <Spinner x={ICON} y={y - 4} />
      </g>
      <g className={t.shown(`${name}-done`, done)}>
        <Tick x={ICON} y={y - 4} />
      </g>
      <Label x={VERB} y={y} size={11}>
        {verb}
      </Label>
      <Label x={TARGET} y={y} size={11}>
        {target}
      </Label>
    </g>
  );
}

/** The baselines of the lead agent's rows. */
const ROW = { agents: 110, design: 134, meter: 158, start: 182, check: 408 };

const MODULES = ["auth", "email", "waitlist"];
/** When lane `k` starts, in percent of the pass. */
const laneStart = (k: number) => 24 + k * 6;
/** Each lane's track; its cards sit `CARD_TOP` below it. */
const LANE_Y = [202, 264, 326];
const CARD_TOP = 8;
const CARD_H = 44;

/** Three cards of one width between `CARDS_LEFT` and `RIGHT`. */
const CARDS_LEFT = 116;
const CARD_GAP = 13;
const CARD_W = (RIGHT - CARDS_LEFT - 2 * CARD_GAP) / 3;
const [SKILL, EDIT, CHECK] = [0, 1, 2].map(
  (index) => CARDS_LEFT + index * (CARD_W + CARD_GAP)
);
const stop = (left: number) => left + CARD_W / 2;

/** The meter's share after each read: two project files, then three skills. */
const COUNT_W = 56;
const METER_W = RIGHT - TARGET - COUNT_W;
const READS: [number, number][] = [
  [12, 0.3],
  [17, 0.55],
  ...MODULES.map((_, k): [number, number] => [
    laneStart(k) + 10,
    0.67 + k * 0.12,
  ]),
];
const FULL = READS.at(-1)?.[1] ?? 1;

const GATES = ["typecheck", "lint", "test", "build"];
/** The space between the lead agent's gates; the last one's label ends on `RIGHT`. */
const GATE_STEP = 96;

const STATUS: [string, number, number][] = [
  ["reading", 7, 20],
  ["delegating", 20, 72],
  ["checking", 72, 86],
];

const LANE_STATUS: [string, number, number][] = [
  ["reading", 0, 11],
  ["editing", 11, 23],
  ["checking", 23, 34],
];

/** One module agent's lane. A plain function, for the same reason as `call`. */
function lane(t: Timeline, k: number) {
  const name = MODULES[k];
  const y = LANE_Y[k];
  const cardY = y + CARD_TOP;
  const at = (offset: number) => laneStart(k) + offset;
  const checkStop = stop(CHECK);
  const offset = (left: number) => stop(left) - checkStop;
  const share = (left: number) =>
    (stop(left) - CARDS_LEFT) / (checkStop - CARDS_LEFT);
  const nameY = cardY + CARD_H / 2;
  // The tree line from the start row, or the lane above, to the middle of this lane's name.
  const branch = (index: number) => LANE_Y[index] + CARD_TOP + CARD_H / 2 - 6;
  const fromY = k === 0 ? ROW.start + 8 : branch(k - 1);

  const marker = t.add(`${name}-marker`, [
    [[0, at(0)], `opacity:0;translate:${offset(SKILL)}px 0`],
    [[at(1), at(10)], `opacity:1;translate:${offset(SKILL)}px 0`],
    [[at(12), at(22)], `opacity:1;translate:${offset(EDIT)}px 0`],
    [[at(24), END], "opacity:1;translate:0 0"],
    [[END + 3, 100], "opacity:0;translate:0 0"],
  ]);
  const progress = t.add(
    `${name}-progress`,
    [
      [[0, at(0)], "scale:0 1"],
      [[at(10)], `scale:${share(SKILL)} 1`],
      [[at(12), at(22)], `scale:${share(EDIT)} 1`],
      [[at(24), END], "scale:1 1"],
      [[END + 3, 100], "scale:0 1"],
    ],
    "transform-box:fill-box;transform-origin:left"
  );
  const scan = t.add(`${name}-scan`, [
    [[0, at(1)], "opacity:0;translate:0 0"],
    [[at(1.5)], "opacity:1;translate:0 0"],
    [[at(5.5)], "opacity:1;translate:0 30px"],
    [[at(6)], "opacity:1;translate:0 0"],
    [[at(10)], "opacity:1;translate:0 30px"],
    [[at(10.5), 100], "opacity:0;translate:0 30px"],
  ]);
  /** A card's tint while the lane works on it. */
  const tint = (left: number, part: string, from: number, to: number) => (
    <rect
      className={`${t.between(`${name}-${part}-on`, at(from), at(to))} fill-secondary`}
      opacity={0}
      x={left}
      y={cardY}
      width={CARD_W}
      height={CARD_H}
      stroke="none"
    />
  );

  return (
    <g>
      <path className="stroke-border" d={`M${ICON} ${fromY}V${branch(k)}h10`} />

      {/* The lane's module and status. */}
      <Label x={VERB} y={nameY - 2} size={11}>
        {name}
      </Label>
      {LANE_STATUS.map(([word, from, to]) => (
        <g
          key={word}
          className={t.between(`${name}-${word}`, at(from), at(to))}
          opacity={0}
        >
          <Label
            x={VERB}
            y={nameY + 14}
            size={10}
            className="fill-muted-foreground"
          >
            {word}
          </Label>
        </g>
      ))}
      <g className={t.shown(`${name}-done`, at(34))}>
        <Label
          x={VERB}
          y={nameY + 14}
          size={10}
          className="fill-muted-foreground"
        >
          done
        </Label>
      </g>

      {/* The track and its progress. */}
      <path className="stroke-border" d={`M${CARDS_LEFT} ${y}H${RIGHT}`} />
      <rect
        className={progress}
        x={CARDS_LEFT}
        y={y - 1}
        width={checkStop - CARDS_LEFT}
        height="2"
        fill="currentColor"
        stroke="none"
      />

      {/* The cards: the fills, the tints, then one outline over both. */}
      {[SKILL, EDIT, CHECK].map((left) => (
        <rect
          key={left}
          x={left}
          y={cardY}
          width={CARD_W}
          height={CARD_H}
          className="fill-card"
          stroke="none"
        />
      ))}
      {tint(SKILL, "skill", 0, 11)}
      {tint(EDIT, "edit", 11, 23)}
      {tint(CHECK, "check", 23, 34)}
      <path
        d={[SKILL, EDIT, CHECK]
          .map((left) => `M${left} ${cardY}h${CARD_W}v${CARD_H}h${-CARD_W}z`)
          .join("")}
      />

      {/* SKILL.md, with its scan line. */}
      <g transform={`translate(${SKILL} ${cardY})`}>
        <Label x={10} y={16} size={10}>
          SKILL.md
        </Label>
        <Lines x={10} y={26} gap={7} widths={[96, 70, 84]} />
        <path
          className={scan}
          opacity={0}
          strokeWidth="1.5"
          d={`M4 8h${CARD_W - 8}`}
        />
      </g>

      {/* The edit, its lines typing in. */}
      <g transform={`translate(${EDIT} ${cardY})`}>
        <Label x={10} y={16} size={10}>
          edit
        </Label>
        {[
          [44, 30],
          [26, 56],
        ].map(([a, b], line) => (
          <g
            key={line}
            className={t.typing(
              `${name}-code-${line}`,
              at(13 + line * 4),
              4,
              8
            )}
          >
            <Label x={10} y={30 + line * 10} size={10}>
              +
            </Label>
            <path d={`M22 ${27 + line * 10}h${a}`} />
            <path
              className="stroke-border"
              d={`M${28 + a} ${27 + line * 10}h${b}`}
            />
          </g>
        ))}
      </g>

      {/* The check, its gates ticking. */}
      <g transform={`translate(${CHECK} ${cardY})`}>
        <Label x={10} y={16} size={10}>
          check
        </Label>
        {GATES.map((gate, g) => (
          <g key={gate} transform={`translate(${10 + g * 34} 24)`}>
            <rect className="stroke-border" width="12" height="12" />
            <path
              className={t.shown(`${name}-${gate}`, at(25 + g * 2.5))}
              d="M2 6l3 3 5-6"
            />
          </g>
        ))}
      </g>

      <g className={marker} transform={`translate(${checkStop} ${y})`}>
        <rect
          x="-5"
          y="-5"
          width="10"
          height="10"
          className="fill-current"
          stroke="none"
        />
      </g>
    </g>
  );
}

export function AgentCrew({ className }: { className?: string }) {
  const t = timeline("cr", LOOP);
  t.raw(SPIN);

  const meter = t.add(
    "meter",
    [
      [[0, 7], "scale:0 1"],
      ...READS.map(([at, share]): [number[], string] => [
        [at],
        `scale:${share / FULL} 1`,
      ]),
      [[READS.at(-1)?.[0] ?? 50, END], "scale:1 1"],
      [[END + 3, 100], "scale:0 1"],
    ],
    "transform-box:fill-box;transform-origin:left"
  );
  const header = PANEL.y + 15;

  return (
    <svg
      viewBox="0 0 600 450"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-loop-in-view
      className={className}
    >
      <g transform={`translate(${PANEL.x} ${PANEL.y})`}>
        <Sheet w={PANEL.w} h={PANEL.h} depth={8} />
        <path d={`M0 30h${PANEL.w}`} />
      </g>
      <circle cx={ICON - 4} cy={header} r="3" />
      <circle cx={ICON + 8} cy={header} r="3" />
      <Label x={VERB + 8} y={header + 4} size={11}>
        agent
      </Label>

      {/* The lead agent's status, at the header's right edge. */}
      <g className={t.between("status-run", 0, 86)} opacity={0}>
        <Spinner x={RIGHT - 4} y={header} />
      </g>
      {STATUS.map(([word, from, to]) => (
        <g
          key={word}
          className={t.between(`status-${word}`, from, to)}
          opacity={0}
        >
          <Label x={RIGHT - 16} y={header + 4} size={11} anchor="end">
            {word}
          </Label>
        </g>
      ))}
      <g className={t.shown("status-done", 86)}>
        <Tick x={RIGHT - 4} y={header} />
        <Label x={RIGHT - 16} y={header + 4} size={11} anchor="end">
          done
        </Label>
      </g>

      {/* The prompt. */}
      <rect
        x={PANEL.x + 12}
        y="54"
        width={PANEL.w - 24}
        height="28"
        className="fill-secondary"
      />
      <Label x={ICON} y={73} size={11} anchor="middle">
        ›
      </Label>
      <g className={t.typing("prompt", 0, 6, 30)}>
        <Label x={VERB} y={73} size={11}>
          add auth, email and a waitlist
        </Label>
      </g>

      {/* The lead agent reads the project. */}
      {call({
        t,
        name: "agents",
        y: ROW.agents,
        verb: "Read",
        target: "AGENTS.md",
        from: 7,
        done: 12,
      })}
      {call({
        t,
        name: "design",
        y: ROW.design,
        verb: "Read",
        target: "apps/web/DESIGN.md",
        from: 12,
        done: 17,
      })}

      {/* The context meter, which every agent's reads fill. */}
      <g className={t.shown("meter-row", 7)}>
        <Label
          x={VERB}
          y={ROW.meter}
          size={10}
          className="fill-muted-foreground"
        >
          context
        </Label>
        <rect x={TARGET} y={ROW.meter - 9} width={METER_W} height={10} />
        <rect
          className={`${meter} fill-primary`}
          x={TARGET}
          y={ROW.meter - 9}
          width={METER_W * FULL}
          height={10}
          stroke="none"
        />
      </g>
      {READS.map(([from], index) => {
        const to = READS[index + 1]?.[0];
        const count = `${index + 1} ${index === 0 ? "file" : "files"}`;
        const label = (
          <Label x={RIGHT} y={ROW.meter} size={10} anchor="end">
            {count}
          </Label>
        );
        return to === undefined ? (
          <g key={count} className={t.shown(`count-${index}`, from)}>
            {label}
          </g>
        ) : (
          <g
            key={count}
            className={t.between(`count-${index}`, from, to)}
            opacity={0}
          >
            {label}
          </g>
        );
      })}

      {/* The module agents, one lane each. */}
      {call({
        t,
        name: "spawn",
        y: ROW.start,
        verb: "Start",
        target: "3 agents, one per module",
        from: 20,
        done: laneStart(2) + 34,
      })}
      {MODULES.map((module, k) => (
        <g
          key={module}
          className={t.shown(`lane-${module}`, laneStart(k) - 2, 6)}
        >
          {lane(t, k)}
        </g>
      ))}

      {/* The lead agent checks the whole project. */}
      {call({
        t,
        name: "check",
        y: ROW.check,
        verb: "Run",
        target: "pnpm check",
        from: 72,
        done: 86,
      })}
      {GATES.map((gate, g) => {
        const gx = RIGHT - 48 - (GATES.length - 1 - g) * GATE_STEP;
        return (
          <g key={gate} className={t.shown(`gate-${gate}`, 72)}>
            <rect
              className="stroke-border"
              x={gx}
              y={ROW.check - 10}
              width="12"
              height="12"
            />
            <g className={t.shown(`gate-${gate}-tick`, 75 + g * 3)}>
              <Tick x={gx + 6} y={ROW.check - 4} />
            </g>
            <Label x={gx + 18} y={ROW.check} size={10}>
              {gate}
            </Label>
          </g>
        );
      })}

      <style>{t.css()}</style>
    </svg>
  );
}
