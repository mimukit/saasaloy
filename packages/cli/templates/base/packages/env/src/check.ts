import { parseValues } from "./dotenv.ts";

// The checks `env:setup` runs before it writes anything.

/** The comment that says a key is meant to stay empty. */
const BLANK_ON_PURPOSE = "# blank on purpose";

/**
 * Every key whose comment block carries a `# Blank on purpose` line above it.
 *
 * A comment block is the run of comment lines directly above the key, so the marker may
 * sit on any of them. A blank line ends the block.
 */
export function blankOnPurposeKeys(lines: string[]): Set<string> {
  const keys = new Set<string>();
  let marked = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) {
      marked ||= trimmed.toLowerCase().startsWith(BLANK_ON_PURPOSE);
      continue;
    }
    if (trimmed === "") {
      marked = false;
      continue;
    }
    const [key] = [...parseValues([line]).keys()];
    if (key !== undefined && marked) {
      keys.add(key);
    }
    marked = false;
  }
  return keys;
}

/**
 * Every key the example lists that `values` leaves empty, apart from a blank-on-purpose
 * key and a key in `omit`. An empty result means the file is complete.
 */
export function incompleteKeys(
  example: string[],
  values: Map<string, string>,
  omit: readonly string[] = []
): string[] {
  const marked = blankOnPurposeKeys(example);
  return [...parseValues(example).keys()].filter(
    (key) =>
      (values.get(key) ?? "") === "" && !marked.has(key) && !omit.includes(key)
  );
}
