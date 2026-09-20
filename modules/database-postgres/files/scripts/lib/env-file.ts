import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

// The `apps/api/.dev.vars` reader and writer the db scripts share. It is a dotenv file that
// wrangler loads, so this keeps to the subset it needs: `KEY=value` lines, comment lines,
// and the run of comment lines at the very top that holds the `db:setup` state block.
//
// Nothing here parses quotes or expands a variable. The one value these scripts write is
// `DATABASE_URL`, and every other line is carried through byte for byte, so a value this
// file does not understand survives a rewrite untouched.

export interface EnvFile {
  /** Absolute path of the file, whether or not it exists. */
  path: string;
  /** True when the file is on disk. */
  exists: boolean;
  /** The comment lines at the top, before the first blank or `KEY=` line. */
  blockLines: string[];
  /** Every line after the block, in order. */
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
    return {
      path,
      exists: false,
      blockLines: [],
      lines: [],
      values: new Map(),
    };
  }

  const all = raw.split("\n");
  const blockLines: string[] = [];
  let index = 0;
  while (index < all.length && all[index]?.startsWith("#")) {
    blockLines.push(all[index] ?? "");
    index += 1;
  }
  // A trailing blank line belongs to the block, not to the body, so a rewrite does not
  // grow one blank line per run.
  if (all[index]?.trim() === "") {
    index += 1;
  }

  const lines = all.slice(index);
  const values = new Map<string, string>();
  for (const line of lines) {
    const match = KEY_LINE.exec(line);
    if (match?.[1]) {
      values.set(match[1], (match[2] ?? "").trim());
    }
  }
  return { path, exists: true, blockLines, lines, values };
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

/** Write the block (blank-line separated when it has content) then the body. */
export function writeEnvFile(
  path: string,
  blockLines: string[],
  lines: string[]
): void {
  const body = [...lines];
  while (body.length > 0 && body.at(-1)?.trim() === "") {
    body.pop();
  }
  const parts = blockLines.length > 0 ? [...blockLines, "", ...body] : body;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${parts.join("\n")}\n`, "utf-8");
}
