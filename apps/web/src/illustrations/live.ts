// Shared helpers for the live agent drawings. Each drawing writes its loop as keyframes
// in a <style> inside its <svg>. A part takes one keyframe set, named after its class
// and timed in percent of the loop. A part's own style is its state at the end of the
// loop, so with reduced motion the drawing shows that state and nothing moves. The <svg>
// takes `drawing-load` and `data-loop-in-view`; LOOP_SCRIPT marks it `data-offscreen` out
// of view, and `motion` pauses every loop then.

/** Where the loop's parts fade out, so the pass can start over. */
export const END = 94;

/** A keyframe: one or more percentages and the declarations at them. */
export type Frame = [number | number[], string];

const percent = (at: number | number[]) =>
  [at]
    .flat()
    .map((p) => `${Math.min(100, Math.max(0, Math.round(p * 100) / 100))}%`)
    .join(",");

/** One keyframe set, and the class that plays it on a loop of `seconds`. */
export function part(
  name: string,
  seconds: number,
  frames: Frame[],
  extra = ""
): string {
  const body = frames.map(([at, css]) => `${percent(at)}{${css}}`).join("");
  return `@keyframes ${name}{${body}}.${name}{animation:${name} ${seconds}s linear infinite both;${extra}}`;
}

/** Hidden until `from`, then shown until `to`. */
export function appear(from: number, to = END, rise = 0): Frame[] {
  const hidden = `opacity:0;translate:0 ${rise}px`;
  const shown = "opacity:1;translate:0 0";
  return [
    [[0, from], hidden],
    [[from + 2, to], shown],
    [[to + 3, 100], "opacity:0;translate:0 0"],
  ];
}

/** Typed in from the left over `span`, `chars` steps, then held until `to`. */
export function typed(
  from: number,
  span: number,
  chars: number,
  to = END
): Frame[] {
  return [
    [
      [0, from],
      `opacity:1;clip-path:inset(0 100% 0 0);animation-timing-function:steps(${Math.max(1, chars)},end)`,
    ],
    [[from + span, to], "opacity:1;clip-path:inset(0 0 0 0)"],
    [[to + 3, 100], "opacity:0;clip-path:inset(0 0 0 0)"],
  ];
}

/**
 * Wrap a drawing's rules so they only run when motion is welcome, and pause them while
 * the drawing is off screen. The <style> is unlayered, so it beats the pause in the
 * `drawing-load` utility, which sits in Tailwind's utilities layer; the drawing states the
 * pause again itself, last, so it wins over its own `animation` shorthands.
 */
export const motion = (rules: string[]) =>
  `@media (prefers-reduced-motion: no-preference){${rules.join("")}[data-offscreen] *{animation-play-state:paused}}`;

/**
 * A drawing's loop: each call adds one part's keyframes and returns its class. `css()`
 * reads the rules when it runs, so every part must be added first. Build a repeated
 * part with a plain function call, never a child component: React renders a child
 * after the parent's JSX is built, so its parts would miss `css()`.
 */
export function timeline(prefix: string, seconds: number) {
  const rules: string[] = [];
  const name = (n: string) => `${prefix}-${n}`;
  const add = (n: string, frames: Frame[], extra = "") => {
    rules.push(part(name(n), seconds, frames, extra));
    return name(n);
  };
  return {
    add,
    /** Add a raw rule, for a loop that keeps its own clock. */
    raw: (rule: string) => rules.push(rule),
    /** Shown from `from` until `to`; give the part `opacity={0}` for the still drawing. */
    between: (n: string, from: number, to: number) =>
      add(n, [
        [[0, from], "opacity:0"],
        [[from + 1, to], "opacity:1"],
        [[to + 1, 100], "opacity:0"],
      ]),
    shown: (n: string, from: number, rise = 0, to = END) =>
      add(n, appear(from, to, rise)),
    typing: (n: string, from: number, span: number, chars: number) =>
      add(n, typed(from, span, chars)),
    css: () => motion(rules),
  };
}

export type Timeline = ReturnType<typeof timeline>;
