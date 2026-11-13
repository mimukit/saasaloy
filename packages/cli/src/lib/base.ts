import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { downloadTemplate } from "giget";
import {
  hashContent,
  pathExists,
  readIfPresent,
  resolveWithinRoot,
} from "./fs-utils.js";
import type { LockBase, Lockfile } from "./lock.js";
import { saveLock } from "./lock.js";
import type { ManagedEntry, Manifest } from "./manifest.js";
import {
  authToken,
  DEFAULT_OWNER,
  DEFAULT_REPO,
  DOWNLOAD_TIMEOUT_MS,
  withDeadline,
} from "./registry.js";
import { parseVersion } from "./semver.js";
import {
  recordManagedFile,
  saveManifest,
  untrackManagedFile,
} from "./manifest.js";
import {
  BASE_DECLARATION,
  baseTemplateDir,
  copyTemplate,
  renderedName,
  templateVars,
} from "./scaffold.js";
import type { WrittenFile } from "./scaffold.js";
import type { TestingMode } from "./testing.js";
import type { LoadedModule } from "./registry.js";
import type { ModuleComparison, ModuleUpdateInput } from "./updater.js";

export { BASE_DECLARATION } from "./scaffold.js";

// The base template's provenance (#120, ADR 0032). `saasaloy init` copies the template
// bundled inside the CLI package, and until this file nothing recorded what it copied:
// no manifest entry, no lock entry, no version stamp (ADR 0022's "one-time gift"). So
// `outdated`, `update` and `doctor` could say nothing about the largest body of code the
// tool generates. The base now records like a module — one `managed` entry per rendered
// file under the reserved module name `base` — plus a lock record keyed by CLI version
// and template hash, because the base ships with the CLI rather than in a registry.
//
// Three rules keep the record honest:
//   - hashes are of *rendered* bytes: `{{PROJECT_NAME}}` is substituted at copy time, and
//     hashing the template source would mark every substituted file drifted forever;
//   - `templateHash` is over the template *as shipped*, so two CLI builds carrying an
//     identical template compare equal and a republished template is still detected;
//   - seed files (`_saasaloy-base.json`'s `seedFiles`) are recorded but never updated —
//     the owner is meant to rewrite them.

/** The template's own `saasaloy.json`, read for the aliases it declares (#312). */
const TEMPLATE_CONFIG = "saasaloy.json";

/** The reserved module name base files record under. Never in `saasaloy.json`'s `installed`. */
export const BASE_MODULE = "base";

/** `saasaloy.json`'s `base` value — the one base app the template ships. */
export const DEFAULT_BASE_NAME = "web";

/** The lock's record of the base — re-exported under the name the plan uses. */
export type BaseRecord = LockBase;

/**
 * Point the base snapshot at a local folder of `<version>/` template copies (#312), so a
 * test, or an owner with no network, reads `$DIR/0.5.0/` in place of the `v0.5.0` tag. A
 * version with no folder there has no snapshot, and the base update takes the two-way path.
 */
export const BASE_SNAPSHOT_ENV = "SAASALOY_BASE_SNAPSHOT_DIR";

/** Where the template lives in the saasaloy repo, at every release tag. */
const BASE_TEMPLATE_PATH = "packages/cli/templates/base";

/** Why the base's merge plan is two-way, stamped on its section header (#312). */
export const noSnapshotReason = {
  /** The version names no release: `0.0.0`, a dev build, or no version at all. */
  notARelease: (version: string): string =>
    `the base was recorded at CLI ${version === "" ? "(no version)" : version}, which is not a release, so its template can't be fetched`,
  /** `SAASALOY_BASE_SNAPSHOT_DIR` is set and holds no folder for the version. */
  notInSnapshotDir: (version: string): string =>
    `${BASE_SNAPSHOT_ENV} holds no template for ${version}`,
  /** The tag download failed: offline, a timeout, a 404, a rate limit. */
  fetchFailed: (version: string, detail: string): string =>
    `the template at v${version} could not be fetched from ${DEFAULT_OWNER}/${DEFAULT_REPO} (${detail}; set ${BASE_SNAPSHOT_ENV} to work offline)`,
  /** The fetched template is not the one the lock's `templateHash` records. */
  hashMismatch: (version: string): string =>
    `the template at v${version} is not the one this project recorded`,
  /** The old template would not render with the running CLI. */
  renderFailed: (version: string, detail: string): string =>
    `the template at v${version} could not be rendered (${detail})`,
};

