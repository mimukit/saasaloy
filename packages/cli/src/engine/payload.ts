import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { downloadTemplate } from "giget";
import type { BaseDeclaration } from "../lib/base.js";
import { listTemplateFiles, readBaseDeclaration } from "../lib/base.js";
import { RefusalError } from "../lib/exit.js";
import {
  joinModulePath,
  listFilesRelative,
  pathExists,
} from "../lib/fs-utils.js";
import {
  authToken,
  DEFAULT_SOURCE,
  DOWNLOAD_TIMEOUT_MS,
  LocalRegistrySource,
  OFFLINE_HINT,
  REGISTRY_ENV,
  withDeadline,
} from "../lib/registry.js";
import { resolveGraphs } from "../lib/resolve.js";
import { baseTemplateDir } from "../lib/scaffold.js";
import type { RegistryItem } from "../lib/schema.js";

// The payload of a render (plan 0116, "Where the payload lives"): the base template and
// every module of the resolved set, held in memory, so `render` reads no disk and no
// network. Three places supply it:
//
//   - a local `modules/` checkout (`SAASALOY_REGISTRY_DIR`), with the template bundled in
//     this CLI, for offline runs and tests. No cache: the checkout is already on disk.
//   - the user cache, `$XDG_CACHE_HOME/saasaloy/payload/<source>@<ref>/`, else
//     `~/.cache/saasaloy/payload/…`. `SAASALOY_CACHE_DIR` replaces the
//     `…/saasaloy/payload` part, for tests.
//   - the registry at one ref, which fills the cache. A later run reads the cache.
//
// A cache entry is a snapshot of the whole registry at the ref, `modules/` and `base/`,
// because the next run may ask for a different set at the same ref. Only the modules of
// the resolved set are read into memory.

/** Replaces `<cache home>/saasaloy/payload`, so a test never touches the user's cache. */
export const CACHE_DIR_ENV = "SAASALOY_CACHE_DIR";

/** The file that marks a cache entry as whole. A fetch writes it last. */
export const CACHE_COMPLETE = ".complete";

/** The source name of a payload read from `SAASALOY_REGISTRY_DIR`. */
export const LOCAL_SOURCE = "local";

/** Where the template lives in the saasaloy repo, at every ref. */
const BASE_TEMPLATE_PATH = "packages/cli/templates/base";

/** One module of the payload: its validated descriptor and every file it ships. */
export interface PayloadModule {
  name: string;
  item: RegistryItem;
  /** Module-relative POSIX path (`files/src/x.ts`) to raw content. Descriptor excluded. */
  files: ReadonlyMap<string, string>;
}

/** The base template of the payload, as shipped, before any rename or token. */
export interface PayloadBase {
  /** Template-relative POSIX source path (`_gitignore`) to raw content. Declaration excluded. */
  files: ReadonlyMap<string, string>;
  /** The template's `_saasaloy-base.json`. */
  declaration: BaseDeclaration;
}

export interface Payload {
  /** `owner/repo`, or `local` for a `SAASALOY_REGISTRY_DIR` checkout. */
  source: string;
  /** The ref the payload was read at, or `local`. */
  ref: string;
  base: PayloadBase;
  /** Every module of the resolved set, keyed by name. */
  modules: ReadonlyMap<string, PayloadModule>;
}

/** The two folders of one cache entry, as a fetcher fills them. */
export interface PayloadSnapshot {
  /** The registry's `modules/` folder: `<modulesDir>/<name>/registry-item.json`. */
  modulesDir: string;
  /** The base template folder: `<baseDir>/package.json`, `<baseDir>/_saasaloy-base.json`. */
  baseDir: string;
}

/** Fills an empty snapshot with the registry at `ref`. Injected by tests. */
export type PayloadFetcher = (
  snapshot: PayloadSnapshot,
  coordinate: { source: string; ref: string }
) => Promise<void>;

type Env = Readonly<Record<string, string | undefined>>;

/** The folder that holds every cache entry. */
export function payloadCacheRoot(env: Env = process.env): string {
  const override = env[CACHE_DIR_ENV];
  if (override) {
    return isAbsolute(override) ? override : resolve(override);
  }
  const xdg = env.XDG_CACHE_HOME;
  const home = xdg && isAbsolute(xdg) ? xdg : join(homedir(), ".cache");
  return join(home, "saasaloy", "payload");
}

// A source and a ref become path segments. `owner/repo` keeps its slash, as the plan
// spells the path, and nothing else may climb out of the cache root.
const SEGMENT = /^[\w.-]+$/;

function assertSegments(value: string, what: string): string[] {
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => !SEGMENT.test(segment) || segment === "." || segment === ".."
    )
  ) {
    throw new RefusalError(
      `Cannot cache a payload for ${what} "${value}": use letters, digits, ".", "_" and "-".`
    );
  }
  return segments;
}

/** The cache entry of one source at one ref: `<root>/<owner>/<repo>@<ref>`. */
export function payloadCacheDir(
  source: string,
  ref: string,
  env: Env = process.env
): string {
  if (ref.includes("/")) {
    throw new RefusalError(
      `Cannot cache a payload for ref "${ref}": a ref with "/" is not addressable.`
    );
  }
  assertSegments(ref, "ref");
  const segments = assertSegments(source, "source");
  const last = segments.pop() ?? "";
  return join(payloadCacheRoot(env), ...segments, `${last}@${ref}`);
}

