// Reads every api route a module ships and the agent statement each one carries (issue
// #348, plan 0110 "Exposure is a decision on every route"). `route-declarations.test.ts`
// holds the rules; this file only finds the routes and reads their `declare({...})` links.
//
// A route is one method link on the exported route chain of a route file, such as
// `.get("/", declare({...}), validateList, (c) => ...)`. The chain is the one a module's
// `chained-route` patch mounts, so the files and their mount paths come from the
// descriptors rather than from a folder scan: a helper file under `routes/` (a fixture, a
// shared gate) is not a route, and a new route file is seen the day its patch lands.
//
// It reads the files as text, like `table-names.test.ts`. A route file imports `hono`,
// `@repo/db` and the rest, which this repo's root `node_modules` does not carry, so the
// app cannot be loaded and walked here. The text reader is small because the route
// contract is strict: one `export const <name> = new Hono<...>()` expression, then a run
// of `.method(...)` links (see `modules/api/files/src/routes/health.ts`).
//
// Imports nothing but node: builtins. Node 24 strips the types, so there is no build step;
// `pnpm typecheck` checks it via tsconfig.scripts.json.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The chain methods that register a route. `use`, `route`, `onError` and `notFound` do not. */
export const ROUTE_METHODS = new Set([
  "all",
  "delete",
  "get",
  "on",
  "options",
  "patch",
  "post",
  "put",
]);

/** What one `declare({...})` link states, read from its text. */
export interface Statement {
  name: string | undefined;
  callable: boolean | undefined;
  readOnly: boolean | undefined;
  confirm: boolean | undefined;
  hasOutput: boolean;
  hasReason: boolean;
}

/** One method link on a route chain. */
export interface RouteLink {
  /** `get`, `post`, ... or `on` (its HTTP methods are in its first argument). */
  method: string;
  /** The path argument as written, quotes removed. */
  path: string;
  /** The `declare(...)` arguments in this link: zero means no statement. */
  statements: Statement[];
  /** 1-based line of the link, for the failure message. */
  line: number;
}

/** A route file as a module ships it, with the mount its patch gives it. */
export interface MountedChain {
  module: string;
  /** Repo-relative path of the shipped file. */
  file: string;
  /** The exported chain the patch imports, such as `notifications`. */
  exportName: string;
  /** The `chained-route` path, such as `/notifications`. */
  mount: string;
}

/**
 * The text with each comment replaced by spaces, so offsets and line numbers still match
 * and a `declare(` inside a comment counts for nothing. Strings, template literals and
 * regular expressions are kept as they are.
 */
export function stripComments(source: string): string {
  // UTF-16 units, not code points, so an index into `out` is an index into `source`.
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) {
      if (out[k] !== "\n") {
        out[k] = " ";
      }
    }
  };
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
    } else if (ch === "/" && startsRegex(source, i)) {
      i = skipRegex(source, i);
    } else {
      i++;
    }
  }
  return out.join("");
}

/** The index just past the string, template literal or regex that opens at `start`. */
function skipString(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && ch === "$" && source[i + 1] === "{") {
      i = matchClose(source, i + 1) + 1;
      continue;
    }
    if (ch === quote) {
      return i + 1;
    }
    i++;
  }
  return i;
}

/**
 * A `/` starts a regex when the code before it cannot end an expression. Enough for route
 * files, where a regex follows `(`, `,`, `=`, `:` or an operator.
 */
function startsRegex(source: string, at: number): boolean {
  let k = at - 1;
  while (k >= 0 && /\s/.test(source[k] ?? "")) {
    k--;
  }
  const prev = source[k] ?? "";
  if (prev === "" || "(,=:[!&|?{};+-*%<>~^".includes(prev)) {
    return true;
  }
  return /\breturn$/.test(source.slice(Math.max(0, k - 5), k + 1));
}

function skipRegex(source: string, start: number): number {
  let i = start + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "[") {
      inClass = true;
    } else if (ch === "]") {
      inClass = false;
    } else if (ch === "/" && !inClass) {
      i++;
      while (/[a-z]/i.test(source[i] ?? "")) {
        i++;
      }
      return i;
    } else if (ch === "\n") {
      return i;
    }
    i++;
  }
  return i;
}

const CLOSE: Record<string, string> = {
  "(": ")",
  "<": ">",
  "[": "]",
  "{": "}",
};

/**
 * The index of the bracket that closes the one at `open`. Strings and regexes are skipped.
 * For `<`, only angle brackets nest and `=>` is not a close, which is enough for a type
 * argument list such as `Hono<{ Bindings: AuthDbBindings }>`.
 */
export function matchClose(source: string, open: number): number {
  const opener = source[open] ?? "";
  const closer = CLOSE[opener];
  if (closer === undefined) {
    throw new Error(`no bracket at ${String(open)}`);
  }
  let depth = 0;
  let i = open;
  while (i < source.length) {
    const ch = source[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (opener !== "<" && ch === "/" && startsRegex(source, i)) {
      i = skipRegex(source, i);
      continue;
    }
    if (opener === "<") {
      if (ch === "<") {
        depth++;
      } else if (ch === ">" && source[i - 1] !== "=") {
        depth--;
      }
    } else if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
    }
    if (depth === 0) {
      return i;
    }
    i++;
  }
  throw new Error(`unclosed ${opener} at ${String(open)}`);
}