/** The one intent line a drifted base file carries, for the agent reading the plan. */
export const BASE_INTENT =
  "the base template changed; keep local edits, take the upstream change";

export interface BaseDeclaration {
  /**
   * Project-relative POSIX paths the owner is meant to rewrite; recorded, never updated.
   * Includes `retiredSeedFiles`, so every caller that skips a seed skips those too.
   */
  seedFiles: string[];
  /**
   * Seed paths the template no longer ships, because the seed moved. A project made
   * before the move still records the old path, and without this entry `update` would
   * plan it as a removal and delete a file the owner may never have touched — the root
   * `DESIGN.md` that moved to `apps/web/DESIGN.md` is the case. Folded into `seedFiles`.
   */
  retiredSeedFiles: string[];
  /**
   * Globs for files the template ships once and the project owns afterwards — the blocks,
   * the components, `globals.css`, the favicon. The template's own `AGENTS.md` has always
   * said so; until this list nothing enforced it, and an update overwrote them. An owned
   * file that is absent is still created, or offered as deleted when it is tracked (#312).
   * An owned file that exists goes to
   * the merge plan, never to a write. `**` matches any number of segments, `*` one.
   */
  ownedFiles: string[];
}

/**
 * A `*`/`**` glob compiled against project-relative POSIX targets. Deliberately small:
 * the declaration is ours, so the patterns are the handful this file documents rather
 * than arbitrary user input.
 */
export function compileGlob(pattern: string): RegExp {
  const source = pattern
    .split("/")
    .map((segment) =>
      segment === "**"
        ? "[^\0]*"
        : segment
            .replaceAll(/[.+^${}()|[\]\\]/g, String.raw`\$&`)
            .replaceAll("*", "[^/]*")
    )
    .join("/")
    .replaceAll("[^\0]*/", "(?:[^\0]*/)?");
  return new RegExp(`^${source}$`);
}

/** The predicate `update` asks whether a target is the project's rather than the template's. */
export function ownedMatcher(
  declaration: BaseDeclaration
): (target: string) => boolean {
  const patterns = declaration.ownedFiles.map(compileGlob);
  return (target: string) => patterns.some((re) => re.test(target));
}

/** One file the template ships, before and after the `_` → `.` rename. */
export interface TemplateFile {
  /** Template-relative POSIX source path — the manifest's `from`. */
  from: string;
  /** Project-relative POSIX path once rendered — the manifest key. */
  target: string;
  /** Absolute path of the source file inside the template. */
  abs: string;
}

/**
 * Read `_saasaloy-base.json` off a template. A template with none has no seed files. The
 * declaration ships inside this package, so a malformed one is a build error worth a
 * plain throw rather than a refusal aimed at the user.
 */
export async function readBaseDeclaration(
  templateDir: string
): Promise<BaseDeclaration> {
  const raw = await readIfPresent(join(templateDir, BASE_DECLARATION));
  if (raw === undefined) {
    return { seedFiles: [], retiredSeedFiles: [], ownedFiles: [] };
  }
  const parsed = JSON.parse(raw) as {
    seedFiles?: unknown;
    retiredSeedFiles?: unknown;
    ownedFiles?: unknown;
  };
  const seedFiles = parsed.seedFiles;
  if (
    !Array.isArray(seedFiles) ||
    !seedFiles.every((entry) => typeof entry === "string" && entry !== "")
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "seedFiles" as a list of project-relative paths.`
    );
  }
  const retiredSeedFiles = parsed.retiredSeedFiles ?? [];
  if (
    !Array.isArray(retiredSeedFiles) ||
    !retiredSeedFiles.every(
      (entry) => typeof entry === "string" && entry !== ""
    )
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "retiredSeedFiles" as a list of project-relative paths.`
    );
  }
  const ownedFiles = parsed.ownedFiles ?? [];
  if (
    !Array.isArray(ownedFiles) ||
    !ownedFiles.every((entry) => typeof entry === "string" && entry !== "")
  ) {
    throw new Error(
      `${BASE_DECLARATION} must declare "ownedFiles" as a list of project-relative globs.`
    );
  }
  return {
    seedFiles: [...(seedFiles as string[]), ...(retiredSeedFiles as string[])],
    retiredSeedFiles: retiredSeedFiles as string[],
    ownedFiles: ownedFiles as string[],
  };
}

