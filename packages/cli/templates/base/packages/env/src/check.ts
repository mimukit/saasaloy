import { parseValues } from "./dotenv.ts";

// The checks `env:setup` and the deploy check run before they write or deploy anything.

/** The comment that says a key is meant to stay empty. */
const BLANK_ON_PURPOSE = "# blank on purpose";

/** The directive that says when a key stops being optional (#390). */
const REQUIRED_WHEN =
  /^#\s*@required-when\s+([A-Za-z_][A-Za-z0-9_]*)\s*(!?=)\s*(\S+)\s*$/;

/** When a conditional key is required, as one `# @required-when` line says. */
export type Condition =
  { key: string; is: string } | { key: string; isNot: string };

/**
 * Walk the example's comment blocks and hand each key the block above it.
 *
 * A comment block is the run of comment lines directly above the key. A blank line ends
 * the block.
 */
function eachKeyBlock(
  lines: string[],
  visit: (key: string, block: string[]) => void
): void {
  let block: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      block.push(trimmed);
      continue;
    }
    if (trimmed === "") {
      block = [];
      continue;
    }
    const [key] = [...parseValues([line]).keys()];
    if (key !== undefined) {
      visit(key, block);
    }
    block = [];
  }
}

/**
 * Every key whose comment block carries a `# Blank on purpose` line above it. The marker
 * may sit on any line of the block.
 */
export function blankOnPurposeKeys(lines: string[]): Set<string> {
  const keys = new Set<string>();
  eachKeyBlock(lines, (key, block) => {
    if (block.some((line) => line.toLowerCase().startsWith(BLANK_ON_PURPOSE))) {
      keys.add(key);
    }
  });
  return keys;
}

/**
 * Every key whose comment block carries one or more `# @required-when KEY=value` or
 * `# @required-when KEY!=value` lines, with the conditions they name.
 */
export function conditionalKeys(lines: string[]): Map<string, Condition[]> {
  const keys = new Map<string, Condition[]>();
  eachKeyBlock(lines, (key, block) => {
    const conditions = block.flatMap((line): Condition[] => {
      const match = REQUIRED_WHEN.exec(line);
      const [, control, operator, value] = match ?? [];
      if (control === undefined || value === undefined) {
        return [];
      }
      return operator === "!="
        ? [{ key: control, isNot: value }]
        : [{ key: control, is: value }];
    });
    if (conditions.length > 0) {
      keys.set(key, conditions);
    }
  });
  return keys;
}

/**
 * Whether `condition` holds against `value`, the controlling key's value. The value is a
 * comma list of names, so `manual,bkash` names `bkash`. `is` holds when the list names the
 * value, and `isNot` holds when it does not, so a blank controlling key makes `isNot` true.
 */
export function conditionHolds(
  condition: Condition,
  value: string | undefined
): boolean {
  const names = new Set(
    (value ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => name !== "")
  );
  return "is" in condition
    ? names.has(condition.is)
    : !names.has(condition.isNot);
}

/** The condition as a missing-key message prints it: `KEY=value` or `KEY!=value`. */
export function describeCondition(condition: Condition): string {
  return "is" in condition
    ? `${condition.key}=${condition.is}`
    : `${condition.key}!=${condition.isNot}`;
}

/**
 * Every conditional key none of whose conditions holds against `values`. Such a key may
 * stay blank, like a blank-on-purpose key.
 */
export function inactiveKeys(
  example: string[],
  values: Map<string, string>
): Set<string> {
  const keys = new Set<string>();
  for (const [key, conditions] of conditionalKeys(example)) {
    if (
      !conditions.some((condition) =>
        conditionHolds(condition, values.get(condition.key))
      )
    ) {
      keys.add(key);
    }
  }
  return keys;
}

/** Every key that may stay blank under `values`: blank on purpose, or conditional and inactive. */
export function blankAllowedKeys(
  example: string[],
  values: Map<string, string>
): Set<string> {
  return new Set([
    ...blankOnPurposeKeys(example),
    ...inactiveKeys(example, values),
  ]);
}

/**
 * Every key the example lists that `values` leaves empty, apart from a blank-on-purpose
 * key, a conditional key whose condition does not hold, and a key in `omit`. An empty
 * result means the file is complete.
 */
export function incompleteKeys(
  example: string[],
  values: Map<string, string>,
  omit: readonly string[] = []
): string[] {
  const allowed = blankAllowedKeys(example, values);
  return [...parseValues(example).keys()].filter(
    (key) =>
      (values.get(key) ?? "") === "" && !allowed.has(key) && !omit.includes(key)
  );
}

/**
 * `keys` as a missing-key message lists them: a conditional key carries the conditions
 * that hold, as `PLUNK_API_KEY (required: EMAIL_PROVIDER=plunk)`.
 */
export function describeMissing(
  example: string[],
  values: Map<string, string>,
  keys: readonly string[]
): string[] {
  const conditional = conditionalKeys(example);
  return keys.map((key) => {
    const holding = (conditional.get(key) ?? []).filter((condition) =>
      conditionHolds(condition, values.get(condition.key))
    );
    return holding.length === 0
      ? key
      : `${key} (required: ${holding.map(describeCondition).join(", ")})`;
  });
}
