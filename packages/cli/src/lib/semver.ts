// A semver range matcher, small enough to own (#50). The descriptor's `requires` field
// names a range the running CLI has to satisfy, so the tool needs to answer "does
// version V fall inside range R?" and nothing else — no version bumping, no sorting a
// release feed, no coercion of loose input.
//
// That is why there is no `semver` dependency here. The npm package is ~10 files of
// range arithmetic the CLI would ship to every consumer for one boolean, and the CLI's
// runtime dependency list is deliberately short (`@clack/prompts`, `ajv`, `diff`,
// `giget`, `jsonc-parser`, `magicast`, `picocolors`). The grammar below is the subset
// the field can legally use, and every shape it accepts is pinned by a test.
//
// Supported: `*` / `x` / empty (any), partial versions (`1`, `1.2`, `1.x`), `^`, `~`,
// `>`/`>=`/`<`/`<=`/`=`, whitespace as AND, `||` as OR, and the hyphen range `A - B`.
//
// Prereleases follow node-semver's default rule: `1.0.0-rc.1` does not satisfy `*` or
// `>=0.9.0`. A prerelease is only admitted when some comparator in the same AND-set
// names the same major.minor.patch *and* carries a prerelease of its own. Without that
// rule every release candidate would silently pass a range written for stable versions.

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
  /** Dot-separated prerelease identifiers, numeric ones parsed as numbers. Empty on a release. */
  prerelease: (string | number)[];
}

/** One `>=1.2.0`-shaped constraint. `=` is the exact-match form partial ranges expand into. */
export interface Comparator {
  op: ">" | ">=" | "<" | "<=" | "=";
  version: SemVer;
}

/**
 * A parsed range: an OR of AND-sets, mirroring `a || b` over `>=1 <2`. An empty AND-set
 * is `*` — it matches every release. An empty OR list is impossible; `parseRange`
 * returns `undefined` instead.
 */
export type Range = Comparator[][];

// No leading zeroes in a numeric part: `01.2.3` is not a semver version, and accepting
// it would make `01.2.3` and `1.2.3` two spellings of one release.
const VERSION_PATTERN =
  /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?$/;

const NUMERIC = /^(?:0|[1-9]\d*)$/;

function parsePrerelease(raw: string | undefined): (string | number)[] {
  if (raw === undefined) {
    return [];
  }
  return raw
    .split(".")
    .map((part) => (NUMERIC.test(part) ? Number(part) : part));
}

/** A `SemVer` for a full `major.minor.patch` version, or `undefined` when it is not one. */
export function parseVersion(input: string): SemVer | undefined {
  const match = VERSION_PATTERN.exec(input.trim());
  if (!match) {
    return undefined;
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: parsePrerelease(match[4]),
  };
}

function compareIdentifiers(a: string | number, b: string | number): number {
  const aNumeric = typeof a === "number";
  const bNumeric = typeof b === "number";
  // "Numeric identifiers always have lower precedence than non-numeric identifiers."
  if (aNumeric && bNumeric) {
    return a < b ? -1 : a > b ? 1 : 0;
  }
  if (aNumeric) {
    return -1;
  }
  if (bNumeric) {
    return 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Negative when `a` precedes `b`, positive when it follows, zero when they are equal. */
export function compareVersions(a: SemVer, b: SemVer): number {
  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) {
      return a[key] < b[key] ? -1 : 1;
    }
  }
  // A version with a prerelease precedes the release it leads to.
  if (a.prerelease.length === 0 && b.prerelease.length === 0) {
    return 0;
  }
  if (a.prerelease.length === 0) {
    return 1;
  }
  if (b.prerelease.length === 0) {
    return -1;
  }
  const shared = Math.min(a.prerelease.length, b.prerelease.length);
  for (let i = 0; i < shared; i++) {
    const result = compareIdentifiers(a.prerelease[i]!, b.prerelease[i]!);
    if (result !== 0) {
      return result;
    }
  }
  // A longer identifier list wins when every shared identifier is equal.
  return a.prerelease.length - b.prerelease.length;
}

/** One `1`, `1.2`, `1.2.3`, `1.x` token, with the parts the author left out marked absent. */
interface Partial {
  major?: number;
  minor?: number;
  patch?: number;
  prerelease: (string | number)[];
}

const WILDCARD = new Set(["", "*", "x", "X"]);
const PARTIAL_PATTERN =
  /^v?(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:\.(0|[1-9]\d*|[xX*])(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z][0-9A-Za-z.-]*)?)?)?$/;

