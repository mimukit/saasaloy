import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { formatEnv, parseValues, splitLines } from "./dotenv.ts";

// One `.env` on disk: its lines and the values those lines set.

export interface EnvFile {
  path: string;
  exists: boolean;
  lines: string[];
  values: Map<string, string>;
}

export function readEnvFile(file: string): EnvFile {
  const exists = existsSync(file);
  const lines = splitLines(exists ? readFileSync(file, "utf-8") : "");
  return { path: file, exists, lines, values: parseValues(lines) };
}

export function writeEnvFile(file: string, lines: string[]): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, formatEnv(lines));
}

/**
 * Delete a leftover `.dev.vars` beside a `.env`, and say whether there was one.
 *
 * Wrangler loads `.env` only while no `.dev.vars` sits next to it, so a file left over
 * from before this capability hides every value `env:setup` writes. That is a silent
 * failure, which is why the migration deletes rather than warns.
 */
export function removeLegacyDevVars(file: string): boolean {
  if (!existsSync(file)) {
    return false;
  }
  rmSync(file);
  return true;
}

/** The values of a leftover `.dev.vars`, so `env:setup` can carry them into `.env`. */
export function readLegacyDevVars(file: string): Map<string, string> {
  return existsSync(file)
    ? readEnvFile(file).values
    : new Map<string, string>();
}