/**
 * The aliases the template's own `saasaloy.json` declares (#312). That file is a seed
 * file, so `update` never writes it, and a project made before an alias existed would
 * never get it. `update` reads the bundled template's copy and adds each key the project
 * lacks. A template with no `saasaloy.json`, or no `aliases` in it, declares none.
 */
export async function templateAliases(
  templateDir: string
): Promise<Record<string, string>> {
  const raw = await readIfPresent(join(templateDir, TEMPLATE_CONFIG));
  if (raw === undefined) {
    return {};
  }
  const parsed = JSON.parse(raw) as { aliases?: unknown };
  const out: Record<string, string> = {};
  if (typeof parsed.aliases !== "object" || parsed.aliases === null) {
    return out;
  }
  for (const [alias, prefix] of Object.entries(parsed.aliases)) {
    if (typeof prefix === "string") {
      out[alias] = prefix;
    }
  }
  return out;
}

/** Every file the template ships, sorted by target, the declaration excluded. */
export async function listTemplateFiles(
  templateDir: string
): Promise<TemplateFile[]> {
  const out: TemplateFile[] = [];
  const walk = async (
    dir: string,
    fromPrefix: string,
    targetPrefix: string,
    isRoot: boolean
  ): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (isRoot && entry.name === BASE_DECLARATION) {
        continue;
      }
      const from = posix.join(fromPrefix, entry.name);
      const target = posix.join(targetPrefix, renderedName(entry.name));
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs, from, target, false);
      } else if (entry.isFile()) {
        out.push({ from, target, abs });
      }
    }
  };
  await walk(templateDir, "", "", true);
  return out.toSorted((a, b) => (a.target < b.target ? -1 : 1));
}

// Computed on demand and cached per process: the template is about fifty files and the
// walk is milliseconds, and a runtime hash cannot drift from the files the way a
// build-time constant could.
const hashCache = new Map<string, Promise<string>>();

/**
 * sha256 over the sorted `(target, sha256 of source bytes)` pairs of the template as
 * shipped. Source bytes, not rendered: this identifies the template, and a project name
 * must not change it.
 */
export function templateHash(templateDir: string): Promise<string> {
  let cached = hashCache.get(templateDir);
  if (!cached) {
    cached = (async () => {
      const digest = createHash("sha256");
      for (const file of await listTemplateFiles(templateDir)) {
        digest.update(file.target);
        digest.update("\0");
        digest.update(hashContent(await readFile(file.abs, "utf-8")));
        digest.update("\n");
      }
      return digest.digest("hex");
    })();
    hashCache.set(templateDir, cached);
  }
  return cached;
}

/** The lock's `base` record for a template at `templateHash`, rendered by `cliVersion`. */
export function baseRecord(
  cliVersion: string,
  hash: string,
  name = DEFAULT_BASE_NAME
): BaseRecord {
  return { name, cliVersion, templateHash: hash };
}

/** The manifest entries the base owns, keyed by target. */
export function baseEntries(manifest: Manifest): Record<string, ManagedEntry> {
  const out: Record<string, ManagedEntry> = {};
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (entry.module === BASE_MODULE) {
      out[target] = entry;
    }
  }
  return out;
}

/** What `recordBaseFiles` needs of a file: the three fields `copyTemplate` returns, plus provenance. */
export type BaseFileRecord = Pick<WrittenFile, "target" | "from" | "hash"> & {
  /** The hash came off disk, not out of the render — see `ManagedEntry.adopted`. */
  adopted?: boolean;
};

/**
 * Replace the base's manifest entries with `files`. Entries other modules own are left
 * alone; a base entry `files` no longer names is dropped, so the record is always the
 * template that was last rendered or adopted.
 */
export function recordBaseFiles(
  manifest: Manifest,
  files: readonly BaseFileRecord[]
): void {
  for (const [target, entry] of Object.entries(manifest.managed)) {
    if (entry.module === BASE_MODULE) {
      untrackManagedFile(manifest, target);
    }
  }
  for (const file of files) {
    recordManagedFile(manifest, {
      adopted: file.adopted,
      from: file.from,
      hash: file.hash,
      module: BASE_MODULE,
      target: file.target,
    });
  }
}