/** The top-level arguments of the call whose `(` is at `open`, trimmed. */
export function splitArgs(source: string, open: number): string[] {
  const close = matchClose(source, open);
  const args: string[] = [];
  let start = open + 1;
  let i = open + 1;
  while (i < close) {
    const ch = source[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(source, i);
      continue;
    }
    if (ch === "/" && startsRegex(source, i)) {
      i = skipRegex(source, i);
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      i = matchClose(source, i) + 1;
      continue;
    }
    if (ch === ",") {
      args.push(source.slice(start, i).trim());
      start = i + 1;
    }
    i++;
  }
  const last = source.slice(start, close).trim();
  if (last !== "") {
    args.push(last);
  }
  return args;
}

function lineOf(source: string, at: number): number {
  return source.slice(0, at).split("\n").length;
}

function literal(arg: string | undefined): string {
  return (arg ?? "").replaceAll(/^["'`]|["'`]$/g, "");
}

function flag(text: string, key: string): boolean | undefined {
  const found = new RegExp(`\\b${key}\\s*:\\s*(true|false)\\b`).exec(text);
  return found ? found[1] === "true" : undefined;
}

/** What a `declare(...)` argument states. Read by key, so the order of keys is free. */
export function readStatement(arg: string): Statement {
  return {
    callable: flag(arg, "callable"),
    confirm: flag(arg, "confirm"),
    hasOutput: /\boutput\s*:/.test(arg),
    hasReason: /\breason\s*:\s*["'`]/.test(arg),
    name: /\bname\s*:\s*["'`]([^"'`]*)["'`]/.exec(arg)?.[1],
    readOnly: flag(arg, "readOnly"),
  };
}

/**
 * Every method link on the chain exported as `exportName`. Throws when the file has no
 * such chain, because a patch that imports a missing name is a broken module, not a route
 * with no statement.
 */
export function routeLinks(source: string, exportName: string): RouteLink[] {
  const code = stripComments(source);
  const head = new RegExp(
    `export const ${exportName}\\b[^=]*=\\s*new Hono\\b`
  ).exec(code);
  if (!head) {
    throw new Error(`no \`export const ${exportName} = new Hono\` chain`);
  }
  let i = head.index + head[0].length;
  const skipSpace = () => {
    while (/\s/.test(code[i] ?? "")) {
      i++;
    }
  };
  skipSpace();
  if (code[i] === "<") {
    i = matchClose(code, i) + 1;
    skipSpace();
  }
  if (code[i] !== "(") {
    throw new Error(`\`${exportName}\` is not a \`new Hono(...)\` call`);
  }
  i = matchClose(code, i) + 1;
  const links: RouteLink[] = [];
  for (;;) {
    skipSpace();
    if (code[i] !== ".") {
      return links;
    }
    i++;
    const name = /^[A-Za-z_$][\w$]*/.exec(code.slice(i))?.[0] ?? "";
    const at = i;
    i += name.length;
    skipSpace();
    if (code[i] !== "(") {
      return links;
    }
    const args = splitArgs(code, i);
    i = matchClose(code, i) + 1;
    if (!ROUTE_METHODS.has(name)) {
      continue;
    }
    links.push({
      line: lineOf(code, at),
      method: name,
      path: literal(name === "on" ? args[1] : args[0]),
      statements: args
        .filter((arg) => /^declare\s*\(/.test(arg))
        .map(readStatement),
    });
  }
}

interface Descriptor {
  name: string;
  patches?: {
    kind?: string;
    path?: string;
    import?: { name: string; from: string };
  }[];
  files?: { path: string; target: string }[];
  scaffolds?: { files?: { path: string; target: string }[] }[];
}

/**
 * Every route chain a module mounts through a `chained-route` patch, plus the base `api`
 * module's own `/health`, which `modules/api/files/src/index.ts` mounts by hand.
 */
export function mountedChains(root: string): MountedChain[] {
  const modules = join(root, "modules");
  const chains: MountedChain[] = [
    {
      exportName: "health",
      file: "modules/api/files/src/routes/health.ts",
      module: "api",
      mount: "/health",
    },
  ];
  for (const name of readdirSync(modules).toSorted()) {
    let descriptor: Descriptor;
    try {
      descriptor = JSON.parse(
        readFileSync(join(modules, name, "registry-item.json"), "utf-8")
      ) as Descriptor;
    } catch {
      continue;
    }
    const files = [
      ...(descriptor.files ?? []),
      ...(descriptor.scaffolds ?? []).flatMap((s) => s.files ?? []),
    ];
    for (const patch of descriptor.patches ?? []) {
      if (patch.kind !== "chained-route" || !patch.import || !patch.path) {
        continue;
      }
      const target = `@api/${patch.import.from.replace(/^\.\//, "")}.ts`;
      const file = files.find((f) => f.target === target);
      if (!file) {
        throw new Error(
          `${name}: its chained-route patch imports ${patch.import.from}, and no file targets ${target}`
        );
      }
      chains.push({
        exportName: patch.import.name,
        file: `modules/${name}/${file.path}`,
        module: name,
        mount: patch.path,
      });
    }
  }
  return chains;
}

/** The full path a link serves: the mount, then the link's own path. */
export function fullPath(mount: string, path: string): string {
  const joined = `${mount}/${path}`.replaceAll(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}
