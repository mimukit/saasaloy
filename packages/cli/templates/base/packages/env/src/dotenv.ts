// Reading and writing a `.env`, the file `wrangler dev`, `vite dev` and `astro dev` all
// read. The work is line-based on purpose: comments, blank lines and key order survive a
// merge, so a written file still reads like the example it came from.

const KEY_LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function keyOf(line: string): string | undefined {
  return KEY_LINE.exec(line)?.[1];
}

/** Split a file's text into lines, without the trailing empty one a final newline makes. */
export function splitLines(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

/** Write the lines back as a file, with the trailing newline every `.env` ends on. */
export function formatEnv(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

/** Every key's value. A repeated key keeps its last value, as `process.loadEnvFile` does. */
export function parseValues(lines: string[]): Map<string, string> {
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    const key = match?.[1];
    if (key === undefined) {
      continue;
    }
    const raw = (match?.[2] ?? "").trim();
    const quoted = /^(["'])(.*)\1$/.exec(raw);
    values.set(key, quoted === null ? raw : (quoted[2] ?? ""));
  }
  return values;
}

/** Set `key` on its first line, drop any later line for it, and append it when absent. */
export function setKey(lines: string[], key: string, value: string): string[] {
  const result: string[] = [];
  let written = false;
  for (const line of lines) {
    if (keyOf(line) !== key) {
      result.push(line);
    } else if (!written) {
      result.push(`${key}=${value}`);
      written = true;
    }
  }
  if (!written) {
    result.push(`${key}=${value}`);
  }
  return result;
}

/** Drop every line that sets `key`. */
export function removeKey(lines: string[], key: string): string[] {
  return lines.filter((line) => keyOf(line) !== key);
}

/**
 * Fill `target` with the example's local defaults. A key `target` lacks is appended with
 * the example's whole line, and a key `target` leaves blank takes the example's line when
 * that line carries a value. A key `target` sets keeps its value.
 *
 * Without this, a key a module adds after the first `env:setup` reaches the example and
 * never the file, and the Worker throws on the first request that needs it.
 */
export function addExampleKeys(target: string[], example: string[]): string[] {
  const present = parseValues(target);
  const defaults = new Map<string, string>();
  for (const line of example) {
    const key = keyOf(line);
    if (key !== undefined) {
      defaults.set(key, line);
    }
  }

  const lines = target.map((line) => {
    const key = keyOf(line);
    const fallback = key === undefined ? undefined : defaults.get(key);
    if (key === undefined || fallback === undefined) {
      return line;
    }
    if (present.get(key) !== "") {
      return line;
    }
    return parseValues([fallback]).get(key) === "" ? line : fallback;
  });
  for (const [key, line] of defaults) {
    if (!present.has(key)) {
      lines.push(line);
    }
  }
  return lines;
}

/**
 * One `KEY=value` line that `parseValues`, wrangler and Vite all read back unchanged. A
 * value with a space, `#` or a quote is single-quoted, since no reader expands inside
 * single quotes. A value no quoting can carry is refused rather than written wrong.
 */
export function formatLine(key: string, value: string): string {
  if (/^[^\s#"'`\\]*$/.test(value)) {
    return `${key}=${value}`;
  }
  if (!/['\n\r]/.test(value)) {
    return `${key}='${value}'`;
  }
  throw new Error(
    `${key} holds a single quote or a line break, which a .env line cannot carry. Change the value at its source.`
  );
}

export interface PlannedEnv {
  lines: string[];
  /** Keys the source holds that the example does not list for this service. */
  extraKeys: string[];
  /** Keys the example lists with no value and no blank-on-purpose marker. */
  missingKeys: string[];
}

/**
 * The lines one service's `.env` takes: the example's lines, comments included, with each
 * key set from `values`. A key in `keep` takes the existing value instead, and a key in
 * `omit` stays out. A key only the source holds is appended.
 */
export function planEnv(options: {
  example: string[];
  values: Map<string, string>;
  blankOnPurpose: Set<string>;
  keep: Map<string, string>;
  omit: readonly string[];
}): PlannedEnv {
  const { example, values, blankOnPurpose, keep, omit } = options;
  const listed = parseValues(example);
  const missingKeys: string[] = [];
  const valueOf = (key: string): string => {
    if (omit.includes(key)) {
      return "";
    }
    const value = keep.get(key) ?? values.get(key) ?? "";
    if (
      value === "" &&
      !blankOnPurpose.has(key) &&
      !missingKeys.includes(key)
    ) {
      missingKeys.push(key);
    }
    return value;
  };

  // `setKey` drops a repeated key's later lines, so each key is written exactly once.
  let lines = example;
  for (const key of listed.keys()) {
    lines = setKey(lines, key, "");
  }
  lines = lines.map((line) => {
    const key = keyOf(line);
    return key === undefined ? line : formatLine(key, valueOf(key));
  });

  const extraKeys = [...values.keys()].filter(
    (key) => !(listed.has(key) || omit.includes(key))
  );
  for (const key of extraKeys) {
    lines = [...lines, formatLine(key, values.get(key) ?? "")];
  }
  return { lines, extraKeys, missingKeys };
}