/**
 * Whether the project carries a usable base record: the lock's `base` *and* at least one
 * manifest entry for it. A lock record with no manifest entries has nothing to classify
 * against, so it counts as untracked and `update` re-adopts.
 */
export function isBaseTracked(lock: Lockfile, manifest: Manifest): boolean {
  return (
    lock.base !== undefined && Object.keys(baseEntries(manifest)).length > 0
  );
}

/**
 * The CLI version the base was adopted at (#298), or `undefined` for a base `init`
 * rendered. A record written before `adoptedAt` existed carries none, yet `adoptBase`
 * flagged every file it recorded off disk as `adopted`; such a record reads as adopted at
 * its `cliVersion`, which is what `adoptBase` wrote there.
 */
export function baseAdoptedAt(
  lock: Lockfile,
  manifest: Manifest
): string | undefined {
  if (!lock.base) {
    return undefined;
  }
  if (lock.base.adoptedAt !== undefined) {
    return lock.base.adoptedAt;
  }
  return Object.values(baseEntries(manifest)).some((entry) => entry.adopted)
    ? lock.base.cliVersion
    : undefined;
}

/**
 * Whether no update has moved the base record since `update` adopted it (#298). Only then
 * is the lock range inexact: the project may predate the CLI that adopted it, so the base
 * update notes up to that CLI cannot be placed, and `update --from` may name the start.
 */
export function isFirstUpdateAfterAdoption(
  lock: Lockfile,
  manifest: Manifest
): boolean {
  const adoptedAt = baseAdoptedAt(lock, manifest);
  return adoptedAt !== undefined && adoptedAt === lock.base?.cliVersion;
}

/**
 * The CLI version whose template is the merge base of a base update (#312). `--from`
 * names where an adopted project really started, so it wins. On the first update after
 * adoption the record's `adoptedAt` is the template the hashes were taken against. Any
 * other run reads the version the lock records.
 */
export function baseSnapshotVersion(
  lock: Lockfile,
  manifest: Manifest,
  from?: string
): string | undefined {
  if (from !== undefined) {
    return from;
  }
  if (isFirstUpdateAfterAdoption(lock, manifest)) {
    return baseAdoptedAt(lock, manifest);
  }
  return lock.base?.templateVersion ?? lock.base?.cliVersion;
}

/** The template at an older release, unrendered, in a folder the caller cleans up. */
export interface BaseSnapshot {
  version: string;
  /** The template source, laid out like `baseTemplateDir()`. */
  dir: string;
  cleanup: () => Promise<void>;
}

/** No template for the version, and the reason the merge plan prints. */
export interface NoBaseSnapshot {
  version: string;
  reason: string;
}

/**
 * The base template as release `version` shipped it (#312, ADR 0059): the tag
 * `v<version>` of mimukit/saasaloy, path `packages/cli/templates/base`, fetched through
 * giget with the module fetch's auth and deadline. Always that repo, even under
 * `SAASALOY_REGISTRY_DIR`: the template is not under `modules/`. `SAASALOY_BASE_SNAPSHOT_DIR`
 * replaces the fetch with a local folder of `<version>/` copies.
 *
 * Never throws. A version that names no release, a missing folder or a failed download
 * returns a reason, and the base update takes the two-way path with that reason on its
 * header. One tarball request per call, so one per base update.
 */
