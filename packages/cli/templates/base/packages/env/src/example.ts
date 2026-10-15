import { readFileSync } from "node:fs";
import path from "node:path";
import { splitLines } from "./dotenv.ts";
import { ENV_EXAMPLE, serviceNames } from "./services.ts";

// Reading `packages/env/.env.example`, the repository's one key list, and cutting it down
// to the lines one service takes.
//
// A `# @services api web` line sets which services own every key below it, until the next
// such line. Comments and blank lines travel with the key they sit above, so each
// service's `.env` still reads like the part of the example it came from.

const SECTION = /^\s*#\s*@services\b(.*)$/;

const KEY_LINE = /^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=/;

function readSection(line: string): string[] {
  const known = serviceNames();
  const names = (SECTION.exec(line)?.[1] ?? "")
    .split(/[\s,]+/)
    .filter((name) => name !== "");
  const unknown = names.filter((name) => !known.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `${ENV_EXAMPLE} has a "# @services" line naming ${unknown.join(", ")}, which is not a service. Use ${known.join(", ")}.`
    );
  }
  if (names.length === 0) {
    throw new Error(
      `${ENV_EXAMPLE} has a "# @services" line naming no service. Name at least one of ${known.join(", ")}.`
    );
  }
  return names;
}

/**
 * The example's lines that `service` takes: every key under a `# @services` section that
 * names it, with the comment block above each key.
 *
 * A key with no section above it throws. That is the one way a new key reaches no `.env`
 * at all, and a Worker that throws on the first request that needs it is a worse place to
 * find out.
 */
export function selectExample(lines: string[], service: string): string[] {
  const selected: string[] = [];
  let section: string[] | undefined;
  let pending: string[] = [];

  for (const line of lines) {
    if (SECTION.test(line)) {
      section = readSection(line);
      // One blank line between two sections' keys, so the written `.env` keeps the
      // example's spacing even though the banner comments above a directive are dropped.
      pending = [""];
      continue;
    }
    if (!KEY_LINE.test(line)) {
      pending.push(line);
      continue;
    }
    if (section === undefined) {
      throw new Error(
        `${ENV_EXAMPLE} sets ${line.split("=")[0]?.trim()} with no "# @services" line above it, so no service takes it. Add one naming ${serviceNames().join(", ")}.`
      );
    }
    if (section.includes(service)) {
      selected.push(...pending, line);
    }
    pending = [];
  }
  while (selected[0] === "") {
    selected.shift();
  }
  return selected;
}

/** `selectExample` over the file on disk. */
export function readExample(root: string, service: string): string[] {
  const text = readFileSync(path.join(root, ENV_EXAMPLE), "utf-8");
  return selectExample(splitLines(text), service);
}

/** Every key the example lists, whichever service takes it. */
export function exampleKeys(lines: string[]): string[] {
  return lines.flatMap((line) => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
    const key = match?.[1];
    return key === undefined ? [] : [key];
  });
}
