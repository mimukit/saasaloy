import { isAbsolute, resolve } from "node:path";
import { RefusalError } from "../lib/exit.js";
import { loadLock } from "../lib/lock.js";
import type { Lockfile } from "../lib/lock.js";
import { resolveProjectName } from "../lib/project-name.js";
import {
  DEFAULT_SOURCE,
  missingReleaseTagMessage,
  REGISTRY_ENV,
  releaseTag,
} from "../lib/registry.js";
import type { LoadOptions, ModuleProvenance } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import type { LoadedConfig } from "../lib/saasaloy-config.js";
import { readTestingMode } from "../lib/testing.js";
import { readTheme } from "../lib/theme.js";
import { readLanding } from "../lib/recipes.js";
import { baseTemplateDir, templateVars } from "../lib/scaffold.js";
import type { RenderOptions } from "./render.js";
import { UNKNOWN_VERSION } from "../version.js";
import {
  assertNoJournal,
  assertNoPendingMerges,
  scanPendingMerges,
} from "./apply.js";
import type { ApplySide } from "./apply.js";
import { loadManifestV2 } from "./manifest.js";
import type { ManifestV2 } from "./manifest.js";
import {
  ensureCachedSnapshot,
  LOCAL_SOURCE,
  readPayloadBase,
  readPayloadModules,
} from "./payload.js";
import { readDirNames } from "../lib/fs-utils.js";
import type { Payload, PayloadFetcher, PayloadModule } from "./payload.js";

// A project as the render engine reads it (plan 0116, Phase 4): the lock's `requested`
// list and each module's source, the manifest version 2, and the render options from
// `saasaloy.json`. And the two sides of an apply, each loaded at one release.
//
// The default registry moves as one: every default module of a side renders at that
// side's release tag, and the base template with it (ADR 0062). At the running CLI's own
// release the template is the one bundled in this CLI, so `init` reads no network. A
// third-party module keeps its own source and the commit its lock entry resolved.

type Env = Readonly<Record<string, string | undefined>>;

/** Where one requested module comes from, when it is not the default registry. */
export interface ModuleCoordinate {
  /** `owner/repo`. */
  source: string;
  /** The ref the owner named, or the default branch: what `update` moves to the tip of. */
  ref: string;
  /** The commit the payload is read at. */
  resolved: string;
}

export interface SideSpec {
  /** The modules the owner asked for. */
  requested: readonly string[];
  /** Third-party modules by name. A name absent here reads the default registry. */
  coordinates: ReadonlyMap<string, ModuleCoordinate>;
  /** The release the default registry and the base template are read at. */
  version: string;
  options: RenderOptions;
  /**
   * Keep only the requested modules the payload at `version` can load, with their
   * prerequisites, instead of refusing an unknown one. The base of an old project's merge
   * is a render at an older release, which may predate a module the project installed
   * later (plan 0116, Phase 5).
   */
  partial?: boolean;
}

export interface LoadedSide {
  side: ApplySide;
  /** The lock entry of each module in the payload. */
  provenance: (module: string) => ModuleProvenance;
}

export interface LoadSideContext {
  /** The running CLI's version. */
  cliVersion: string;
  env?: Env;
  fetcher?: PayloadFetcher;
}

/** True when `SAASALOY_REGISTRY_DIR` points the run at a local `modules/` checkout. */
export function isLocalRegistry(env: Env = process.env): boolean {
  return (env[REGISTRY_ENV] ?? "") !== "";
}

const COMMIT_SHA = /^[0-9a-f]{40}$/;

/**
 * The registry ref a side's version reads. A release reads its tag (ADR 0062). A commit
 * SHA reads that commit: a version 1 project may hold a file whose bytes only a commit
 * between two releases shipped, and its converted record names that commit.
 */
export function refOfVersion(version: string): string {
  return COMMIT_SHA.test(version) ? version : releaseTag(version);
}

/**
 * The render options of a side at `version`: `{{CLI_VERSION}}` is the CLI that wrote the
 * render, so the base of a merge has the bytes that release wrote.
 */
function optionsAt(options: RenderOptions, version: string): RenderOptions {
  if (options.vars !== undefined || COMMIT_SHA.test(version)) {
    return options;
  }
  return {
    ...options,
    vars: { ...templateVars(options.projectName), CLI_VERSION: version },
  };
}

/**
 * The names among `requested` that `modulesDir` can load with their whole `dependsOn`
 * closure. A module the folder lacks, or whose descriptor an older release wrote in a
 * shape this CLI refuses, is left out.
 */