export async function fetchBaseSnapshot(
  version: string
): Promise<BaseSnapshot | NoBaseSnapshot> {
  const parsed = parseVersion(version);
  if (
    parsed === undefined ||
    (parsed.major === 0 && parsed.minor === 0 && parsed.patch === 0)
  ) {
    return { version, reason: noSnapshotReason.notARelease(version) };
  }
  const local = process.env[BASE_SNAPSHOT_ENV];
  if (local) {
    const dir = join(local, version);
    if (!(await pathExists(dir))) {
      return { version, reason: noSnapshotReason.notInSnapshotDir(version) };
    }
    // The folder is the caller's fixture, not ours to delete.
    return { version, dir, cleanup: () => Promise.resolve() };
  }
  const parent = await mkdtemp(join(tmpdir(), "saasaloy-base-snapshot-"));
  const cleanup = () => rm(parent, { recursive: true, force: true });
  const dir = join(parent, "base");
  try {
    await withDeadline(
      downloadTemplate(
        `github:${DEFAULT_OWNER}/${DEFAULT_REPO}/${BASE_TEMPLATE_PATH}#v${version}`,
        { auth: authToken(), dir, force: true }
      ),
      DOWNLOAD_TIMEOUT_MS,
      `Download of the base template at v${version}`
    );
    // A tag that predates the path extracts nothing, which is no template either.
    if (!(await pathExists(dir)) || (await readdir(dir)).length === 0) {
      throw new Error(`v${version} holds no ${BASE_TEMPLATE_PATH}`);
    }
  } catch (error) {
    await cleanup();
    const detail = error instanceof Error ? error.message : String(error);
    return { version, reason: noSnapshotReason.fetchFailed(version, detail) };
  }
  return { version, dir, cleanup };
}

/**
 * Base targets the manifest tracks that are not on disk — the files `update` classifies as
 * `deleted` (#312). `compareBase` needs this because `templateHash` only says whether the
 * *template* moved: a file deleted from disk leaves the hash equal, so without this the base
 * reads `current` and the owner is never asked whether to keep it deleted (#120).
 *
 * Seed files are excluded. They are recorded but never updated, so a missing one produces no
 * plan action and would leave the base permanently `outdated` with nothing to apply. A
 * tombstone is excluded too (ADR 0059): the owner kept it deleted, so the base reads current.
 */
export async function missingBaseTargets(
  root: string,
  manifest: Manifest,
  templateDir: string
): Promise<string[]> {
  const seed = new Set((await readBaseDeclaration(templateDir)).seedFiles);
  const missing: string[] = [];
  for (const [target, entry] of Object.entries(baseEntries(manifest))) {
    if (seed.has(target) || entry.deleted) {
      continue;
    }
    if ((await readIfPresent(resolveWithinRoot(root, target))) === undefined) {
      missing.push(target);
    }
  }
  return missing.toSorted((a, b) => (a < b ? -1 : 1));
}

/** The template rendered with a project's own vars, in a temp dir the caller removes. */
export interface RenderedTemplate {
  dir: string;
  files: WrittenFile[];
  cleanup: () => Promise<void>;
}

/**
 * Render the bundled template for `root` into a temp dir, source names kept, so each
 * file's `from` resolves inside the render and its `hash` is of the bytes `init` would
 * have written for this project.
 *
 * `projectName` is the project's own name, read from `saasaloy.json` — never
 * `basename(root)`. The directory is the wrong source: a git worktree, a renamed folder
 * or a CI checkout path all differ from the name `init` rendered with, and substituting
 * one of those rewrites `package.json` `name`, `wrangler.jsonc` `name` and `siteName` to
 * a name the project never chose.
 *
 * `testingMode` is the project's own mode, read from `saasaloy.json` (#242). The render
 * fills the root `AGENTS.md` testing block with it, so a render compares against the
 * bytes `init` or `saasaloy testing` wrote and `update` never puts the `off` text back.
 *
 * `cliVersion` replaces `{{CLI_VERSION}}` for an older release's template (#312), so the
 * snapshot holds the bytes that release's `init` wrote. It defaults to the running CLI.
 */
export async function renderTemplate(
  root: string,
  templateDir: string,
  projectName: string,
  testingMode: TestingMode,
  cliVersion?: string
): Promise<RenderedTemplate> {
  const dir = await mkdtemp(join(tmpdir(), "saasaloy-base-render-"));
  const vars = templateVars(projectName);
  const files = await copyTemplate(
    templateDir,
    dir,
    cliVersion === undefined ? vars : { ...vars, CLI_VERSION: cliVersion },
    {
      keepNames: true,
      testingMode,
    }
  );
  return {
    dir,
    files,
    cleanup: () => rm(dir, { recursive: true, force: true }),
  };
}

