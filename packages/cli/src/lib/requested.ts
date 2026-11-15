// What the user typed on `saasaloy add`, as the refusal and summary messages name it.
//
// `add` takes several module names in one run (#233). A message raised by a transitive
// prerequisite says `X (required by Y)`, and `Y` has to be the named root that pulled
// `X` in, not whichever name came first. A formatter takes either one name, which reads
// exactly as it always did, or a `Requested` carrying every name and that attribution.

export interface Requested {
  /** The named modules, in argv order, de-duplicated. */
  names: readonly string[];
  /** Each module in the graph mapped to the named root that pulled it in. */
  rootOf: ReadonlyMap<string, string>;
}

/** One name, as every caller passed before #233, or the whole set. */
export type RequestedInput = string | Requested;

export function toRequested(input: RequestedInput): Requested {
  return typeof input === "string"
    ? { names: [input], rootOf: new Map() }
    : input;
}

/** Items as prose: `a`, `a and b`, `a, b and c`. */
export function listLabel(items: readonly string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** The names as prose: `admin`, `admin and teams`, `admin, subscription and teams`. */
export function requestedLabel(input: RequestedInput): string {
  return listLabel(toRequested(input).names);
}

/** The names as a command line reads them: `admin teams`. */
export function requestedArgv(input: RequestedInput): string {
  return toRequested(input).names.join(" ");
}

/** True when `name` is one of the modules the user typed. */
export function isRequested(name: string, input: RequestedInput): boolean {
  return toRequested(input).names.includes(name);
}

/**
 * How a message names one module: bare when the user typed it, otherwise with the named
 * root that pulled it in, `database (required by waitlist)`.
 */
export function subjectOf(name: string, input: RequestedInput): string {
  const requested = toRequested(input);
  if (requested.names.includes(name)) {
    return name;
  }
  const root = requested.rootOf.get(name) ?? requested.names[0];
  return `${name} (required by ${root})`;
}
