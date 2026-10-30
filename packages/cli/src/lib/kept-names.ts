import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
} from "jsonc-parser";
import type { ManifestPatch } from "./manifest.js";
import type { RegistryPatch } from "./schema.js";

// An existing project keeps the account-scoped names already in its files (#197).
//
// A module that renders `{{PROJECT_NAME}}` names its Worker `<project>-api` and its queue
// `<project>-jobs`. A project that installed the module before the token existed holds `api`
// and `app-jobs`, and those names are live in a Cloudflare account. Writing the new names
// would deploy a second Worker beside the first and bind a fresh, empty queue, so `update`
// keeps what the project holds: the Worker `name` in a `wrangler.jsonc`, and a templated patch
// entry the project already recorded under its old value.

const PROJECT_TOKEN = "{{PROJECT_NAME}}";

/**
 * A `wrangler.jsonc` compared as if it held the Worker `name` the new render ships, and
 * written with the name the project already has. The same shape as `keepRootVersion`:
 * `compared` stands in for `mine`, `written` for `theirs`. Any other file passes through.
 */
export function keepWorkerName(
  target: string,
  mine: string | undefined,
  theirs: string
): { compared: string | undefined; written: string } {
  if (mine === undefined || !isWranglerConfig(target)) {
    return { compared: mine, written: theirs };
  }
  const kept = workerName(mine);
  const shipped = workerName(theirs);
  if (kept === undefined || shipped === undefined || kept === shipped) {
    return { compared: mine, written: theirs };
  }
  return {
    compared: withWorkerName(mine, shipped),
    written: withWorkerName(theirs, kept),
  };
}

/**
 * The patch `update` should plan for `raw`, a module's op before rendering: the op this
 * module already recorded when the project holds it under its own values, else `rendered`.
 *
 * A recorded op matches when it has the same file and kind and every value equals the raw
 * op's, except that a string carrying `{{PROJECT_NAME}}` matches any value in its place
 * (`{{PROJECT_NAME}}-jobs` matches `app-jobs`; `{{PROJECT_NAME}}-api` matches `api`). An op
 * with no token is never swapped, so an ordinary revision of a patch still ships.
 */
export function keepRecordedPatch(
  raw: RegistryPatch,
  rendered: RegistryPatch,
  recorded: readonly ManifestPatch[]
): RegistryPatch {
  if (!JSON.stringify(raw).includes(PROJECT_TOKEN)) {
    return rendered;
  }
  const kept = recorded.find(
    (entry) => entry.file === raw.file && matchesTemplate(raw, entry.patch)
  );
  return kept === undefined ? rendered : kept.patch;
}

function matchesTemplate(raw: unknown, held: unknown): boolean {
  if (typeof raw === "string") {
    return raw.includes(PROJECT_TOKEN)
      ? typeof held === "string" && templatePattern(raw).test(held)
      : raw === held;
  }
  if (Array.isArray(raw)) {
    return (
      Array.isArray(held) &&
      raw.length === held.length &&
      raw.every((item: unknown, index) => matchesTemplate(item, held[index]))
    );
  }
  if (raw !== null && typeof raw === "object") {
    if (held === null || typeof held !== "object" || Array.isArray(held)) {
      return false;
    }
    const rawKeys = Object.keys(raw);
    const heldRecord = held as Record<string, unknown>;
    return (
      rawKeys.length === Object.keys(heldRecord).length &&
      rawKeys.every((key) =>
        matchesTemplate((raw as Record<string, unknown>)[key], heldRecord[key])
      )
    );
  }
  return raw === held;
}

// `{{PROJECT_NAME}}-jobs` → /^(?:.+-)?jobs$/: the old names had a fixed prefix (`app-jobs`)
// or none at all (`api`), and either one is the project's own.
function templatePattern(raw: string): RegExp {
  const [head = "", ...rest] = raw
    .split(PROJECT_TOKEN)
    .map((part) => escapeRegExp(part));
  let body = head;
  for (const part of rest) {
    body += part.startsWith("-") ? `(?:.+-)?${part.slice(1)}` : `.+${part}`;
  }
  return new RegExp(`^${body}$`);
}

function escapeRegExp(text: string): string {
  return text.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);
}

function isWranglerConfig(target: string): boolean {
  return target === "wrangler.jsonc" || target.endsWith("/wrangler.jsonc");
}

function workerName(content: string): string | undefined {
  const root = parseTree(content);
  const node = root ? findNodeAtLocation(root, ["name"]) : undefined;
  return typeof node?.value === "string" ? node.value : undefined;
}

function withWorkerName(content: string, name: string): string {
  return applyEdits(content, modify(content, ["name"], name, {}));
}