export interface AdoptBaseArgs {
  root: string;
  /** The running CLI's version — the record says the base was adopted here. */
  cliVersion: string;
  /** The project's own name, from `saasaloy.json` — never the directory's. */
  projectName: string;
  /** The project's testing mode, from `saasaloy.json` (#242). */
  testingMode: TestingMode;
  /** Loaded state, mutated in place and saved unless `dryRun`. */
  manifest: Manifest;
  lock: Lockfile;
  /** Report only: neither state file is written. */
  dryRun?: boolean;
  /** Defaults to the bundled template; tests point it at a fixture. */
  templateDir?: string;
}

export interface AdoptBaseResult {
  /** Targets recorded at the hash they have on disk. */
  adopted: string[];
  /**
   * Template files not on disk. Not recorded (#312), so a later base update reads each as
   * new and creates it, rather than asking whether to keep a file the project never held.
   */
  absent: string[];
  record: BaseRecord;
}

/**
 * Give an unrecorded project a base record at the running CLI (#120). Every file today's
 * template ships is recorded at the hash it has on disk — edits and all — so the next
 * `update` classifies against what is really there and never manufactures a wall of
 * conflicts on a customised project. A file the template no longer ships is not recorded,
 * and neither is a template file missing from disk (#312): `update` reads an untracked
 * absent file as `create`, where a tracked one would read as deleted on purpose. Adoption
 * records the present, not the past: it skips at most one generation of base changes.
 *
 * A file recorded off disk is flagged `adopted`, and that flag is the whole safety of
 * this step. Without it the next `update` reads the recorded hash as proof the file is
 * untouched template output and overwrites every hand edit in the project — the failure
 * this flag exists to end. An adopted file goes to the merge plan instead.
 */
export async function adoptBase(args: AdoptBaseArgs): Promise<AdoptBaseResult> {
  const {
    root,
    cliVersion,
    projectName,
    testingMode,
    manifest,
    lock,
    dryRun = false,
  } = args;
  const templateDir = args.templateDir ?? (await baseTemplateDir());
  const render = await renderTemplate(
    root,
    templateDir,
    projectName,
    testingMode
  );
  try {
    const files: BaseFileRecord[] = [];
    const adopted: string[] = [];
    const absent: string[] = [];
    for (const file of render.files) {
      const mine = await readIfPresent(resolveWithinRoot(root, file.target));
      if (mine === undefined) {
        absent.push(file.target);
      } else {
        adopted.push(file.target);
        files.push({
          target: file.target,
          from: file.from,
          hash: hashContent(mine),
          adopted: true,
        });
      }
    }
    const record: BaseRecord = {
      ...baseRecord(
        cliVersion,
        await templateHash(templateDir),
        lock.base?.name ?? DEFAULT_BASE_NAME
      ),
      adoptedAt: cliVersion,
    };
    if (!dryRun) {
      recordBaseFiles(manifest, files);
      lock.base = record;
      await saveManifest(root, manifest);
      await saveLock(root, lock);
    }
    return { adopted, absent, record };
  } finally {
    await render.cleanup();
  }
}

export interface BaseUpdateArgs {
  root: string;
  manifest: Manifest;
  lock: Lockfile;
  /** The template the running CLI ships — `baseTemplateDir()`, or a fixture. */
  templateDir: string;
  /** The running CLI's version, written into the record a clean run moves to. */
  cliVersion: string;
  /** The project's own name, from `saasaloy.json` — never the directory's. */
  projectName: string;
  /** The project's testing mode, from `saasaloy.json` (#242). */
  testingMode: TestingMode;
  /** The `outdated` row from `compareBase`, carried into the plan for the summary. */
  comparison: ModuleComparison;
  /** `update --from <version>` (#298): the merge base's version, ahead of the lock's (#312). */
  from?: string;
}

export interface BaseUpdateHandle {
  input: ModuleUpdateInput;
  /** Remove the rendered templates and the snapshot; call once the plan has been built and executed. */
  cleanup: () => Promise<void>;
}

