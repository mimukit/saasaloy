import { useCallback, useSyncExternalStore } from "react";

// Whether a media query matches, read through useSyncExternalStore so a resize re-renders
// the reader and nothing else. The breakpoints are Tailwind's own defaults, in pixels, so
// `useMediaQuery("max-md")` agrees with every `md:` class in the admin set.

const BREAKPOINTS = {
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
} as const;

type Breakpoint = keyof typeof BREAKPOINTS;

/** `md` is "at least md", `max-md` is "below md", and `md:max-xl` is the range between. */
export type BreakpointQuery =
  Breakpoint | `max-${Breakpoint}` | `${Breakpoint}:max-${Breakpoint}`;

export interface MediaQueryInput {
  min?: Breakpoint | number;
  max?: Breakpoint | number;
  /** Touch-like input (finger). Use "fine" for mouse/trackpad. */
  pointer?: "coarse" | "fine";
}

/** A raw media query, written with its own parentheses. */
type RawMediaQuery = `(${string})`;

function isBreakpoint(value: string): value is Breakpoint {
  return Object.hasOwn(BREAKPOINTS, value);
}

function toPixels(value: Breakpoint | number): number {
  return typeof value === "number" ? value : BREAKPOINTS[value];
}

function resolveMin(value: Breakpoint | number): string {
  return `(min-width: ${toPixels(value)}px)`;
}

function resolveMax(value: Breakpoint | number): string {
  return `(max-width: ${toPixels(value) - 1}px)`;
}

function parseQuery(
  query: BreakpointQuery | MediaQueryInput | RawMediaQuery
): string {
  if (typeof query !== "string") {
    const parts: string[] = [];
    if (query.min !== undefined) {
      parts.push(resolveMin(query.min));
    }
    if (query.max !== undefined) {
      parts.push(resolveMax(query.max));
    }
    if (query.pointer !== undefined) {
      parts.push(`(pointer: ${query.pointer})`);
    }
    return parts.length === 0 ? "(min-width: 0px)" : parts.join(" and ");
  }

  if (query.startsWith("(")) {
    return query;
  }

  const parts: string[] = [];
  for (const segment of query.split(":")) {
    const name = segment.startsWith("max-") ? segment.slice(4) : segment;
    if (isBreakpoint(name)) {
      parts.push(
        segment.startsWith("max-") ? resolveMax(name) : resolveMin(name)
      );
    }
  }

  return parts.join(" and ");
}

function getServerSnapshot(): boolean {
  return false;
}

function noop(): void {
  // Nothing to unsubscribe from outside a browser.
}

export function useMediaQuery(
  query: BreakpointQuery | MediaQueryInput | RawMediaQuery
): boolean {
  const mediaQuery = parseQuery(query);

  const subscribe = useCallback(
    (callback: () => void) => {
      if (typeof window === "undefined") {
        return noop;
      }
      const list = window.matchMedia(mediaQuery);
      list.addEventListener("change", callback);
      return () => {
        list.removeEventListener("change", callback);
      };
    },
    [mediaQuery]
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(mediaQuery).matches;
  }, [mediaQuery]);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useIsMobile(): boolean {
  return useMediaQuery("max-md");
}