async function loadableModules(
  modulesDir: string,
  requested: readonly string[],
  options: LoadOptions
): Promise<string[]> {
  const present = new Set(await readDirNames(modulesDir));
  const kept: string[] = [];
  for (const name of requested) {
    if (!present.has(name)) {
      continue;
    }
    try {
      await readPayloadModules(modulesDir, [name], options);
      kept.push(name);
    } catch {
      // Not loadable at this ref: the side renders without it.
    }
  }
  return kept;
}

function localModulesDir(env: Env): string {
  const dir = env[REGISTRY_ENV] ?? "";
  return isAbsolute(dir) ? dir : resolve(dir);
}

/**
 * Load the payload of one side. With `SAASALOY_REGISTRY_DIR`, every module comes from the
 * checkout and the template from this CLI. Otherwise the user cache serves each
 * coordinate, and a cold entry is fetched.
 */
export async function loadSide(
  spec: SideSpec,
  context: LoadSideContext
): Promise<LoadedSide> {
  const env = context.env ?? process.env;
  let requested = [...spec.requested];
  if (isLocalRegistry(env)) {
    // A local checkout is the registry this run develops against, at no older ref: its
    // descriptors are read strictly, whatever version the side names.
    if (spec.partial === true) {
      requested = await loadableModules(localModulesDir(env), requested, {});
    }
    const modules = await readPayloadModules(localModulesDir(env), requested);
    const payload: Payload = {
      base: await readPayloadBase(await baseTemplateDir()),
      modules,
      ref: LOCAL_SOURCE,
      source: LOCAL_SOURCE,
    };
    return {
      provenance: () => ({
        ref: LOCAL_SOURCE,
        resolved: LOCAL_SOURCE,
        source: LOCAL_SOURCE,
      }),
      side: { options: spec.options, payload, requested },
    };
  }

  if (spec.version === UNKNOWN_VERSION) {
    throw new RefusalError(missingReleaseTagMessage(spec.version));
  }
  const tag = refOfVersion(spec.version);
  // A side at any release but the running CLI's reads a registry this CLI did not ship
  // with, so its descriptors may carry a key the schema has since retired (plan 0117).
  // Every module of the side, a third-party one at its pinned commit included, loads with
  // that key translated. The running CLI's own side stays strict.
  const load: LoadOptions = { atOldRef: spec.version !== context.cliVersion };
  const snapshotOf = async (source: string, ref: string) =>
    (
      await ensureCachedSnapshot({
        env,
        ref,
        source,
        ...(context.fetcher === undefined ? {} : { fetcher: context.fetcher }),
      })
    ).snapshot;

  // One group per source and commit; the default registry is one group at the tag.
  interface Group {
    source: string;
    ref: string;
    resolved: string;
    names: string[];
  }
  const groups = new Map<string, Group>();
  const defaultGroup: Group = {
    names: [],
    ref: tag,
    resolved: tag,
    source: DEFAULT_SOURCE,
  };
  for (const name of requested) {
    const coordinate = spec.coordinates.get(name);
    if (coordinate === undefined) {
      defaultGroup.names.push(name);
      continue;
    }
    const key = `${coordinate.source}@${coordinate.resolved}`;
    const group = groups.get(key) ?? { ...coordinate, names: [] };
    group.names.push(name);
    groups.set(key, group);
  }

  const modules = new Map<string, PayloadModule>();
  const owner = new Map<string, Group>();
  const take = (group: Group, loaded: Map<string, PayloadModule>): void => {
    for (const [name, mod] of loaded) {
      const held = owner.get(name);
      if (held !== undefined && held !== group) {
        throw new RefusalError(
          `Module "${name}" comes from both ${held.source}@${held.ref} and ${group.source}@${group.ref}. Remove one of them first.`
        );
      }
      owner.set(name, group);
      modules.set(name, mod);
    }
  };
  if (spec.partial === true && defaultGroup.names.length > 0) {
    const snapshot = await snapshotOf(DEFAULT_SOURCE, tag);
    const kept = new Set(
      await loadableModules(snapshot.modulesDir, defaultGroup.names, load)
    );
    defaultGroup.names = defaultGroup.names.filter((name) => kept.has(name));
    requested = requested.filter(
      (name) => spec.coordinates.has(name) || kept.has(name)
    );
  }
  if (defaultGroup.names.length > 0) {
    const snapshot = await snapshotOf(DEFAULT_SOURCE, tag);
    take(
      defaultGroup,
      await readPayloadModules(snapshot.modulesDir, defaultGroup.names, load)
    );
  }
  for (const group of groups.values()) {
    const snapshot = await snapshotOf(group.source, group.resolved);
    take(
      group,
      await readPayloadModules(snapshot.modulesDir, group.names, load)
    );
  }

  const base =
    spec.version === context.cliVersion
      ? await readPayloadBase(await baseTemplateDir())
      : await readPayloadBase((await snapshotOf(DEFAULT_SOURCE, tag)).baseDir);
  const payload: Payload = { base, modules, ref: tag, source: DEFAULT_SOURCE };
  return {
    provenance: (module) => {
      const group = owner.get(module) ?? defaultGroup;
      return { ref: group.ref, resolved: group.resolved, source: group.source };
    },
    side: {
      options: optionsAt(spec.options, spec.version),
      payload,
      requested,
    },
  };
}

