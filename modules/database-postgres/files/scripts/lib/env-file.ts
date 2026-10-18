import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The `apps/api/.env` reader and writer the db scripts share. It is a dotenv file that
// wrangler loads and `pnpm env:setup` regenerates, so this keeps to the subset it needs:
// `KEY=value` lines and comment lines.
//
// Nothing here parses quotes or expands a variable. The one value these scripts write is
// `DATABASE_URL`, and every other line is carried through byte for byte, so a value this
// file does not understand survives a rewrite untouched.

export interface EnvFile {
  /** Absolute path of the file, whether or not it exists. */
  path: string;
  /** True when the file is on disk. */
  exists: boolean;
  /** Every line, in order. */
  lines: string[];
  /** `KEY=value` pairs read off `lines`. */
  values: Map<string, string>;
}

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Read the file at `path`. A file that is not there reads as an empty one. */
export function readEnvFile(path: string): EnvFile {
  let raw: string | undefined;
  try {
    raw = readFileSync(path, "utf-8");
  } catch {
    return { path, exists: false, lines: [], values: new Map() };
  }

  const lines = raw.split("\n");
  // A final newline is not a line, so a rewrite does not grow one blank line per run.
  if (lines.at(-1) === "") {
    lines.pop();
  }
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    if (match?.[1]) {
      values.set(match[1], (match[2] ?? "").trim());
    }
  }
  return { path, exists: true, lines, values };
}

/** `lines` with `key` set to `value`, in place when the key is there and appended when it is not. */
export function setKey(lines: string[], key: string, value: string): string[] {
  const next = [...lines];
  const at = next.findIndex((line) => KEY_LINE.exec(line)?.[1] === key);
  if (at === -1) {
    next.push(`${key}=${value}`);
    return next;
  }
  next[at] = `${key}=${value}`;
  return next;
}

/** `lines` without the `key` line. */
export function removeKey(lines: string[], key: string): string[] {
  return lines.filter((line) => KEY_LINE.exec(line)?.[1] !== key);
}

/** Write `lines`, minus trailing blank ones, with one final newline. */
export function writeEnvFile(path: string, lines: string[]): void {
  const body = [...lines];
  while (body.length > 0 && body.at(-1)?.trim() === "") {
    body.pop();
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${body.join("\n")}\n`, "utf-8");
}
