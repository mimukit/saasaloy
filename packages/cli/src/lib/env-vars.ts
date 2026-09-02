import { posix } from "node:path";
import { pathExists, resolveWithinRoot } from "./fs-utils.js";
import type { Manifest } from "./manifest.js";

// The routing half of `saasaloy env` (#50): which file does a declared variable belong
// in, and is it already set?
//
// Two facts settle every case. A `PUBLIC_*` variable is a build-time value the frontend
// bundles, so it belongs in that app's `.env`, which Astro and Vite read. Everything else
// is a secret the Worker reads at runtime, so it belongs in `.dev.vars`, which is
// wrangler's file and nothing else's. There is no `secret: true` flag on the descriptor
// and there is not going to be one: the prefix already says it, and a second way to say
// the same thing is a second way to disagree with it.
//
// *Which* app is the part that has to be inferred, because `envVars` is a flat
// `NAME → description` map with no app scope. The manifest knows: it records every file
// a module wrote, keyed by project-relative path, so the workspaces a module touched are
// recoverable from it. This file turns that into a target and says plainly when it
// cannot.

export const ENV_FILE = ".env";
export const DEV_VARS_FILE = ".dev.vars";

/** The literal, case-sensitive prefix that marks a build-time public value. */
export const PUBLIC_PREFIX = "PUBLIC_";

/** Where an app workspace lives by convention — the half of the repo that is not a lib. */
const APPS_DIR = "apps/";

const WRANGLER_CONFIGS = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

export function isPublicVar(name: string): boolean {
  return name.startsWith(PUBLIC_PREFIX);
}

/** `.env` for a public build-time value, `.dev.vars` for a secret. */
export function targetFileName(name: string): string {
  return isPublicVar(name) ? ENV_FILE : DEV_VARS_FILE;
}

/** One variable a module declares, carrying the description the prompt will read out. */
export interface Declaration {
  name: string;
  /** The declaring module's own wording — `env` never paraphrases it. */
  description: string;
  /** The module that declared it. */
  module: string;
  /** The local-dev value the descriptor supplies, if any. */
  devValue?: string;
}

export type Route =
  | { kind: "resolved"; workspace: string }
  | { kind: "ambiguous"; choices: string[] }
  | { kind: "unknown" };

export interface RouteArgs {
  name: string;
  /** Workspaces the declaring module wrote files into, project-relative. */
  candidates: string[];
  /** Of those, the ones holding a wrangler config. */
  wranglerWorkspaces: string[];
  /** The project's Worker workspace, from the `@api` alias. */
  apiWorkspace?: string;
  /** The base app's workspace — where a `PUBLIC_*` value lands when nothing else fits. */
  baseWorkspace?: string;
}

/** A route to a workspace, or nothing when the caller had no workspace to offer. */
function resolved(workspace: string | undefined): Route | undefined {
  return workspace ? { kind: "resolved", workspace } : undefined;
}

/**
 * The workspace whose `.env` or `.dev.vars` a variable belongs in.
 *
 * A `PUBLIC_*` value is bundled by exactly one frontend, so it looks for an app the
 * declaring module wrote into, falling back to the project's base app — `waitlist` ships
 * a component into `apps/web` and its `PUBLIC_API_URL` is what that component reads.
 *
 * A secret is read by whatever runs it, which for `.dev.vars` means a wrangler process.
 * So it prefers a candidate holding a wrangler config, breaks a tie towards the api
 * workspace, and falls back to the api workspace outright: `packages/email` declares
 * `PLUNK_API_KEY` and writes no app file at all, but the Worker importing that package
 * is what needs the key on disk.
 *
 * Pure, and it says `ambiguous` rather than guessing — the caller prompts.
 */
export function routeVariable(args: RouteArgs): Route {
  const { candidates, wranglerWorkspaces } = args;

  if (isPublicVar(args.name)) {
    const apps = candidates.filter(
      (w) => w.startsWith(APPS_DIR) && w !== args.apiWorkspace
    );
    if (apps.length === 1) {
      return { kind: "resolved", workspace: apps[0]! };
    }
    if (apps.length > 1) {
      return { choices: apps.toSorted(), kind: "ambiguous" };
    }
    return resolved(args.baseWorkspace) ?? fromCandidatesAlone(candidates);
  }

  const wrangler = candidates.filter((w) => wranglerWorkspaces.includes(w));
  if (wrangler.length === 1) {
    return { kind: "resolved", workspace: wrangler[0]! };
  }
  if (wrangler.length > 1) {
    return (
      (args.apiWorkspace && wrangler.includes(args.apiWorkspace)
        ? resolved(args.apiWorkspace)
        : undefined) ?? { choices: wrangler.toSorted(), kind: "ambiguous" }
    );
  }
  return resolved(args.apiWorkspace) ?? fromCandidatesAlone(candidates);
}

function fromCandidatesAlone(candidates: string[]): Route {
  if (candidates.length === 1) {
    return { kind: "resolved", workspace: candidates[0]! };
  }
  return candidates.length === 0
    ? { kind: "unknown" }
    : { choices: candidates.toSorted(), kind: "ambiguous" };
}