function parsePartial(raw: string): Partial | undefined {
  const input = raw.trim();
  if (WILDCARD.has(input)) {
    return { prerelease: [] };
  }
  const match = PARTIAL_PATTERN.exec(input);
  if (!match) {
    return undefined;
  }
  const part = (value: string | undefined): number | undefined =>
    value === undefined || WILDCARD.has(value) ? undefined : Number(value);
  const major = part(match[1]);
  const minor = part(match[2]);
  const patch = part(match[3]);
  // `1.x.3` names a patch under an unknown minor, which constrains nothing coherent.
  if (
    (major === undefined && (minor !== undefined || patch !== undefined)) ||
    (minor === undefined && patch !== undefined)
  ) {
    return undefined;
  }
  return {
    ...(major === undefined ? {} : { major }),
    ...(minor === undefined ? {} : { minor }),
    ...(patch === undefined ? {} : { patch }),
    prerelease: parsePrerelease(match[4]),
  };
}

function version(
  major: number,
  minor = 0,
  patch = 0,
  prerelease: (string | number)[] = []
): SemVer {
  return { major, minor, patch, prerelease };
}

/** The lowest version a partial admits: `1.2` → `1.2.0`, `1` → `1.0.0`. */
function floor(partial: Partial): SemVer {
  return version(
    partial.major ?? 0,
    partial.minor ?? 0,
    partial.patch ?? 0,
    partial.prerelease
  );
}

/** The first version *above* a partial: `1.2` → `1.3.0`, `1` → `2.0.0`. */
function ceiling(partial: Partial): SemVer | undefined {
  if (partial.major === undefined) {
    return undefined;
  }
  if (partial.minor === undefined) {
    return version(partial.major + 1);
  }
  if (partial.patch === undefined) {
    return version(partial.major, partial.minor + 1);
  }
  return version(partial.major, partial.minor, partial.patch + 1);
}

/** `^1.2.3` → `<2.0.0`, `^0.2.3` → `<0.3.0`, `^0.0.3` → `<0.0.4`: the leftmost non-zero part moves. */
function caretCeiling(partial: Partial): SemVer | undefined {
  const { major, minor, patch } = partial;
  if (major === undefined) {
    return undefined;
  }
  if (major !== 0 || minor === undefined) {
    return version(major + 1);
  }
  if (minor !== 0 || patch === undefined) {
    return version(0, minor + 1);
  }
  return version(0, 0, patch + 1);
}

const OPERATOR_PATTERN = /^(>=|<=|>|<|=)?\s*(.*)$/;

/** The comparators one whitespace-separated token expands into, or `undefined` when it is not a token. */
function parseToken(token: string): Comparator[] | undefined {
  const match = OPERATOR_PATTERN.exec(token);
  if (!match) {
    return undefined;
  }
  const raw = match[2] ?? "";
  const op = match[1];
  if (op !== undefined && WILDCARD.has(raw.trim())) {
    // `>=*` and friends: an operator with nothing to compare against.
    return raw.trim() === "" ? undefined : [];
  }
  if (raw.startsWith("^") || raw.startsWith("~")) {
    if (op !== undefined) {
      return undefined; // `>=^1.0.0` is not a range.
    }
    // A bare `^` or `~` parses as "any" in node-semver. Here it is a truncated range an
    // author meant to finish, so it is reported rather than silently widened.
    if (raw.slice(1).trim() === "") {
      return undefined;
    }
    const partial = parsePartial(raw.slice(1));
    if (!partial) {
      return undefined;
    }
    if (partial.major === undefined) {
      return [];
    }
    const upper = raw.startsWith("^")
      ? caretCeiling(partial)
      : ceiling(partial);
    const lower: Comparator = { op: ">=", version: floor(partial) };
    // `~1.2` and `~1.2.3` both stop at the next minor; `~1` stops at the next major.
    const tildeUpper =
      partial.minor === undefined
        ? version(partial.major + 1)
        : version(partial.major, partial.minor + 1);
    const bound = raw.startsWith("^") ? upper : tildeUpper;
    return bound ? [lower, { op: "<", version: bound }] : [lower];
  }

  const partial = parsePartial(raw);
  if (!partial) {
    return undefined;
  }
  if (partial.major === undefined) {
    // `*`, `x`, and a bare `=` with a wildcard constrain nothing.
    return [];
  }
  const low = floor(partial);
  const high = ceiling(partial);
  switch (op) {
    case ">": {
      // `>1.2` means "after everything 1.2.x", so it floors at the next minor.
      return [
        partial.patch === undefined && high
          ? { op: ">=", version: high }
          : { op: ">", version: low },
      ];
    }
    case ">=": {
      return [{ op: ">=", version: low }];
    }
    case "<": {
      return [{ op: "<", version: low }];
    }
    case "<=": {
      return [
        partial.patch === undefined && high
          ? { op: "<", version: high }
          : { op: "<=", version: low },
      ];
    }
    default: {
      // Bare or `=`: an exact version pins, a partial becomes the range it covers.
      if (partial.patch !== undefined) {
        return [{ op: "=", version: low }];
      }
      return high
        ? [
            { op: ">=", version: low },
            { op: "<", version: high },
          ]
        : [{ op: ">=", version: low }];
    }
  }
}