/** One template rendered for the project as a one-scaffold descriptor rooted at it. */
async function renderAsModule(
  render: RenderedTemplate,
  templateDir: string,
  seed: ReadonlySet<string>
): Promise<{ module: LoadedModule; targets: Set<string> }> {
  const shipped = render.files.filter((file) => !seed.has(file.target));
  // Declared on the scaffold like a module's own, so the plan adds any the project lacks.
  const aliases = await templateAliases(templateDir);
  return {
    module: {
      dir: render.dir,
      item: {
        name: BASE_MODULE,
        type: "saasaloy:capability",
        scaffolds: [
          {
            workspace: ".",
            ...(Object.keys(aliases).length > 0 ? { aliases } : {}),
            files: shipped.map((file) => ({
              path: file.from,
              target: file.target,
            })),
          },
        ],
      },
    },
    targets: new Set(shipped.map((file) => file.target)),
  };
}

/**
 * The base as a `ModuleUpdateInput` the existing classifier can run (#120). The bundled
 * template is rendered for this project into a temp dir and described as a one-scaffold
 * descriptor rooted at the project, so `listModuleFiles` places each file where `init`
 * put it. Seed files are left out of the descriptor and named in `ignoreTargets`, and
 * every recorded patch against a shipped file is queued for re-apply.
 *
 * The merge base (#312, ADR 0059) is the template at `baseSnapshotVersion`, fetched by
 * `fetchBaseSnapshot` and rendered with the same vars, so `classifyUpdate` runs three-way
 * and skips a file the template did not change. The new template's declaration decides
 * the seed and owned rules for both sides. Unless `--from` named the version, the
 * snapshot must hash to the lock's `templateHash`: a record whose label moved while a
 * merge waited names a newer template than the one the files came from. With no usable
 * snapshot the plan takes the `noMergeBase` path modules already have, with the reason.
 *
 * No `dependencies` are declared: the root `package.json` is itself a managed base file,
 * so a pin bump rides its overwrite or its merge plan rather than a second write path.
 */
export async function baseUpdateInput(
  args: BaseUpdateArgs
): Promise<BaseUpdateHandle> {
  const {
    root,
    manifest,
    lock,
    templateDir,
    cliVersion,
    projectName,
    testingMode,
    comparison,
    from,
  } = args;
  const cleanups: (() => Promise<void>)[] = [];
  const cleanup = async (): Promise<void> => {
    await Promise.all(cleanups.map((fn) => fn()));
    cleanups.length = 0;
  };
  try {
    const render = await renderTemplate(
      root,
      templateDir,
      projectName,
      testingMode
    );
    cleanups.push(render.cleanup);
    const declaration = await readBaseDeclaration(templateDir);
    const seed = new Set(declaration.seedFiles);
    const theirs = await renderAsModule(render, templateDir, seed);

    let base: LoadedModule | undefined;
    let noMergeBase: string | undefined;
    const version = baseSnapshotVersion(lock, manifest, from) ?? "";
    const snapshot = await fetchBaseSnapshot(version);
    if ("reason" in snapshot) {
      noMergeBase = snapshot.reason;
    } else {
      cleanups.push(snapshot.cleanup);
      if (
        from === undefined &&
        lock.base !== undefined &&
        (await templateHash(snapshot.dir)) !== lock.base.templateHash
      ) {
        noMergeBase = noSnapshotReason.hashMismatch(version);
      } else {
        try {
          const old = await renderTemplate(
            root,
            snapshot.dir,
            projectName,
            testingMode,
            version
          );
          cleanups.push(old.cleanup);
          base = (await renderAsModule(old, snapshot.dir, seed)).module;
        } catch (error) {
          const detail = error instanceof Error ? error.message : String(error);
          noMergeBase = noSnapshotReason.renderFailed(version, detail);
        }
      }
    }

    // Kept on the new record, so once `cliVersion` moves past it the next run reads the
    // lock range as exact (#298).
    const adoptedAt = baseAdoptedAt(lock, manifest);
    return {
      input: {
        comparison,
        theirs: theirs.module,
        ...(base === undefined ? {} : { base }),
        ...(noMergeBase === undefined ? {} : { noMergeBase }),
        intent: [],
        ignoreTargets: seed,
        isOwned: ownedMatcher(declaration),
        reapplyPatches: manifest.patches.filter((patch) =>
          theirs.targets.has(patch.file)
        ),
        baseRecord: {
          ...baseRecord(
            cliVersion,
            await templateHash(templateDir),
            lock.base?.name ?? DEFAULT_BASE_NAME
          ),
          ...(adoptedAt === undefined ? {} : { adoptedAt }),
        },
      },
      cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