/**
 * The workspace roots this project has, derived from the alias map: an alias points at a
 * source directory (`packages/db/src`), and the workspace is the nearest ancestor that
 * carries a `package.json`. Walking up rather than assuming `dirname` keeps a nested
 * alias (`@ui` → `packages/ui/src/components`) pointing at the right workspace.
 *
 * The project root is deliberately excluded. It has a `package.json` too, and a variable
 * routed there would write `.dev.vars` beside `pnpm-workspace.yaml`, where no wrangler
 * process ever looks.
 */
export async function discoverWorkspaces(
  root: string,
  aliases: Record<string, string>
): Promise<string[]> {
  const found = new Set<string>();
  for (const value of Object.values(aliases)) {
    const workspace = await walkUpToWorkspace(root, value);
    if (workspace) {
      found.add(workspace);
    }
  }
  return [...found].toSorted();
}

async function walkUpToWorkspace(
  root: string,
  relPosixPath: string
): Promise<string | undefined> {
  let current = relPosixPath.replace(/\/+$/, "");
  while (current && current !== "." && current !== "/") {
    if (await pathExists(resolveWithinRoot(root, `${current}/package.json`))) {
      return current;
    }
    const parent = posix.dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
  return undefined;
}

/** Of `workspaces`, those holding a wrangler config — the ones that read `.dev.vars`. */
export async function findWranglerWorkspaces(
  root: string,
  workspaces: string[]
): Promise<string[]> {
  const found: string[] = [];
  for (const workspace of workspaces) {
    for (const config of WRANGLER_CONFIGS) {
      if (await pathExists(resolveWithinRoot(root, `${workspace}/${config}`))) {
        found.push(workspace);
        break;
      }
    }
  }
  return found;
}

/**
 * Which workspaces each module wrote into, read back from the manifest's `managed` map.
 * The key is the project-relative path the file landed on, so the longest workspace that
 * prefixes it is the workspace that owns it. A file under no known workspace (a root
 * `README`, an `infra/` scaffold with no alias) contributes nothing rather than a guess.
 */
export function workspacesByModule(
  manifest: Manifest,
  workspaces: string[]
): Map<string, string[]> {
  const byModule = new Map<string, Set<string>>();
  for (const [path, entry] of Object.entries(manifest.managed)) {
    const workspace = workspaceForPath(path, workspaces);
    if (!workspace) {
      continue;
    }
    const set = byModule.get(entry.module) ?? new Set<string>();
    set.add(workspace);
    byModule.set(entry.module, set);
  }
  return new Map(
    [...byModule].map(([module, set]) => [module, [...set].toSorted()])
  );
}

/** The longest workspace that contains `path`, or undefined when none does. */
export function workspaceForPath(
  path: string,
  workspaces: string[]
): string | undefined {
  let best: string | undefined;
  for (const workspace of workspaces) {
    if (
      path.startsWith(`${workspace}/`) &&
      (best === undefined || workspace.length > best.length)
    ) {
      best = workspace;
    }
  }
  return best;
}

/** The api workspace, re-exported so `env` reads one name for the Worker's root. */
export { apiWorkspace } from "./dev-vars.js";

/**
 * Is this variable already answered? A key present with an empty value is a placeholder
 * someone left behind, not an answer, so `env` offers to fill it. Anything else is a
 * value a person typed, and `env` never rewrites one.
 */
export function isSet(values: Record<string, string>, name: string): boolean {
  return (values[name] ?? "").trim() !== "";
}

/**
 * The file's new content, with `additions` appended.
 *
 * Every existing line survives byte for byte, comments and ordering included. This is a
 * file a person edits by hand, unlike `.dev.vars.example`, which is regenerated from the
 * descriptors — re-rendering it here would throw away their formatting to say the same
 * thing.
 */
export function appendVars(
  existing: string | undefined,
  additions: [string, string][]
): string {
  if (additions.length === 0) {
    return existing ?? "";
  }
  const appended = additions.map(([name, value]) => `${name}=${value}`);
  if (!existing || existing.trim() === "") {
    return `${appended.join("\n")}\n`;
  }
  const head = existing.endsWith("\n") ? existing : `${existing}\n`;
  return `${head}${appended.join("\n")}\n`;
}

/**
 * The production block: one `wrangler secret put` per secret, grouped by the workspace
 * you have to run it from.
 *
 * Printed, never run. Putting a secret into a live Cloudflare account is a deploy, and a
 * scaffolding tool that deploys on your behalf is a scaffolding tool you cannot trust
 * with a token. The lines are here to be copied.
 */
export function productionSecretCommands(
  targets: { name: string; workspace: string }[]
): string[] {
  const byWorkspace = new Map<string, string[]>();
  for (const { name, workspace } of targets) {
    if (isPublicVar(name)) {
      continue;
    }
    byWorkspace.set(workspace, [...(byWorkspace.get(workspace) ?? []), name]);
  }
  const lines: string[] = [];
  for (const workspace of [...byWorkspace.keys()].toSorted()) {
    lines.push(`# from ${workspace}`);
    for (const name of (byWorkspace.get(workspace) ?? []).toSorted()) {
      lines.push(`wrangler secret put ${name}`);
    }
  }
  return lines;
}