/** A project on the render engine, read before a run. */
export interface ProjectState {
  root: string;
  config: LoadedConfig;
  lock: Lockfile;
  manifest: ManifestV2;
  /** The lock's `requested` list. */
  requested: string[];
  /** Every module of the resolved set the lock records. */
  installed: string[];
  /** Third-party modules among `requested`, from their lock entries. */
  coordinates: Map<string, ModuleCoordinate>;
  /** The release the project was last rendered at: the lock's base `cliVersion`. */
  version: string | undefined;
  options: RenderOptions;
}

/** A lock and a manifest held in memory in place of the files: a conversion's result. */
export interface StateOverride {
  lock: Lockfile;
  manifest: ManifestV2;
}

/**
 * Read a project's state and refuse a project the render engine did not write. With
 * `override`, the lock and the manifest come from memory: `update` converts a version 1
 * project there, and writes the result only with the run.
 */
export async function readProjectState(
  root: string,
  override?: StateOverride
): Promise<ProjectState> {
  const config = await loadConfig(root);
  const lock = override?.lock ?? (await loadLock(root));
  const manifest = override?.manifest ?? (await loadManifestV2(root));
  if (lock.requested === undefined && Object.keys(lock.modules).length > 0) {
    throw new RefusalError(
      "saasaloy-lock.json has no `requested` list: an older engine wrote this project. Run `saasaloy update`, which converts it to the render engine first."
    );
  }
  const requested = [...(lock.requested ?? [])];
  const coordinates = new Map<string, ModuleCoordinate>();
  for (const name of requested) {
    const entry = lock.modules[name];
    if (
      entry !== undefined &&
      entry.source !== DEFAULT_SOURCE &&
      entry.source !== LOCAL_SOURCE
    ) {
      coordinates.set(name, {
        ref: entry.ref,
        resolved: entry.resolved,
        source: entry.source,
      });
    }
  }
  const project = await resolveProjectName(root, config);
  return {
    config,
    coordinates,
    installed: Object.keys(lock.modules),
    lock,
    manifest,
    options: {
      projectName: project.name,
      testingMode: readTestingMode(config),
      theme: readTheme(config),
      ...readLanding(config),
    },
    requested,
    root,
    version: lock.base?.cliVersion,
  };
}

/**
 * The base sides of an update, by version: the render of the project's set at each
 * release a record names other than `previous`, so a project whose files different
 * releases wrote finds the base of each file by its hash (research 0013, "The base of a
 * file"). Each side keeps only the modules its release can load. A release that cannot
 * be loaded is left out, with a warning: its files merge with two-way markers.
 */
export async function loadBaseSides(
  state: Pick<
    ProjectState,
    "manifest" | "requested" | "coordinates" | "options"
  >,
  previous: string,
  context: LoadSideContext
): Promise<{ sides: Map<string, ApplySide[]>; warnings: string[] }> {
  const versions = new Set(
    Object.values(state.manifest.files).map((record) => record.version)
  );
  const sides = new Map<string, ApplySide[]>();
  const warnings: string[] = [];
  for (const version of [...versions].toSorted()) {
    if (version === previous) {
      continue;
    }
    try {
      const { side } = await loadSide(
        {
          coordinates: state.coordinates,
          options: state.options,
          partial: true,
          requested: state.requested,
          version,
        },
        context
      );
      sides.set(version, [side]);
    } catch (error) {
      warnings.push(
        `Could not load saasaloy ${version}, the base of the files it wrote: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  return { sides, warnings };
}

/**
 * The two refusals every `add`, `remove` and `update` run makes first (plan 0116): a
 * journal left by an unfinished run, and a file that still holds conflict markers. It
 * runs before `readProjectState`, because a pending merge may be `saasaloy.json` itself,
 * and a file with markers does not parse. With no `manifest` it reads the project's.
 */
export async function assertReadyToRun(
  root: string,
  manifest?: ManifestV2
): Promise<void> {
  await assertNoJournal(root);
  const { pendingMerges } = manifest ?? (await loadManifestV2(root));
  assertNoPendingMerges(await scanPendingMerges(root, pendingMerges));
}
