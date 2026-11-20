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
import type { ModuleProvenance } from "../lib/registry.js";
import { loadConfig } from "../lib/saasaloy-config.js";
import type { LoadedConfig } from "../lib/saasaloy-config.js";
import { baseTemplateDir } from "../lib/scaffold.js";
import { readTestingMode } from "../lib/testing.js";
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
  const requested = [...spec.requested];
  if (isLocalRegistry(env)) {
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
  const tag = releaseTag(spec.version);
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
  if (defaultGroup.names.length > 0) {
    const snapshot = await snapshotOf(DEFAULT_SOURCE, tag);
    take(
      defaultGroup,
      await readPayloadModules(snapshot.modulesDir, defaultGroup.names)
    );
  }
  for (const group of groups.values()) {
    const snapshot = await snapshotOf(group.source, group.resolved);
    take(group, await readPayloadModules(snapshot.modulesDir, group.names));
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
    side: { options: spec.options, payload, requested },
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

/** Read a project's state and refuse a project the render engine did not write. */
export async function readProjectState(root: string): Promise<ProjectState> {
  const config = await loadConfig(root);
  const lock = await loadLock(root);
  const manifest = await loadManifestV2(root);
  if (lock.requested === undefined && Object.keys(lock.modules).length > 0) {
    throw new RefusalError(
      "saasaloy-lock.json has no `requested` list: an older engine wrote this project. Convert it to the render engine first."
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
    },
    requested,
    root,
    version: lock.base?.cliVersion,
  };
}

/**
 * The two refusals every `add`, `remove` and `update` run makes first (plan 0116): a
 * journal left by an unfinished run, and a file that still holds conflict markers.
 */
export async function assertReadyToRun(
  root: string,
  manifest: ManifestV2
): Promise<void> {
  await assertNoJournal(root);
  assertNoPendingMerges(await scanPendingMerges(root, manifest.pendingMerges));
}