/** The default fetcher: the GitHub tarball at `ref`, through giget, as `add` reads it. */
export const githubFetcher: PayloadFetcher = async (
  snapshot,
  { source, ref }
) => {
  const fetchFolder = async (path: string, dir: string): Promise<void> => {
    try {
      await withDeadline(
        downloadTemplate(`github:${source}/${path}#${ref}`, {
          auth: authToken(),
          dir,
          force: true,
        }),
        DOWNLOAD_TIMEOUT_MS,
        `Download of ${source}/${path}`
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not fetch ${path} from ${source}@${ref} — ${detail}. ${OFFLINE_HINT}`,
        { cause: error }
      );
    }
  };
  await fetchFolder("modules", snapshot.modulesDir);
  await fetchFolder(BASE_TEMPLATE_PATH, snapshot.baseDir);
};

/**
 * The snapshot of `source@ref` in the user cache, fetched first when the cache has none.
 * The fetch lands in a sibling temp folder and moves into place whole, so a run that dies
 * mid-fetch leaves no entry a later run would trust.
 */
export async function ensureCachedSnapshot(args: {
  source: string;
  ref: string;
  env?: Env;
  fetcher?: PayloadFetcher;
}): Promise<{ snapshot: PayloadSnapshot; fetched: boolean }> {
  const { source, ref, env = process.env, fetcher = githubFetcher } = args;
  const dir = payloadCacheDir(source, ref, env);
  const snapshotOf = (root: string): PayloadSnapshot => ({
    baseDir: join(root, "base"),
    modulesDir: join(root, "modules"),
  });
  if (await pathExists(join(dir, CACHE_COMPLETE))) {
    return { fetched: false, snapshot: snapshotOf(dir) };
  }
  const staging = `${dir}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
  try {
    const target = snapshotOf(staging);
    await mkdir(target.modulesDir, { recursive: true });
    await mkdir(target.baseDir, { recursive: true });
    await fetcher(target, { ref, source });
    await writeFile(
      join(staging, CACHE_COMPLETE),
      `${source}@${ref}\n`,
      "utf-8"
    );
    // A partial entry from a run that died before the marker is not trusted; replace it.
    await rm(dir, { force: true, recursive: true });
    await rename(staging, dir);
  } finally {
    await rm(staging, { force: true, recursive: true });
  }
  return { fetched: true, snapshot: snapshotOf(dir) };
}

/**
 * Read every module of the `dependsOn` closure of `requested` out of a `modules/` folder.
 * The set is the closure `lib/resolve.ts` walks; `render` orders it.
 */
export async function readPayloadModules(
  modulesDir: string,
  requested: readonly string[]
): Promise<Map<string, PayloadModule>> {
  const graph = await resolveGraphs(
    new LocalRegistrySource(modulesDir),
    requested
  );
  const modules = new Map<string, PayloadModule>();
  for (const name of graph.order.toSorted()) {
    const loaded = graph.modules.get(name);
    if (!loaded) {
      continue;
    }
    const files = new Map<string, string>();
    for (const rel of (await listFilesRelative(loaded.dir)).toSorted()) {
      if (rel === "registry-item.json") {
        continue;
      }
      files.set(rel, await readFile(joinModulePath(loaded.dir, rel), "utf-8"));
    }
    modules.set(name, { files, item: loaded.item, name });
  }
  return modules;
}

/** Read a base template folder: every file and its `_saasaloy-base.json`. */
export async function readPayloadBase(baseDir: string): Promise<PayloadBase> {
  const files = new Map<string, string>();
  for (const file of await listTemplateFiles(baseDir)) {
    files.set(file.from, await readFile(file.abs, "utf-8"));
  }
  return { declaration: await readBaseDeclaration(baseDir), files };
}

/**
 * Read the template and the resolved set of `requested` out of a snapshot on disk.
 */
export async function readPayload(args: {
  snapshot: PayloadSnapshot;
  requested: readonly string[];
  source: string;
  ref: string;
}): Promise<Payload> {
  const { snapshot, requested, source, ref } = args;
  return {
    base: await readPayloadBase(snapshot.baseDir),
    modules: await readPayloadModules(snapshot.modulesDir, requested),
    ref,
    source,
  };
}

export interface LoadPayloadArgs {
  /** The modules the owner asked for. Their `dependsOn` closure is loaded too. */
  requested: readonly string[];
  /** `owner/repo`; the default registry when absent. */
  source?: string;
  /** The ref to read: a tag or a commit SHA. Ignored for a local checkout. */
  ref: string;
  /** Read for `SAASALOY_REGISTRY_DIR`, `SAASALOY_CACHE_DIR` and `XDG_CACHE_HOME`. */
  env?: Env;
  /** Fills a cold cache entry. The GitHub tarball when absent. */
  fetcher?: PayloadFetcher;
}

/**
 * Load the payload a render needs: from `SAASALOY_REGISTRY_DIR` when it is set, else from
 * the user cache, which a fetch at `ref` fills when it is cold.
 */
export async function loadPayload(args: LoadPayloadArgs): Promise<Payload> {
  const env = args.env ?? process.env;
  const local = env[REGISTRY_ENV];
  if (local) {
    return readPayload({
      ref: LOCAL_SOURCE,
      requested: args.requested,
      snapshot: {
        baseDir: await baseTemplateDir(),
        modulesDir: isAbsolute(local) ? local : resolve(local),
      },
      source: LOCAL_SOURCE,
    });
  }
  const source = args.source ?? DEFAULT_SOURCE;
  const { snapshot } = await ensureCachedSnapshot({
    env,
    ref: args.ref,
    source,
    ...(args.fetcher === undefined ? {} : { fetcher: args.fetcher }),
  });
  return readPayload({
    ref: args.ref,
    requested: args.requested,
    snapshot,
    source,
  });
}