const HYPHEN_PATTERN = /\s+-\s+/;

/** The comparators one AND-set (`>=1 <2`, or `1.2.3 - 2.3.4`) expands into. */
function parseComparatorSet(input: string): Comparator[] | undefined {
  const trimmed = input.trim();
  if (trimmed === "") {
    return [];
  }
  if (HYPHEN_PATTERN.test(trimmed)) {
    const sides = trimmed.split(HYPHEN_PATTERN);
    if (sides.length !== 2) {
      return undefined;
    }
    const low = parsePartial(sides[0]!);
    const high = parsePartial(sides[1]!);
    if (!low || !high) {
      return undefined;
    }
    const out: Comparator[] = [];
    if (low.major !== undefined) {
      out.push({ op: ">=", version: floor(low) });
    }
    if (high.major === undefined) {
      return out;
    }
    // `1 - 2` includes all of 2.x; `1 - 2.3.4` stops at that exact version.
    const bound = ceiling(high);
    out.push(
      high.patch === undefined && bound
        ? { op: "<", version: bound }
        : { op: "<=", version: floor(high) }
    );
    return out;
  }

  const comparators: Comparator[] = [];
  for (const token of trimmed.split(/\s+/)) {
    const parsed = parseToken(token);
    if (!parsed) {
      return undefined;
    }
    comparators.push(...parsed);
  }
  return comparators;
}

/** The parsed range, or `undefined` when the string is not a range this grammar accepts. */
export function parseRange(input: string): Range | undefined {
  const sets: Range = [];
  for (const part of input.split("||")) {
    // An empty side of `||` (as in `"||"`) is a typo, not "match anything".
    if (input.includes("||") && part.trim() === "") {
      return undefined;
    }
    const set = parseComparatorSet(part);
    if (!set) {
      return undefined;
    }
    sets.push(set);
  }
  return sets;
}

/** True when the string is a range `satisfies` can evaluate. `doctor` reports the rest. */
export function isValidRange(input: string): boolean {
  return parseRange(input) !== undefined;
}

function matches(value: SemVer, comparator: Comparator): boolean {
  const order = compareVersions(value, comparator.version);
  switch (comparator.op) {
    case ">": {
      return order > 0;
    }
    case ">=": {
      return order >= 0;
    }
    case "<": {
      return order < 0;
    }
    case "<=": {
      return order <= 0;
    }
    default: {
      return order === 0;
    }
  }
}

function sameTuple(a: SemVer, b: SemVer): boolean {
  return a.major === b.major && a.minor === b.minor && a.patch === b.patch;
}

function satisfiesSet(value: SemVer, set: Comparator[]): boolean {
  if (!set.every((comparator) => matches(value, comparator))) {
    return false;
  }
  if (value.prerelease.length === 0) {
    return true;
  }
  // node-semver's default: a prerelease is only in range when the author wrote a
  // prerelease of the same version into the range, so `>=0.9` never picks up `1.0.0-rc.1`.
  return set.some(
    (comparator) =>
      comparator.version.prerelease.length > 0 &&
      sameTuple(value, comparator.version)
  );
}

/** True when `version` falls inside `range`. False when either side does not parse. */
export function satisfies(candidate: string, range: string): boolean {
  const parsed = parseVersion(candidate);
  const sets = parseRange(range);
  if (!parsed || !sets) {
    return false;
  }
  return sets.some((set) => satisfiesSet(parsed, set));
}
